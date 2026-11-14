/**
 * =====================================================================
 * PROVEDOR LOCAL DE TESTE - simula o gateway, sem mover dinheiro
 * =====================================================================
 *
 * Existe pelo mesmo motivo do provedor local de assinatura: sem ele,
 * ninguem consegue rodar o projeto de ponta a ponta sem contratar um
 * gateway. Ele gera um "copia e cola" falso, aceita ser confirmado por
 * webhook e assina as notificacoes com o mesmo HMAC-SHA256 que os
 * provedores de verdade usam - entao o codigo que confere a assinatura e
 * exercitado de verdade.
 *
 * A API SE RECUSA A USA-LO EM PRODUCAO.
 */
import { createHmac, randomUUID } from "node:crypto";
import { ErroDePagamento, type CartaoNoProvedor, type Cobranca, type CredenciaisDaClinica, type PedidoDeCobranca, type ProvedorDePagamento, type StatusNoProvedor } from "./provedor.js";

/** Estado das cobrancas simuladas, em memoria. Some ao reiniciar - e teste. */
const COBRANCAS = new Map<string, { status: StatusNoProvedor; valor: number; metodo: string }>();

export class ProvedorLocalDePagamento implements ProvedorDePagamento {
  readonly nome = "local_teste";
  readonly rotulo = "Gateway simulado (NAO movimenta dinheiro)";

  /** Cartao de teste que sempre e recusado, para exercitar o caminho ruim. */
  static readonly TOKEN_RECUSADO = "tok_recusado";
  /**
   * Cartao cadastrado que aceita ser guardado, mas RECUSA a cobranca no
   * final da consulta (final 0002): exercita o caminho "nao passou, pague
   * por Pix".
   */
  static readonly FINAL_QUE_RECUSA_COBRANCA = "0002";

  /**
   * Token simulado de cartao: "tok_teste_<final>_<mes>_<ano>_<bandeira>".
   * E o que a tela de teste monta NO NAVEGADOR - o numero inteiro nunca sai
   * de la, igual ao que acontece com o provedor de verdade.
   */
  static montarToken(d: { ultimos4: string; validadeMes: number; validadeAno: number; bandeira: string }): string {
    return `tok_teste_${d.ultimos4}_${d.validadeMes}_${d.validadeAno}_${d.bandeira}`;
  }

  async salvarCartao(_credenciais: CredenciaisDaClinica, dados: { pagador: { nome: string; email: string; cpf?: string | null }; tokenDoCartao: string }): Promise<CartaoNoProvedor> {
    const partes = /^tok_teste_(\d{4})_(\d{1,2})_(\d{4})_([a-z]{2,20})$/.exec(dados.tokenDoCartao);
    if (!partes) throw new ErroDePagamento("CARTAO_INVALIDO", "Cartão recusado pelo emissor (simulado).");
    return {
      clienteId: `cli_local_${randomUUID()}`,
      // O final vai no identificador: o estado em memoria some ao reiniciar,
      // e a cobranca precisa continuar sabendo qual cartao e.
      cartaoId: `card_local_${partes[1]}_${randomUUID()}`,
      bandeira: partes[4]!,
      ultimos4: partes[1]!,
      validadeMes: Number(partes[2]),
      validadeAno: Number(partes[3]),
    };
  }

  async removerCartao(): Promise<void> {
    // Nada a apagar: o cartao simulado so existe no identificador.
  }

  async cobrar(_credenciais: CredenciaisDaClinica, pedido: PedidoDeCobranca): Promise<Cobranca> {
    if (pedido.valorCentavos <= 0) throw new ErroDePagamento("VALOR_INVALIDO", "O valor precisa ser maior que zero.");

    const id = `local_${randomUUID()}`;

    // Cartao cadastrado: cobra na hora, ja capturado (o paciente nao esta presente).
    if (pedido.cartaoSalvo) {
      if (pedido.cartaoSalvo.cartaoId.startsWith(`card_local_${ProvedorLocalDePagamento.FINAL_QUE_RECUSA_COBRANCA}_`)) {
        COBRANCAS.set(id, { status: "recusado", valor: pedido.valorCentavos, metodo: pedido.metodo });
        throw new ErroDePagamento("RECUSADO", "Cartão recusado pelo emissor (simulado).");
      }
      COBRANCAS.set(id, { status: "confirmado", valor: pedido.valorCentavos, metodo: pedido.metodo });
      return { idNoProvedor: id, status: "confirmado", bruto: { simulado: true, cartaoSalvo: true } };
    }

    const recusado = pedido.tokenDoCartao === ProvedorLocalDePagamento.TOKEN_RECUSADO;

    // Cartao responde na hora (autorizado ou recusado). Pix fica pendente
    // ate o webhook - exatamente como no mundo real.
    const status: StatusNoProvedor = recusado ? "recusado" : pedido.metodo === "cartao_credito" ? "autorizado" : "pendente";
    COBRANCAS.set(id, { status, valor: pedido.valorCentavos, metodo: pedido.metodo });

    if (recusado) throw new ErroDePagamento("RECUSADO", "Cartão recusado pelo emissor (simulado).");

    return {
      idNoProvedor: id,
      status,
      pixCopiaECola: pedido.metodo === "pix" ? `00020126TESTE${id.replace(/-/g, "").slice(0, 24)}5204000053039865802BR` : null,
      // 1x1 PNG transparente: a tela mostra um QR de mentira sem quebrar.
      pixQrBase64: pedido.metodo === "pix" ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" : null,
      expiraEm: pedido.metodo === "pix" ? new Date(Date.now() + (pedido.expiraEmMinutos ?? 30) * 60000) : null,
      bruto: { simulado: true, comissao: pedido.comissaoPlataformaCentavos },
    };
  }

  async consultar(_c: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    const atual = COBRANCAS.get(id);
    if (!atual) throw new ErroDePagamento("FALHA", "Cobrança simulada não encontrada.");
    return { idNoProvedor: id, status: atual.status, bruto: { simulado: true } };
  }

  async capturar(_c: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    const atual = COBRANCAS.get(id);
    if (!atual) throw new ErroDePagamento("FALHA", "Cobrança simulada não encontrada.");
    if (atual.status !== "autorizado") throw new ErroDePagamento("FALHA", `So se captura o que esta autorizado (esta: ${atual.status}).`);
    atual.status = "confirmado";
    return { idNoProvedor: id, status: "confirmado", bruto: { simulado: true } };
  }

  async estornar(_c: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    const atual = COBRANCAS.get(id);
    if (!atual) throw new ErroDePagamento("FALHA", "Cobrança simulada não encontrada.");
    atual.status = "estornado";
    return { idNoProvedor: id, status: "estornado", bruto: { simulado: true } };
  }

  conferirNotificacao(cabecalhos: Record<string, string | undefined>, corpoBruto: string, segredo: string): boolean {
    const recebida = cabecalhos["x-assinatura"] ?? "";
    const esperada = createHmac("sha256", segredo).update(corpoBruto).digest("hex");
    return recebida.length === esperada.length && createHmac("sha256", segredo).update(corpoBruto).digest("hex") === recebida;
  }

  lerNotificacao(corpo: unknown): { idNoProvedor: string } | null {
    const c = corpo as { id?: string };
    return c?.id ? { idNoProvedor: c.id } : null;
  }

  /** So para os testes: simula o Pix sendo pago. */
  static confirmarNoBanco(id: string): void {
    const atual = COBRANCAS.get(id);
    if (atual) atual.status = "confirmado";
  }

  /** So para os testes: monta a notificacao que o provedor mandaria. */
  static montarNotificacao(id: string, segredo: string): { corpo: string; cabecalhos: Record<string, string> } {
    const corpo = JSON.stringify({ id, tipo: "pagamento" });
    return { corpo, cabecalhos: { "x-assinatura": createHmac("sha256", segredo).update(corpo).digest("hex") } };
  }
}
