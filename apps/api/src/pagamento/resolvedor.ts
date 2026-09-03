/**
 * Qual provedor de pagamento usar, e com quais credenciais.
 *
 * Diferente da assinatura, aqui NAO ha fallback para a plataforma: o
 * dinheiro e da clinica, e o provedor precisa da autorizacao dela (OAuth)
 * para depositar na conta dela. Clinica sem recebimento configurado
 * simplesmente nao cobra - e a mensagem diz isso com todas as letras.
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

export class ResolvedorDePagamento {
  constructor(
    private readonly banco: Banco,
    private readonly ambiente: Ambiente,
  ) {}

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
      if (this.ambiente.NODE_ENV === "production") {
        throw new ErroDePagamento(
          "CLINICA_SEM_RECEBIMENTO",
          "Esta clinica ainda nao conectou uma conta para receber pagamentos. A administracao precisa fazer isso antes de aceitar atendimentos.",
        );
      }
      return {
        provedor: new ProvedorLocalDePagamento(),
        credenciais: { accessToken: "simulado", contaId: "simulado" },
        avisoDeVencimento: null,
      };
    }

    if (!this.ambiente.CHAVE_CRIPTOGRAFIA) {
      throw new ErroDePagamento("FALHA", "CHAVE_CRIPTOGRAFIA nao esta definida em apps/api/.env.");
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
