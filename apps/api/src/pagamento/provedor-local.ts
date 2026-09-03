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
import { ErroDePagamento, type Cobranca, type CredenciaisDaClinica, type PedidoDeCobranca, type ProvedorDePagamento, type StatusNoProvedor } from "./provedor.js";

/** Estado das cobrancas simuladas, em memoria. Some ao reiniciar - e teste. */
const COBRANCAS = new Map<string, { status: StatusNoProvedor; valor: number; metodo: string }>();

export class ProvedorLocalDePagamento implements ProvedorDePagamento {
  readonly nome = "local_teste";
  readonly rotulo = "Gateway simulado (NAO movimenta dinheiro)";

  /** Cartao de teste que sempre e recusado, para exercitar o caminho ruim. */
  static readonly TOKEN_RECUSADO = "tok_recusado";

  async cobrar(_credenciais: CredenciaisDaClinica, pedido: PedidoDeCobranca): Promise<Cobranca> {
    if (pedido.valorCentavos <= 0) throw new ErroDePagamento("VALOR_INVALIDO", "O valor precisa ser maior que zero.");

    const id = `local_${randomUUID()}`;
    const recusado = pedido.tokenDoCartao === ProvedorLocalDePagamento.TOKEN_RECUSADO;

    // Cartao responde na hora (autorizado ou recusado). Pix fica pendente
    // ate o webhook - exatamente como no mundo real.
    const status: StatusNoProvedor = recusado ? "recusado" : pedido.metodo === "cartao_credito" ? "autorizado" : "pendente";
    COBRANCAS.set(id, { status, valor: pedido.valorCentavos, metodo: pedido.metodo });

    if (recusado) throw new ErroDePagamento("RECUSADO", "Cartao recusado pelo emissor (simulado).");

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
    if (!atual) throw new ErroDePagamento("FALHA", "Cobranca simulada nao encontrada.");
    return { idNoProvedor: id, status: atual.status, bruto: { simulado: true } };
  }

  async capturar(_c: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    const atual = COBRANCAS.get(id);
    if (!atual) throw new ErroDePagamento("FALHA", "Cobranca simulada nao encontrada.");
    if (atual.status !== "autorizado") throw new ErroDePagamento("FALHA", `So se captura o que esta autorizado (esta: ${atual.status}).`);
    atual.status = "confirmado";
    return { idNoProvedor: id, status: "confirmado", bruto: { simulado: true } };
  }

  async estornar(_c: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    const atual = COBRANCAS.get(id);
    if (!atual) throw new ErroDePagamento("FALHA", "Cobranca simulada nao encontrada.");
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
