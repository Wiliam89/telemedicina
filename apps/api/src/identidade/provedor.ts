/**
 * =====================================================================
 * CONFERENCIA DE IDENTIDADE DO MEDICO (ADR-0022)
 * =====================================================================
 *
 * O objetivo e um so: garantir que quem atende e o dono do CRM. A selfie do
 * medico e comparada com a foto do documento dele.
 *
 * QUEM COMPARA pode mudar sem a plataforma mudar:
 *
 *   manual      a administracao olha as duas fotos lado a lado e registra o
 *               resultado (padrao; nao depende de nenhum servico);
 *   externo     um software de reconhecimento facial de fora compara e avisa
 *               o resultado em POST /webhooks/identidade, com assinatura;
 *   local_teste aprova sozinho, para o projeto rodar inteiro na sua maquina.
 *               A API se recusa a usa-lo em producao.
 *
 * A plataforma NUNCA guarda modelo biometrico (o "mapa" do rosto): guarda a
 * foto enviada, o resultado e de onde ele veio.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Ambiente } from "../ambiente.js";

export type StatusDeIdentidade = "pendente" | "aprovada" | "reprovada" | "inconclusiva";

export interface ResultadoDaIdentidade {
  status: StatusDeIdentidade;
  /** Semelhanca de 0 a 100, quando o provedor informa. */
  pontuacao: number | null;
  detalhes: Record<string, unknown> | null;
}

export interface ProvedorDeIdentidade {
  /** O que fica gravado em verificacoes_de_identidade.provedor. */
  readonly nome: string;
  /** Quem decide e uma pessoa da administracao (e nao um servico)? */
  readonly decisaoHumana: boolean;
  /** Abre a conferencia. `referencia` e o identificador que o servico de fora devolve no aviso. */
  iniciar(dados: { referencia: string }): Promise<ResultadoDaIdentidade>;
  /** Onde o medico faz a prova de vida no servico de fora, quando houver. */
  urlDaProvaDeVida(referencia: string): string | null;
}

class ProvedorManual implements ProvedorDeIdentidade {
  readonly nome = "manual";
  readonly decisaoHumana = true;
  async iniciar(): Promise<ResultadoDaIdentidade> {
    return { status: "pendente", pontuacao: null, detalhes: null };
  }
  urlDaProvaDeVida(): string | null {
    return null;
  }
}

export class ProvedorLocalDeIdentidade implements ProvedorDeIdentidade {
  readonly nome = "local_teste";
  readonly decisaoHumana = false;
  async iniciar(): Promise<ResultadoDaIdentidade> {
    return { status: "aprovada", pontuacao: 99, detalhes: { simulado: true } };
  }
  urlDaProvaDeVida(): string | null {
    return null;
  }
}

class ProvedorExterno implements ProvedorDeIdentidade {
  readonly decisaoHumana = false;
  constructor(
    readonly nome: string,
    private readonly modeloDaUrl: string | null,
  ) {}
  async iniciar(): Promise<ResultadoDaIdentidade> {
    // O resultado chega depois, pelo aviso assinado.
    return { status: "pendente", pontuacao: null, detalhes: null };
  }
  urlDaProvaDeVida(referencia: string): string | null {
    return this.modeloDaUrl ? this.modeloDaUrl.replace("{referencia}", encodeURIComponent(referencia)) : null;
  }
}

/** Escolhido UMA vez, quando a API sobe: configuracao errada aparece no terminal, nao no cadastro de um medico. */
export function criarProvedorDeIdentidade(ambiente: Ambiente): ProvedorDeIdentidade {
  const escolhido = ambiente.IDENTIDADE_PROVEDOR ?? "manual";
  if (escolhido === "local_teste") {
    if (ambiente.NODE_ENV === "production") {
      throw new Error(
        "IDENTIDADE_PROVEDOR=local_teste aprova qualquer pessoa e nao pode ser usado em producao.\n" +
          "  - Sem custo: IDENTIDADE_PROVEDOR=manual (a administracao compara as fotos).\n" +
          "  - Com servico de reconhecimento facial: IDENTIDADE_PROVEDOR=externo e IDENTIDADE_WEBHOOK_SEGREDO.",
      );
    }
    return new ProvedorLocalDeIdentidade();
  }
  if (escolhido === "externo") {
    if (!ambiente.IDENTIDADE_WEBHOOK_SEGREDO) {
      throw new Error("IDENTIDADE_PROVEDOR=externo exige IDENTIDADE_WEBHOOK_SEGREDO em apps/api/.env: e com ele que se confere que o resultado veio mesmo do servico.");
    }
    return new ProvedorExterno(`externo:${ambiente.IDENTIDADE_NOME_DO_SERVICO ?? "servico"}`, ambiente.IDENTIDADE_URL_PROVA_DE_VIDA ?? null);
  }
  return new ProvedorManual();
}

/** Aviso mais velho que isto e recusado: protege contra o reenvio de um aviso capturado. */
const VALIDADE_DO_AVISO_MS = 10 * 60 * 1000;

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Tempo constante: comparar com === vazaria a assinatura pelo tempo de resposta.
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * A assinatura cobre os CAMPOS, nao os bytes do corpo: assim nao depende de
 * como cada sistema escreve o JSON.
 *
 *   texto      = "<referencia>.<status>.<pontuacao ou vazio>.<ts>"
 *   assinatura = HMAC-SHA256(texto, IDENTIDADE_WEBHOOK_SEGREDO), em hexadecimal
 */
export function assinarResultado(d: { referencia: string; status: string; pontuacao: number | null; ts: number }, segredo: string): string {
  return createHmac("sha256", segredo).update(`${d.referencia}.${d.status}.${d.pontuacao ?? ""}.${d.ts}`).digest("hex");
}

export function resultadoAutentico(d: { referencia: string; status: string; pontuacao: number | null; ts: number }, assinatura: string, segredo: string, agora: number = Date.now()): boolean {
  if (!Number.isFinite(d.ts) || Math.abs(agora - d.ts * 1000) > VALIDADE_DO_AVISO_MS) return false;
  return iguais(assinarResultado(d, segredo), assinatura);
}

/** Para o servico de fora buscar as duas fotos: assinatura de "<referencia>.arquivos.<ts>". */
export function assinarPedidoDeArquivos(referencia: string, ts: number, segredo: string): string {
  return createHmac("sha256", segredo).update(`${referencia}.arquivos.${ts}`).digest("hex");
}

export function pedidoDeArquivosAutentico(referencia: string, ts: number, assinatura: string, segredo: string, agora: number = Date.now()): boolean {
  if (!Number.isFinite(ts) || Math.abs(agora - ts * 1000) > VALIDADE_DO_AVISO_MS) return false;
  return iguais(assinarPedidoDeArquivos(referencia, ts, segredo), assinatura);
}
