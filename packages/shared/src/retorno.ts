/**
 * =====================================================================
 * RETORNO, FALTAS, SATISFACAO E PLANILHA (ADR-0027)
 * =====================================================================
 *
 * Regras puras, usadas pela API e pelas telas, para os dois lados nunca
 * discordarem.
 *
 * RETORNO SEM CUSTO - Resolucao CFM 1.958/2010:
 *   art. 1, par. 1  quando ha exames que nao puderam ser vistos na consulta,
 *                   o ato continua, "com tempo determinado a criterio do
 *                   medico, nao gerando cobranca de honorario".
 *   art. 1, par. 2  se no retorno aparecem sinais ou sintomas novos, que
 *                   pedem nova anamnese e nova conduta, e CONSULTA NOVA.
 *   art. 2          doenca de tratamento prolongado: as reavaliacoes podem
 *                   ser cobradas, a criterio do medico.
 *
 * Por isso: quem libera o retorno e o MEDICO, no prazo que ele escolher, ate
 * o maximo que a plataforma aceita. O retorno e com o mesmo medico, sem
 * custo, e nao tem retorno proprio.
 */

/** Maior prazo que a administracao pode configurar (90 dias). */
export const PRAZO_DE_RETORNO_TETO_DIAS = 90;

/** Depois de quantos minutos do horario marcado ja se pode registrar falta. */
export const TOLERANCIA_DE_FALTA_MINUTOS = 15;

/** O medico pode liberar este prazo? (1 dia ate o maximo da plataforma) */
export function prazoDeRetornoValido(dias: number, maximoDaPlataforma: number): boolean {
  return Number.isInteger(dias) && dias >= 1 && dias <= Math.min(maximoDaPlataforma, PRAZO_DE_RETORNO_TETO_DIAS);
}

/** A data-limite do retorno: o fim do ultimo dia do prazo, contado a partir de agora. */
export function retornoAte(agora: Date, dias: number): Date {
  return new Date(agora.getTime() + dias * 86400000);
}

/** Ja passou a tolerancia para dizer que alguem faltou? */
export function podeRegistrarFalta(inicio: Date, agora: Date): boolean {
  return agora.getTime() >= inicio.getTime() + TOLERANCIA_DE_FALTA_MINUTOS * 60000;
}

/**
 * NPS (Net Promoter Score): % de notas 9-10 menos % de notas 0-6, de -100 a
 * 100. Sem notas, nulo.
 */
export function calcularNps(notas: number[]): number | null {
  if (notas.length === 0) return null;
  const promotores = notas.filter((n) => n >= 9).length;
  const detratores = notas.filter((n) => n <= 6).length;
  return Math.round(((promotores - detratores) / notas.length) * 100);
}

/** Porcentagem inteira de `parte` em `total` (0 quando nao ha total). */
export function taxa(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

// --- planilha (CSV para o contador) -------------------------------------------

/**
 * Uma celula de CSV no padrao que o Excel brasileiro abre direto: separador
 * ";" e aspas quando preciso. Celula que comeca com = + - @ ganha um apostrofo
 * na frente, para a planilha nao executar formula vinda de um nome digitado
 * (injecao de formula, CWE-1236).
 */
export function celulaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  let s = String(valor);
  if (typeof valor === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function linhaCsv(valores: (string | number | null | undefined)[]): string {
  return valores.map(celulaCsv).join(";");
}

/** 12345 -> "123,45" (numero que o Excel em portugues entende como numero). */
export function centavosParaCsv(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  return `${negativo ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** O arquivo inteiro: BOM (para o Excel ler os acentos) + linhas com CRLF. */
export function montarCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  return "﻿" + [linhaCsv(cabecalho), ...linhas.map(linhaCsv)].join("\r\n") + "\r\n";
}
