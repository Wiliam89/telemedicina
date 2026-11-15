/**
 * =====================================================================
 * AREA DA ADMINISTRACAO (ADR-0026)
 * =====================================================================
 *
 * Os formatos que a API devolve para as telas de gestao da plataforma. So
 * numeros e dados cadastrais: a administracao gere a plataforma, nao le
 * prontuario (LGPD, art. 6, III).
 */

/** 7000 -> "70%"; 7250 -> "72,5%". */
export function formatarPercentual(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  const v = bps / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}%`;
}

/** "72,5" ou "72.5" ou "72,5%" -> 7250. Fora de 0-100 ou mais de 2 casas -> null. */
export function lerPercentual(texto: string): number | null {
  const limpo = texto.replace("%", "").trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpo)) return null;
  const bps = Math.round(Number(limpo) * 100);
  return bps >= 0 && bps <= 10000 ? bps : null;
}

/** O resumo do painel da administracao. */
export interface ResumoDaAdministracao {
  plataforma: { nome: string; repassePadraoBps: number | null; recebimentoConfigurado: boolean };
  hoje: { consultas: number; concluidas: number; naFila: number; medicosOnline: number };
  ultimos30dias: { receitaCentavos: number; repasseCentavos: number; consultasConcluidas: number; pacientesNovos: number };
  pendencias: {
    credenciamentos: number;
    reembolsos: number;
    pagamentosDePacientes: number;
    pedidosLgpd: number;
    medicosSemPercentual: number;
    crmVencendo: number;
  };
  saldoTotalARepassarCentavos: number;
}

export interface MedicoNaAdministracao {
  id: string;
  nomeCompleto: string;
  crm: string;
  crmUf: string;
  situacaoCrm: "pendente" | "verificado" | "recusado" | "vencido";
  especialidades: string[];
  atendeProntoAtendimento: boolean;
  online: boolean;
  status: "ativo" | "suspenso" | "encerrado";
  /** A porcentagem propria dele; nula = usa a padrao. */
  percentualProprioBps: number | null;
  percentualEmVigorBps: number | null;
  ultimos30dias: { consultas: number; faturadoCentavos: number; repasseCentavos: number };
  saldoCentavos: number;
}

export interface LinhaFinanceira {
  medicoId: string;
  medicoNome: string;
  consultas: number;
  faturadoCentavos: number;
  repasseCentavos: number;
  /** Saldo de sempre (nao so do periodo): o que falta pagar a ele. */
  saldoCentavos: number;
}

export interface RepasseRegistrado {
  id: string;
  medicoId: string;
  medicoNome: string;
  valorCentavos: number;
  pagoEm: string;
  referencia: string;
  observacao: string | null;
  registradoPor: string;
  cancelado: { em: string; por: string; motivo: string } | null;
}

export interface PendenciaDeReembolso {
  pagamentoId: string;
  valorCentavos: number;
  metodo: string;
  motivo: string;
  pacienteNome: string;
  desde: string;
}

export interface Financeiro {
  periodo: { de: string; ate: string };
  receitaBrutaCentavos: number;
  estornadoCentavos: number;
  repasseDoPeriodoCentavos: number;
  /** receita - repasse do periodo: o que fica com a plataforma (antes das taxas do provedor). */
  margemCentavos: number;
  porMedico: LinhaFinanceira[];
  repasses: RepasseRegistrado[];
  reembolsosPendentes: PendenciaDeReembolso[];
  /** Consultas realizadas cuja cobranca no cartao do paciente nao passou (ADR-0023). */
  cobrancasRecusadas: { consultaId: string; pacienteNome: string; valorCentavos: number; realizadaEm: string }[];
}

export interface EventoDeAuditoria {
  id: string;
  quando: string;
  acao: string;
  descricao: string;
  quem: string | null;
  tabela: string;
  registroId: string;
}

/** O que o proprio medico ve sobre os seus ganhos. */
export interface MeusGanhos {
  percentualEmVigorBps: number | null;
  doMes: { consultas: number; faturadoCentavos: number; repasseCentavos: number };
  ganhoTotalCentavos: number;
  pagoCentavos: number;
  saldoCentavos: number;
  repasses: Omit<RepasseRegistrado, "medicoId" | "medicoNome" | "registradoPor">[];
}

/** ADR-0027: um paciente como a administracao o ve. So cadastro e numeros, nunca dado clinico. */
export interface PacienteNaAdministracao {
  id: string;
  nomeCompleto: string;
  /** Mascarado: ***.456.789-** */
  cpfMascarado: string | null;
  telefone: string | null;
  cadastradoEm: string;
  consultasConcluidas: number;
  faltas: number;
  /** Consultas concluidas com cartao recusado e nao pagas. */
  pagamentosPendentes: number;
  restricao: { motivo: string; desde: string } | null;
}

/** ADR-0027: indicadores de qualidade do periodo. */
export interface IndicadoresDeQualidade {
  periodo: { de: string; ate: string };
  consultasQueDeviamAcontecer: number;
  faltasDoPaciente: number;
  faltasDoMedico: number;
  /** % das consultas que deviam acontecer. */
  taxaDeFaltaDoPaciente: number;
  taxaDeFaltaDoMedico: number;
  canceladas: number;
  fila: { entradas: number; atendidas: number; desistencias: number; taxaDeDesistencia: number };
  retornos: { liberados: number; marcados: number };
  satisfacao: { respostas: number; nps: number | null; media: number | null; promotores: number; neutros: number; detratores: number };
  porMedico: { medicoId: string; nome: string; respostas: number; nps: number | null; faltasDoMedico: number }[];
  comentarios: { nota: number; comentario: string; criadoEm: string }[];
}

/** Rotulo legivel das acoes de auditoria mais comuns. As demais aparecem como estao. */
export const NOME_DA_ACAO: Record<string, string> = {
  "clinica.criada": "Plataforma configurada",
  "clinica.configuracoes_alteradas": "Configurações alteradas",
  "precos.alterados": "Valores alterados",
  "repasse.percentual_alterado": "Porcentagem de médico alterada",
  "repasse.percentual_padrao_alterado": "Porcentagem padrão alterada",
  "repasse.registrado": "Repasse registrado",
  "repasse.cancelado": "Repasse cancelado",
  "pagamento.reembolsado": "Reembolso feito",
  "credenciamento.aprovado": "Credenciamento aprovado",
  "credenciamento.recusado": "Credenciamento recusado",
  "credenciamento.pendente_de_ajuste": "Credenciamento: ajuste pedido",
  "credenciamento.documento_lido": "Documento de médico aberto",
  "identidade.confirmada": "Identidade de médico confirmada",
  "identidade.nao_confirmada": "Identidade de médico não confirmada",
  "crm.verificado": "CRM verificado",
  "crm.recusado": "CRM recusado",
  "membro.suspenso": "Membro da equipe suspenso",
  "membro.reativado": "Membro da equipe reativado",
  "convite.criado": "Convite criado",
  "medico.atendimento_alterado": "Atendimento do médico alterado",
  "prontuario.lido": "Prontuário aberto",
  "lgpd.dados_exportados": "Dados pessoais exportados",
  "consulta.retorno_liberado": "Retorno sem custo liberado",
  "consulta.falta_registrada": "Falta registrada",
  "consulta.avaliada": "Consulta avaliada pelo paciente",
  "paciente.restringido": "Paciente impedido de marcar",
  "paciente.restricao_encerrada": "Paciente liberado para marcar",
  "financeiro.planilha_exportada": "Planilha financeira baixada",
  "clinica.regras_de_retorno_alteradas": "Prazo de retorno alterado",
};
