/**
 * =====================================================================
 * O CONTRATO DE UM PROVEDOR DE ASSINATURA ICP-BRASIL
 * =====================================================================
 *
 * BirdID (Soluti/VaultID), VIDaaS (Valid) e SafeID (Safeweb) resolvem o
 * mesmo problema com APIs diferentes. Esta interface e o que a plataforma
 * conhece; cada provedor vira um adaptador que a implementa.
 *
 * O DESENHO SEGUE O PADRAO DA ASSINATURA EM NUVEM: a plataforma NUNCA
 * envia o documento ao provedor - envia apenas o HASH, em hexadecimal. O
 * documento do paciente nao sai da nossa infraestrutura, o que importa
 * bastante quando o conteudo e dado de saude.
 *
 * O fluxo tem tres passos, e e assim porque o medico precisa autorizar
 * cada assinatura no celular dele:
 *
 *   1. `autorizar`  - a plataforma pede um token ao provedor, usando o CPF
 *                     do medico e o OTP que ele le no aplicativo. O token
 *                     pode valer para uma assinatura (single_signature) ou
 *                     para uma sessao de varias (signature_session).
 *   2. `assinar`    - manda o hash e recebe a assinatura (CMS/PKCS#7) ja
 *                     com carimbo do tempo.
 *   3. a plataforma embute a assinatura no PDF (PAdES) e guarda.
 */

export type EscopoAssinatura = "unica" | "sessao";

export interface CredenciaisDoMedico {
  /** CPF sem pontuacao - e o "usuario" no provedor. */
  cpf: string;
  /** Codigo de 6 digitos lido no aplicativo do certificado. */
  otp: string;
}

export interface Autorizacao {
  token: string;
  /** Instante em que o token deixa de valer. */
  expiraEm: Date;
  escopo: EscopoAssinatura;
}

export interface PedidoDeAssinatura {
  /** Hash do que sera assinado, em hexadecimal minusculo. */
  hashHex: string;
  /** Como o medico vera este item no historico do provedor. */
  descricao: string;
}

export interface AssinaturaPronta {
  /** CMS/PKCS#7 destacado, em base64. E o que se embute no PDF. */
  cmsBase64: string;
  /** Identificador da operacao no provedor - guardado para auditoria. */
  idNoProvedor: string;
  /** Instante do carimbo do tempo, quando o provedor o aplica. */
  carimboEm: Date | null;
  /** Nome e CPF de quem assinou, como constam no certificado. */
  titular: { nome: string; cpf: string } | null;
}

export interface ProvedorDeAssinatura {
  /** "birdid", "vidaas", "safeid", "local_teste". */
  readonly nome: string;
  /** Descricao curta para telas e mensagens de erro. */
  readonly rotulo: string;

  autorizar(credenciais: CredenciaisDoMedico, escopo: EscopoAssinatura): Promise<Autorizacao>;
  assinar(autorizacao: Autorizacao, pedido: PedidoDeAssinatura): Promise<AssinaturaPronta>;
}

/** Erro que a rota traduz para uma mensagem util ao medico. */
export class ErroDoProvedor extends Error {
  constructor(
    readonly codigo:
      | "OTP_INVALIDO"
      | "CERTIFICADO_NAO_ENCONTRADO"
      | "SEM_CREDITOS"
      | "TOKEN_EXPIRADO"
      | "PROVEDOR_INDISPONIVEL"
      | "CPF_DIVERGENTE"
      | "FALHA",
    mensagem: string,
  ) {
    super(mensagem);
  }
}
