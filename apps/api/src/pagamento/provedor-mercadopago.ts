/**
 * =====================================================================
 * ADAPTADOR MERCADO PAGO (split de marketplace)
 * =====================================================================
 *
 * Escrito conforme a documentacao publica. O modelo e o de marketplace:
 *
 *   - a CLINICA autoriza a plataforma por OAuth e nos guardamos o
 *     access_token dela (cifrado). E com esse token que cobramos;
 *   - a comissao da plataforma vai no campo `application_fee`, e o
 *     provedor faz a divisao. Nos nao recebemos e repassamos - ele divide;
 *   - o token do vendedor VENCE (seis meses). Vencido, os repasses param -
 *     por isso o resolvedor avisa antes.
 *
 * AVISO HONESTO: nao pode ser testado sem credenciais e sem uma conta de
 * vendedor autorizada. A estrutura, os campos e os erros seguem a
 * documentacao; a primeira execucao real deve ser em ambiente de teste.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ErroDePagamento, type Cobranca, type CredenciaisDaClinica, type PedidoDeCobranca, type ProvedorDePagamento, type StatusNoProvedor } from "./provedor.js";

const URL_BASE = "https://api.mercadopago.com";

/** Os estados do Mercado Pago, traduzidos para os nossos. */
function traduzirStatus(status: string, detalhe?: string): StatusNoProvedor {
  switch (status) {
    case "approved":
      return "confirmado";
    case "authorized":
      return "autorizado";
    case "pending":
    case "in_process":
      return "pendente";
    case "rejected":
      return "recusado";
    case "refunded":
    case "charged_back":
      return "estornado";
    case "cancelled":
      return detalhe === "expired" ? "expirado" : "recusado";
    default:
      return "pendente";
  }
}

export class ProvedorMercadoPago implements ProvedorDePagamento {
  readonly nome = "mercadopago";
  readonly rotulo = "Mercado Pago";

  private async chamar<T>(
    caminho: string,
    opcoes: { metodo?: string; token: string; corpo?: unknown; idempotencia?: string },
  ): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(`${URL_BASE}${caminho}`, {
        method: opcoes.metodo ?? "POST",
        headers: {
          authorization: `Bearer ${opcoes.token}`,
          "content-type": "application/json",
          // O provedor nao cria a mesma cobranca duas vezes se a requisicao
          // for repetida (clique duplo, retentativa de rede).
          ...(opcoes.idempotencia ? { "X-Idempotency-Key": opcoes.idempotencia } : {}),
        },
        ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ErroDePagamento("PROVEDOR_INDISPONIVEL", "O servico de pagamento nao respondeu. Tente de novo em instantes.");
    }

    const texto = await resposta.text();
    const dados = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};

    if (!resposta.ok) {
      const detalhe = String(dados["message"] ?? dados["error"] ?? "");
      if (resposta.status === 401) throw new ErroDePagamento("TOKEN_VENCIDO", "A autorizacao da clinica no provedor venceu. E preciso reconectar a conta.");
      if (resposta.status >= 500) throw new ErroDePagamento("PROVEDOR_INDISPONIVEL", "O servico de pagamento esta instavel.");
      throw new ErroDePagamento("FALHA", detalhe || `O provedor recusou a operacao (HTTP ${resposta.status}).`);
    }
    return dados as T;
  }

  private montar(dados: Record<string, unknown>): Cobranca {
    const interacao = dados["point_of_interaction"] as { transaction_data?: { qr_code?: string; qr_code_base64?: string } } | undefined;
    const expira = dados["date_of_expiration"] as string | undefined;
    return {
      idNoProvedor: String(dados["id"]),
      status: traduzirStatus(String(dados["status"] ?? ""), String(dados["status_detail"] ?? "")),
      pixCopiaECola: interacao?.transaction_data?.qr_code ?? null,
      pixQrBase64: interacao?.transaction_data?.qr_code_base64 ?? null,
      expiraEm: expira ? new Date(expira) : null,
      bruto: dados,
    };
  }

  async cobrar(credenciais: CredenciaisDaClinica, pedido: PedidoDeCobranca): Promise<Cobranca> {
    const corpo: Record<string, unknown> = {
      transaction_amount: Number((pedido.valorCentavos / 100).toFixed(2)),
      description: pedido.descricao,
      // A comissao da plataforma. O provedor desconta a taxa dele primeiro
      // e depois a nossa sobre o restante.
      application_fee: Number((pedido.comissaoPlataformaCentavos / 100).toFixed(2)),
      notification_url: pedido.urlDeNotificacao,
      payer: {
        email: pedido.pagador.email,
        first_name: pedido.pagador.nome.split(" ")[0],
        ...(pedido.pagador.cpf ? { identification: { type: "CPF", number: pedido.pagador.cpf } } : {}),
      },
    };

    if (pedido.metodo === "pix") {
      corpo["payment_method_id"] = "pix";
      corpo["date_of_expiration"] = new Date(Date.now() + (pedido.expiraEmMinutos ?? 30) * 60000).toISOString();
    } else {
      if (!pedido.tokenDoCartao) throw new ErroDePagamento("FALHA", "Falta o token do cartao (gerado no navegador).");
      corpo["token"] = pedido.tokenDoCartao;
      corpo["installments"] = pedido.parcelas ?? 1;
      // Pre-autorizacao: reserva o valor sem cobrar. A captura vem depois
      // do atendimento acontecer - e o que evita cobrar por consulta que
      // o medico faltou.
      corpo["capture"] = false;
    }

    return this.montar(
      await this.chamar<Record<string, unknown>>("/v1/payments", {
        token: credenciais.accessToken,
        corpo,
        idempotencia: pedido.chaveIdempotencia,
      }),
    );
  }

  async consultar(credenciais: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    return this.montar(await this.chamar<Record<string, unknown>>(`/v1/payments/${id}`, { metodo: "GET", token: credenciais.accessToken }));
  }

  async capturar(credenciais: CredenciaisDaClinica, id: string): Promise<Cobranca> {
    return this.montar(
      await this.chamar<Record<string, unknown>>(`/v1/payments/${id}`, {
        metodo: "PUT",
        token: credenciais.accessToken,
        corpo: { capture: true },
      }),
    );
  }

  async estornar(credenciais: CredenciaisDaClinica, id: string, valorCentavos?: number): Promise<Cobranca> {
    await this.chamar(`/v1/payments/${id}/refunds`, {
      token: credenciais.accessToken,
      corpo: valorCentavos ? { amount: Number((valorCentavos / 100).toFixed(2)) } : {},
    });
    return this.consultar(credenciais, id);
  }

  /**
   * Confere o cabecalho x-signature. O provedor manda "ts=...,v1=..." e a
   * assinatura e o HMAC-SHA256 de um texto montado com o id do pagamento,
   * o x-request-id e o timestamp.
   */
  conferirNotificacao(cabecalhos: Record<string, string | undefined>, corpoBruto: string, segredo: string): boolean {
    const assinatura = cabecalhos["x-signature"];
    const requestId = cabecalhos["x-request-id"] ?? "";
    if (!assinatura) return false;

    const partes = Object.fromEntries(
      assinatura.split(",").map((p) => {
        const [chave, valor] = p.split("=");
        return [chave?.trim() ?? "", valor?.trim() ?? ""];
      }),
    );
    const ts = partes["ts"];
    const v1 = partes["v1"];
    if (!ts || !v1) return false;

    // Rejeita notificacao velha: protege contra reenvio de uma capturada
    // no passado (replay).
    if (Math.abs(Date.now() - Number(ts) * 1000) > 10 * 60 * 1000) return false;

    let id = "";
    try {
      const corpo = JSON.parse(corpoBruto) as { data?: { id?: string | number } };
      id = String(corpo.data?.id ?? "");
    } catch {
      return false;
    }

    const modelo = `id:${id};request-id:${requestId};ts:${ts};`;
    const esperada = createHmac("sha256", segredo).update(modelo).digest("hex");
    const a = Buffer.from(esperada);
    const b = Buffer.from(v1);
    // Comparacao de tempo constante: comparar com === vazaria informacao
    // pelo tempo de resposta.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  lerNotificacao(corpo: unknown): { idNoProvedor: string } | null {
    const c = corpo as { type?: string; action?: string; data?: { id?: string | number } };
    const ehPagamento = c?.type === "payment" || String(c?.action ?? "").startsWith("payment.");
    return ehPagamento && c.data?.id ? { idNoProvedor: String(c.data.id) } : null;
  }
}
