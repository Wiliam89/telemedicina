/**
 * =====================================================================
 * COBRANCA: CARTAO CADASTRADO OU PIX (ADR-0023)
 * =====================================================================
 *
 * Cadastrar o cartao e opcional.
 *   - Com cartao: o paciente nao paga antes. O valor combinado e debitado
 *     quando o medico encerra a consulta.
 *   - Sem cartao: o Pix aparece antes de a consulta comecar (ao marcar o
 *     horario, ou antes de entrar na fila do atendimento imediato).
 *
 * O texto da autorizacao fica aqui porque a tela precisa mostrar exatamente
 * o texto cuja versao a API registra junto do cartao.
 */

export const VERSAO_DA_AUTORIZACAO_DE_COBRANCA = "2026-11-12";

export const AUTORIZACAO_DE_COBRANCA =
  "Autorizo a plataforma a debitar neste cartão o valor de cada consulta que eu realizar, ao final do atendimento. " +
  "O valor é sempre mostrado antes de eu marcar a consulta ou entrar na fila. " +
  "Posso remover o cartão quando quiser; consultas já realizadas continuam devidas.";

export type FormaDeCobranca = "antecipada" | "cartao_ao_final";

/** O cartao como a pessoa o ve: nunca o numero, so o suficiente para reconhecer. */
export interface CartaoResumo {
  id: string;
  bandeira: string;
  ultimos4: string;
  validadeMes: number;
  validadeAno: number;
  vencido: boolean;
  criadoEm: string;
}

/** O que GET /cartoes devolve. */
export interface MeiosDePagamento {
  cartao: CartaoResumo | null;
  /**
   * Como o navegador transforma o cartao num token, sem que o numero passe
   * pela plataforma: "local_teste" (simulado, so fora de producao) ou o
   * provedor real, com a chave PUBLICA dele.
   */
  tokenizacao: { provedor: string; chavePublica: string | null; disponivel: boolean };
}

/** Uma consulta realizada cuja cobranca no cartao nao passou. */
export interface PendenciaDePagamento {
  consultaId: string;
  realizadaEm: string;
  valorCentavos: number;
  medicoNome: string;
}

/** O cartao esta vencido neste mes/ano? (O cartao vale ate o fim do mes impresso.) */
export function cartaoVencido(validadeMes: number, validadeAno: number, agora: Date = new Date()): boolean {
  const ano = agora.getUTCFullYear();
  const mes = agora.getUTCMonth() + 1;
  return validadeAno < ano || (validadeAno === ano && validadeMes < mes);
}

/** Bandeira pelo inicio do numero. So para exibir; quem valida e o provedor. */
export function bandeiraPeloNumero(numero: string): string {
  const n = numero.replace(/\D/g, "");
  if (/^4/.test(n)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(n)) return "elo";
  if (/^(606282|3841)/.test(n)) return "hipercard";
  return "cartao";
}

/** Digito verificador do cartao (Luhn): pega erro de digitacao antes de chamar o provedor. */
export function numeroDeCartaoValido(numero: string): boolean {
  const n = numero.replace(/\D/g, "");
  if (n.length < 13 || n.length > 19) return false;
  let soma = 0;
  let dobra = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (dobra) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}
