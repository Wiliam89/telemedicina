/**
 * =====================================================================
 * ADAPTADOR BIRDID / VAULTID (assinatura em nuvem ICP-Brasil)
 * =====================================================================
 *
 * Escrito conforme a documentacao publica da API. O fluxo, em duas
 * chamadas:
 *
 *   1. POST /oauth/token  - autentica o medico. O "usuario" e o CPF dele
 *      e a "senha" e o OTP de 6 digitos que ele le no aplicativo BirdID.
 *      O escopo pedido define se o token serve para uma assinatura
 *      (single_signature, invalidado apos o uso) ou para uma sessao com
 *      varias (signature_session).
 *
 *   2. POST /api/sign  - envia o HASH em hexadecimal e recebe a
 *      assinatura CMS ja com carimbo do tempo. O documento nunca e
 *      enviado: por isso o prontuario do paciente nao sai daqui.
 *
 * AVISO HONESTO: este adaptador nao pode ser testado sem credenciais
 * (client id e secret cadastrados no portal do provedor, e um certificado
 * ativo). A estrutura, os campos e os erros seguem a documentacao; a
 * primeira execucao real deve ser feita no ambiente de homologacao,
 * seguindo o roteiro do PDF deste modulo.
 */
import { ErroDoProvedor, type AssinaturaPronta, type Autorizacao, type CredenciaisDoMedico, type EscopoAssinatura, type PedidoDeAssinatura, type ProvedorDeAssinatura } from "./provedor.js";

/** OID do SHA-256 - o provedor precisa saber que algoritmo gerou o hash. */
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

export interface ConfigBirdId {
  /** Homologacao ou producao. As URLs sao diferentes. */
  urlBase: string;
  clientId: string;
  clientSecret: string;
  /** Segundos ate o token expirar. */
  duracaoDaSessao?: number;
}

export class ProvedorBirdId implements ProvedorDeAssinatura {
  readonly nome = "birdid";
  readonly rotulo = "BirdID (certificado em nuvem ICP-Brasil)";

  constructor(private readonly config: ConfigBirdId) {}

  /** Basic com base64 de "clientid:clientsecret", como a API exige. */
  private get autorizacaoBasica(): string {
    return `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`;
  }

  private async chamar<T>(caminho: string, corpo: unknown, cabecalhos: Record<string, string>): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(`${this.config.urlBase}${caminho}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...cabecalhos },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ErroDoProvedor("PROVEDOR_INDISPONIVEL", "O servico de assinatura nao respondeu. Tente de novo em instantes.");
    }

    const texto = await resposta.text();
    let dados: Record<string, unknown> = {};
    try {
      dados = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    } catch {
      /* resposta nao-JSON: tratada abaixo pelo status */
    }

    if (!resposta.ok) throw this.traduzirErro(resposta.status, dados);
    return dados as T;
  }

  /** Converte o erro do provedor em algo que o medico entenda na tela. */
  private traduzirErro(status: number, dados: Record<string, unknown>): ErroDoProvedor {
    const detalhe = String(dados["error_description"] ?? dados["message"] ?? dados["error"] ?? "");

    if (status === 401 || /invalid.?(grant|otp|credentials)/i.test(detalhe)) {
      return new ErroDoProvedor("OTP_INVALIDO", "Codigo incorreto ou vencido. Abra o aplicativo do certificado e use o codigo atual.");
    }
    if (/certificate.*not.*found|no.*certificate/i.test(detalhe)) {
      return new ErroDoProvedor("CERTIFICADO_NAO_ENCONTRADO", "Nao encontramos um certificado ativo para este CPF no provedor.");
    }
    if (/credit|saldo|quota|transac/i.test(detalhe)) {
      return new ErroDoProvedor("SEM_CREDITOS", "O certificado esta sem creditos de assinatura. Renove o plano no provedor.");
    }
    if (status === 403) return new ErroDoProvedor("TOKEN_EXPIRADO", "A autorizacao venceu. Peca um novo codigo.");
    if (status >= 500) return new ErroDoProvedor("PROVEDOR_INDISPONIVEL", "O servico de assinatura esta indisponivel no momento.");
    return new ErroDoProvedor("FALHA", detalhe || `O provedor recusou a operacao (HTTP ${status}).`);
  }

  async autorizar(credenciais: CredenciaisDoMedico, escopo: EscopoAssinatura): Promise<Autorizacao> {
    const cpf = credenciais.cpf.replace(/\D/g, "");
    if (!/^\d{11}$/.test(cpf)) throw new ErroDoProvedor("CPF_DIVERGENTE", "CPF invalido.");
    if (!/^\d{6}$/.test(credenciais.otp)) throw new ErroDoProvedor("OTP_INVALIDO", "O codigo do aplicativo tem 6 digitos.");

    const duracao = this.config.duracaoDaSessao ?? 300;
    const resposta = await this.chamar<{ access_token: string; expires_in?: number; token_type?: string }>(
      "/oauth/token",
      {
        grant_type: "password",
        username: cpf,
        password: credenciais.otp,
        scope: escopo === "sessao" ? "signature_session" : "single_signature",
        lifetime: duracao,
      },
      { authorization: this.autorizacaoBasica },
    );

    if (!resposta.access_token) throw new ErroDoProvedor("FALHA", "O provedor nao devolveu o token de assinatura.");

    return {
      token: resposta.access_token,
      expiraEm: new Date(Date.now() + (resposta.expires_in ?? duracao) * 1000),
      escopo,
    };
  }

  async assinar(autorizacao: Autorizacao, pedido: PedidoDeAssinatura): Promise<AssinaturaPronta> {
    if (autorizacao.expiraEm < new Date()) {
      throw new ErroDoProvedor("TOKEN_EXPIRADO", "A autorizacao venceu. Peca um novo codigo no aplicativo.");
    }

    const resposta = await this.chamar<{
      signatures?: { id?: string; raw_signature?: string; signature?: string; timestamp?: string }[];
      id?: string;
    }>(
      "/api/sign",
      {
        // A API aceita varios hashes; mandamos um por vez para que cada
        // documento tenha sua propria autorizacao rastreavel.
        hashes: [
          {
            id: "1",
            alias: pedido.descricao,
            hash: pedido.hashHex,
            hash_algorithm: OID_SHA256,
          },
        ],
        signature_format: "CMS",
        certificate_alias: "default",
      },
      { authorization: `Bearer ${autorizacao.token}` },
    );

    const primeira = resposta.signatures?.[0];
    const cms = primeira?.raw_signature ?? primeira?.signature;
    if (!cms) throw new ErroDoProvedor("FALHA", "O provedor nao devolveu a assinatura.");

    return {
      cmsBase64: cms,
      idNoProvedor: primeira?.id ?? resposta.id ?? "sem-id",
      carimboEm: primeira?.timestamp ? new Date(primeira.timestamp) : null,
      // O titular vem do proprio certificado embutido no CMS; a verificacao
      // o extrai depois de embutir no PDF.
      titular: null,
    };
  }
}
