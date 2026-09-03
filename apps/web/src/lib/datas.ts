/**
 * Formatacao de data e hora no fuso DA CLINICA, nao no do computador.
 *
 * Parece detalhe, mas nao e: uma recepcionista viajando, ou um servidor em
 * outro fuso, veria horarios errados - e "errado" aqui significa paciente
 * chegando na hora errada da consulta.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string, opcoes: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const chave = fuso + JSON.stringify(opcoes);
  let f = cache.get(chave);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...opcoes });
    cache.set(chave, f);
  }
  return f;
}

/** "14:30" */
export const hora = (iso: string, fuso: string) => formatador(fuso, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** "quinta-feira, 10 de setembro" */
export const diaPorExtenso = (iso: string, fuso: string) =>
  formatador(fuso, { weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));

/** "10/09/2026" */
export const dataCurta = (iso: string, fuso: string) => formatador(fuso, { dateStyle: "short" }).format(new Date(iso));

/** "AAAA-MM-DD" do dia daquele instante, no fuso da clinica. */
export const diaIso = (data: Date, fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(data);

/** Os proximos N dias a partir de hoje, em "AAAA-MM-DD" no fuso da clinica. */
export function proximosDias(quantidade: number, fuso: string, apartirDe = new Date()): string[] {
  return Array.from({ length: quantidade }, (_, i) => diaIso(new Date(apartirDe.getTime() + i * 86400000), fuso));
}

/** "2026-09-10" -> "qui, 10/09" (rotulo curto para o seletor de dias). */
export function rotuloDoDia(dataIso: string, fuso: string): string {
  const meioDia = new Date(`${dataIso}T12:00:00Z`);
  const partes = formatador(fuso, { weekday: "short", day: "2-digit", month: "2-digit" }).formatToParts(meioDia);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${(p.weekday ?? "").replace(".", "")}, ${p.day}/${p.month}`;
}

/** Rotulo do estado da consulta, para o paciente e para a equipe. */
export const NOME_DO_STATUS: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento",
  agendada: "Agendada",
  em_andamento: "Em andamento",
  concluida: "Concluida",
  cancelada: "Cancelada",
};
