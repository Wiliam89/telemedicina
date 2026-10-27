/**
 * Verificacao de CRM (ADR-0016): a regra de situacao fica aqui para a API
 * e o site concordarem sobre o que "verificado" quer dizer.
 */

export type SituacaoCrm = "pendente" | "verificado" | "recusado" | "vencido";

/** Uma conferencia vale por um ano: registro pode ser suspenso depois. */
export const DIAS_DE_VALIDADE_CRM = 365;

/** Busca publica e gratuita do Conselho Federal de Medicina. */
export const BUSCA_CFM = "https://portal.cfm.org.br/busca-medicos/";

export interface VerificacaoCrmResumo {
  id: string;
  resultado: "verificado" | "recusado";
  metodo: "consulta_manual_cfm" | "servico_externo";
  crm: string;
  crmUf: string;
  nomeNoConselho: string | null;
  situacaoNoConselho: string | null;
  especialidadesNoConselho: string | null;
  observacao: string | null;
  verificadoPor: string | null;
  validoAte: string | null;
  criadoEm: string;
}

export interface MedicoComCrm {
  id: string;
  nomeCompleto: string;
  crm: string;
  crmUf: string;
  especialidade: string | null;
  situacao: SituacaoCrm;
  historico: VerificacaoCrmResumo[];
}

export const NOME_DA_SITUACAO_CRM: Record<SituacaoCrm, string> = {
  pendente: "Aguardando verificação",
  verificado: "CRM verificado",
  recusado: "CRM recusado",
  vencido: "Verificação vencida",
};

/** A situacao vem da conferencia MAIS RECENTE (ou da falta dela). */
export function situacaoDoCrm(ultima: { resultado: "verificado" | "recusado"; validoAte: string | Date | null } | null | undefined, agora = new Date()): SituacaoCrm {
  if (!ultima) return "pendente";
  if (ultima.resultado === "recusado") return "recusado";
  if (!ultima.validoAte || new Date(ultima.validoAte).getTime() < agora.getTime()) return "vencido";
  return "verificado";
}
