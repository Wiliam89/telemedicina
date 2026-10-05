/**
 * =====================================================================
 * PROVEDOR LOCAL DE VIDEO - SIMULADO, PARA O PROJETO RODAR SEM CONTA
 * =====================================================================
 *
 * Aqui NAO HA VIDEO. Nenhuma camera e aberta, nenhuma imagem trafega.
 *
 * Ele existe por um motivo pratico: quem baixa o projeto consegue rodar o
 * fluxo inteiro - marcar, pagar, consentir, entrar na fila, ser chamado e
 * "entrar na sala" - sem criar conta em servico nenhum. O que a tela mostra
 * no lugar da imagem e um aviso dizendo exatamente isso.
 *
 * A API SE RECUSA A SUBIR EM PRODUCAO COM ELE (resolvedor.ts). O mesmo
 * cuidado que tomamos com a assinatura sem valor legal no Modulo 9: o modo
 * de teste tem que ser impossivel de ligar sem querer no lugar errado.
 *
 * Mesmo sendo simulado, ele se comporta como um provedor de verdade nas
 * tres coisas que os testes precisam verificar: a sala tem validade, o
 * token e de UMA pessoa e expira, e apagar a sala invalida a entrada. Um
 * dublê que mente nessas tres coisas deixaria passar erro de regra.
 */
import { createHmac, randomBytes } from "node:crypto";
import {
  ErroDeVideo,
  type PedidoDeSala,
  type PedidoDeToken,
  type ProvedorDeVideo,
  type SalaCriada,
  type TokenDeEntrada,
} from "./provedor.js";

/**
 * Segredo sorteado quando o processo sobe. Nao vai para arquivo nenhum:
 * token de teste nao deve sobreviver a um reinicio, e muito menos virar
 * valor fixo que alguem copie para producao.
 */
const SEGREDO_DO_PROCESSO = randomBytes(32);

export class ProvedorLocalDeVideo implements ProvedorDeVideo {
  readonly nome = "local_teste" as const;
  readonly rotulo = "Simulado (sem video)";
  readonly videoReal = false;

  /** As salas vivem na memoria do processo, como no provedor de verdade. */
  private readonly salas = new Map<string, { url: string; expiraEm: Date }>();

  async criarSala(pedido: PedidoDeSala): Promise<SalaCriada> {
    const existente = this.salas.get(pedido.nome);
    if (existente) return { nome: pedido.nome, ...existente };

    // Endereco com esquema proprio: nao e URL que o navegador consiga
    // abrir, e isso e de proposito. Se um dia escapar para a tela por
    // engano, nao vai parecer uma sala de verdade.
    const sala = { url: `simulado://sala/${pedido.nome}`, expiraEm: pedido.expiraEm };
    this.salas.set(pedido.nome, sala);
    return { nome: pedido.nome, ...sala };
  }

  async emitirToken(pedido: PedidoDeToken): Promise<TokenDeEntrada> {
    if (!this.salas.has(pedido.nomeDaSala)) {
      throw new ErroDeVideo("SALA_NAO_ENCONTRADA", "A sala simulada nao existe mais.");
    }

    // Assinado de verdade, para o teste poder conferir que o token diz de
    // quem e e quando vence - e que trocar qualquer parte o invalida.
    const corpo = Buffer.from(
      JSON.stringify({
        sala: pedido.nomeDaSala,
        pessoa: pedido.pessoaId,
        papel: pedido.papel,
        exp: Math.floor(pedido.expiraEm.getTime() / 1000),
      }),
    ).toString("base64url");
    const assinatura = createHmac("sha256", SEGREDO_DO_PROCESSO).update(corpo).digest("base64url");

    return { token: `simulado.${corpo}.${assinatura}`, expiraEm: pedido.expiraEm };
  }

  async apagarSala(nome: string): Promise<void> {
    this.salas.delete(nome);
  }

  /** So os testes usam: confere que o token nao foi mexido. */
  conferirToken(token: string): { sala: string; pessoa: string; papel: string; exp: number } | null {
    const partes = token.split(".");
    if (partes.length !== 3 || partes[0] !== "simulado") return null;
    const [, corpo, assinatura] = partes as [string, string, string];
    const esperada = createHmac("sha256", SEGREDO_DO_PROCESSO).update(corpo).digest("base64url");
    if (assinatura !== esperada) return null;
    return JSON.parse(Buffer.from(corpo, "base64url").toString());
  }
}
