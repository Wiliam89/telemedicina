import type { PapelVinculo } from "@tele/shared";

/**
 * Rotulo legivel de cada papel, num lugar so - para nunca divergir entre
 * telas. Fica separado de `clinica.ts` de proposito: aquele arquivo le
 * cookies (so servidor), e este e usado tambem por componentes que rodam
 * no navegador.
 */
export const NOME_DO_PAPEL: Record<PapelVinculo, string> = {
  paciente: "Paciente",
  medico: "Médico(a)",
  recepcao: "Recepção",
  admin_clinica: "Administração",
};

/**
 * A pessoa tem este papel na clinica? Olha TODOS os papeis, nao so o de
 * maior alcance: a medica dona do consultorio e administracao E medico.
 */
export function temPapel(clinica: { papel: PapelVinculo; papeis?: PapelVinculo[] }, ...papeis: PapelVinculo[]): boolean {
  const meus = clinica.papeis ?? [clinica.papel];
  return papeis.some((p) => meus.includes(p));
}
