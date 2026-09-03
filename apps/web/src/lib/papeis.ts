import type { PapelVinculo } from "@tele/shared";

/**
 * Rotulo legivel de cada papel, num lugar so - para nunca divergir entre
 * telas. Fica separado de `clinica.ts` de proposito: aquele arquivo le
 * cookies (so servidor), e este e usado tambem por componentes que rodam
 * no navegador.
 */
export const NOME_DO_PAPEL: Record<PapelVinculo, string> = {
  paciente: "Paciente",
  medico: "Medico(a)",
  recepcao: "Recepcao",
  admin_clinica: "Administracao",
};
