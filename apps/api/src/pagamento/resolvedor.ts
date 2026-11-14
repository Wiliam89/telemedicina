/**
 * Qual provedor de pagamento usar, e com quais credenciais.
 *
 * Duas formas de receber:
 *
 *   a) a clinica conectou a PROPRIA conta no provedor (OAuth). O dinheiro
 *      vai para ela, e o provedor separa a comissao da plataforma;
 *   b) a plataforma e a propria clinica (ADR-0022): a conta de recebimento
 *      e uma so, a da plataforma, e vem de apps/api/.env
 *      (PAGAMENTO_PROVEDOR + PAGAMENTO_ACCESS_TOKEN).
 *
 * Sem nenhuma das duas, em producao, nao se cobra - e a mensagem diz isso
 * com todas as letras.
 */
import { eq } from "drizzle-orm";
import { clinicas, type Banco } from "@tele/db";
import type { Ambiente } from "../ambiente.js";
import { decifrar, lerChave } from "../criptografia.js";
import { ProvedorLocalDePagamento } from "./provedor-local.js";
import { ProvedorMercadoPago } from "./provedor-mercadopago.js";
import { ErroDePagamento, type CredenciaisDaClinica, type ProvedorDePagamento } from "./provedor.js";

/** Quantos dias antes do vencimento comecamos a avisar. */
export const DIAS_DE_AVISO_DO_TOKEN = 15;

export interface ContextoDePagamento {
  provedor: ProvedorDePagamento;
  credenciais: CredenciaisDaClinica;
  /** Preenchido quando o token esta perto de vencer - a tela mostra. */
  avisoDeVencimento: string | null;
}

/** A clinica ja conectou uma conta para receber? */
export async function clinicaTemRecebimento(banco: Banco, clinicaId: string): Promise<boolean> {
  const [c] = await banco
    .select({ provedor: clinicas.pagamentoProvedor, contaId: clinicas.pagamentoContaId, token: clinicas.pagamentoTokenCifrado })
    .from(clinicas)
    .where(eq(clinicas.id, clinicaId))
    .limit(1);
  return Boolean(c?.provedor && c.contaId && c.token);
}

export class ResolvedorDePagamento {
  constructor(
    private readonly banco: Banco,
    private readonly ambiente: Ambiente,
  ) {}

  /** A conta da propria plataforma, quando configurada em apps/api/.env. */
  private daPlataforma(): ContextoDePagamento | null {
    const { PAGAMENTO_PROVEDOR: provedor, PAGAMENTO_ACCESS_TOKEN: token } = this.ambiente;
    if (provedor === "mercadopago" && token) {
      return { provedor: new ProvedorMercadoPago(), credenciais: { accessToken: token, contaId: "plataforma" }, avisoDeVencimento: null };
    }
    return null;
  }

  /** Ha como cobrar nesta clinica? Fora de producao sempre ha: o gateway simulado. */
  async temRecebimento(clinicaId: string): Promise<boolean> {
    if (this.ambiente.NODE_ENV !== "production") return true;
    return this.daPlataforma() !== null || (await clinicaTemRecebimento(this.banco, clinicaId));
  }

  /**
   * Como o NAVEGADOR transforma o cartao em token (ADR-0023). So a chave
   * publica sai daqui; o access token nunca.
   */
  async tokenizacao(clinicaId: string): Promise<{ provedor: string; chavePublica: string | null; disponivel: boolean }> {
    let contexto: ContextoDePagamento;
    try {
      contexto = await this.para(clinicaId);
    } catch {
      return { provedor: "nenhum", chavePublica: null, disponivel: false };
    }
    if (contexto.provedor.nome === "local_teste") return { provedor: "local_teste", chavePublica: null, disponivel: true };
    const chavePublica = this.ambiente.PAGAMENTO_CHAVE_PUBLICA ?? null;
    return { provedor: contexto.provedor.nome, chavePublica, disponivel: Boolean(chavePublica) };
  }

  async para(clinicaId: string): Promise<ContextoDePagamento> {
    const [c] = await this.banco
      .select({
        provedor: clinicas.pagamentoProvedor,
        contaId: clinicas.pagamentoContaId,
        tokenCifrado: clinicas.pagamentoTokenCifrado,
        expiraEm: clinicas.pagamentoTokenExpiraEm,
      })
      .from(clinicas)
      .where(eq(clinicas.id, clinicaId))
      .limit(1);

    // Em desenvolvimento, clinica sem recebimento usa o gateway simulado -
    // senao nao daria para testar o fluxo sem contratar ninguem.
    if (!c?.provedor || !c.tokenCifrado || !c.contaId) {
      const plataforma = this.daPlataforma();
      if (plataforma) return plataforma;
      if (this.ambiente.NODE_ENV === "production") {
        throw new ErroDePagamento(
          "CLINICA_SEM_RECEBIMENTO",
          "Esta clínica ainda não conectou uma conta para receber pagamentos.",
        );
      }
      return {
        provedor: new ProvedorLocalDePagamento(),
        credenciais: { accessToken: "simulado", contaId: "simulado" },
        avisoDeVencimento: null,
      };
    }

    if (!this.ambiente.CHAVE_CRIPTOGRAFIA) {
      throw new ErroDePagamento("FALHA", "CHAVE_CRIPTOGRAFIA não está definida em apps/api/.env.");
    }

    const agora = Date.now();
    if (c.expiraEm && c.expiraEm.getTime() < agora) {
      throw new ErroDePagamento(
        "TOKEN_VENCIDO",
        "A autorizacao desta clinica no provedor de pagamento venceu. A administracao precisa reconectar a conta - ate la, nao e possivel cobrar.",
      );
    }

    const diasRestantes = c.expiraEm ? Math.ceil((c.expiraEm.getTime() - agora) / 86400000) : null;

    return {
      provedor: c.provedor === "mercadopago" ? new ProvedorMercadoPago() : new ProvedorLocalDePagamento(),
      credenciais: {
        accessToken: decifrar(c.tokenCifrado, lerChave(this.ambiente.CHAVE_CRIPTOGRAFIA)),
        contaId: c.contaId,
      },
      avisoDeVencimento:
        diasRestantes !== null && diasRestantes <= DIAS_DE_AVISO_DO_TOKEN
          ? `A autorizacao no provedor de pagamento vence em ${diasRestantes} dia(s). Reconecte a conta para os repasses nao pararem.`
          : null,
    };
  }
}
