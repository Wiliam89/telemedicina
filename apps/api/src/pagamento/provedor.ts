/**
 * =====================================================================
 * O CONTRATO DE UM PROVEDOR DE PAGAMENTO
 * =====================================================================
 *
 * Mercado Pago, Pagar.me e Asaas resolvem o mesmo problema com APIs
 * diferentes. Esta interface e o que a plataforma conhece.
 *
 * TRES REGRAS QUE ESTAO NO DESENHO, NAO NA IMPLEMENTACAO:
 *
 * 1. O SPLIT E DO PROVEDOR. Nos dizemos quanto e de cada parte; quem
 *    divide e liquida e ele. Receber o valor cheio e repassar depois
 *    caracterizaria participacao em arranjo de pagamento (Circular BACEN
 *    3.682/2013) e exigiria licenca de Instituicao de Pagamento.
 *
 * 2. NAO TOCAMOS EM DADO DE CARTAO. O navegador tokeniza direto com o
 *    provedor e nos recebe so o token. E o que mantem a plataforma fora do
 *    escopo pesado do PCI DSS - numero de cartao nunca passa pelo nosso
 *    servidor nem entra no nosso log.
 *
 * 3. O ESTADO VEM DO PROVEDOR. "O usuario voltou para a pagina de sucesso"
 *    nao e prova de pagamento. Confirmacao chega por webhook (ou por
 *    consulta a API), nunca pela tela.
 */

export type MetodoPagamento = "pix" | "cartao_credito";

export type StatusNoProvedor = "pendente" | "autorizado" | "confirmado" | "recusado" | "estornado" | "expirado";

export interface CredenciaisDaClinica {
  /** Token OAuth da conta da clinica no provedor (para o split). */
  accessToken: string;
  /** Identificador da conta da clinica. */
  contaId: string;
}

export interface PedidoDeCobranca {
  /** Nossa chave: o provedor nao cria a mesma cobranca duas vezes. */
  chaveIdempotencia: string;
  metodo: MetodoPagamento;
  valorCentavos: number;
  /** Quanto a PLATAFORMA retem. O resto fica com a clinica. */
  comissaoPlataformaCentavos: number;
  descricao: string;
  pagador: { nome: string; email: string; cpf?: string | null };
  /** Cartao: token gerado no navegador. Nunca o numero. */
  tokenDoCartao?: string;
  parcelas?: number;
  /** Pix: quanto tempo a cobranca vale. */
  expiraEmMinutos?: number;
  /** Para onde o provedor avisa a mudanca de estado. */
  urlDeNotificacao: string;
}

export interface Cobranca {
  /** Identificador no provedor. Chave da conciliacao e da idempotencia. */
  idNoProvedor: string;
  status: StatusNoProvedor;
  /** Pix: o "copia e cola" e a imagem do QR em base64. */
  pixCopiaECola?: string | null;
  pixQrBase64?: string | null;
  expiraEm?: Date | null;
  /** Resposta crua, guardada para conciliacao e disputa. */
  bruto: Record<string, unknown>;
}

export interface ProvedorDePagamento {
  readonly nome: string;
  readonly rotulo: string;

  cobrar(credenciais: CredenciaisDaClinica, pedido: PedidoDeCobranca): Promise<Cobranca>;
  /** Consulta o estado atual - usado pelo webhook e pela conciliacao. */
  consultar(credenciais: CredenciaisDaClinica, idNoProvedor: string): Promise<Cobranca>;
  /** Cartao: captura o valor pre-autorizado. */
  capturar(credenciais: CredenciaisDaClinica, idNoProvedor: string): Promise<Cobranca>;
  estornar(credenciais: CredenciaisDaClinica, idNoProvedor: string, valorCentavos?: number): Promise<Cobranca>;
  /**
   * Confere que a notificacao veio mesmo do provedor.
   * Sem isto, qualquer um que descubra a URL do webhook cria pagamento
   * fantasma - e o sistema libera atendimento sem ninguem ter pago.
   */
  conferirNotificacao(cabecalhos: Record<string, string | undefined>, corpoBruto: string, segredo: string): boolean;
  /** Extrai o id do pagamento da notificacao. */
  lerNotificacao(corpo: unknown): { idNoProvedor: string } | null;
}

export class ErroDePagamento extends Error {
  constructor(
    readonly codigo:
      | "CLINICA_SEM_RECEBIMENTO"
      | "TOKEN_VENCIDO"
      | "RECUSADO"
      | "PROVEDOR_INDISPONIVEL"
      | "VALOR_INVALIDO"
      | "FALHA",
    mensagem: string,
  ) {
    super(mensagem);
  }
}
