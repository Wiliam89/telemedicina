/**
 * LGPD (ADR-0018): versoes dos textos legais e os pedidos do titular.
 *
 * Mudou o texto dos termos ou da politica? Troque a VERSAO aqui. Quem
 * aceitou a anterior passa a ver o pedido de novo aceite no proximo acesso.
 */
export const VERSOES_LEGAIS = {
  termos_de_uso: "2026-10-26",
  politica_de_privacidade: "2026-10-26",
  telemedicina: "2026-10-26",
} as const;

export type TipoConsentimento = keyof typeof VERSOES_LEGAIS;

export const NOME_DO_CONSENTIMENTO: Record<TipoConsentimento, string> = {
  termos_de_uso: "Termos de uso",
  politica_de_privacidade: "Política de privacidade",
  telemedicina: "Consentimento para atendimento por telemedicina",
};

export const TIPOS_DE_SOLICITACAO = {
  confirmacao_e_acesso: "Confirmar e acessar meus dados",
  correcao: "Corrigir dados incompletos ou errados",
  anonimizacao_ou_exclusao: "Anonimizar ou excluir dados",
  portabilidade: "Portabilidade dos dados",
  informacao_compartilhamento: "Saber com quem meus dados são compartilhados",
  revogacao_consentimento: "Revogar consentimento",
  outro: "Outro pedido",
} as const;
export type TipoSolicitacao = keyof typeof TIPOS_DE_SOLICITACAO;
export type StatusSolicitacao = "aberta" | "em_andamento" | "concluida" | "negada";

/** Art. 19, II: resposta completa em ate 15 dias. */
export const DIAS_PARA_RESPONDER = 15;

export interface ConsentimentoResumo {
  tipo: TipoConsentimento;
  acao: "aceito" | "revogado";
  versao: string;
  criadoEm: string;
}

export interface SolicitacaoResumo {
  id: string;
  tipo: TipoSolicitacao;
  descricao: string;
  status: StatusSolicitacao;
  resposta: string | null;
  respondidoEm: string | null;
  prazo: string;
  criadoEm: string;
  clinica: string | null;
  /** So na visao da clinica: quem pediu. */
  titular?: { id: string; nomeCompleto: string };
}

export interface AcessoAosMeusDados {
  quando: string;
  quem: string | null;
  souEu: boolean;
  clinica: string | null;
  acao: string;
  descricao: string;
}

/** Texto legivel de cada acao da auditoria que envolve dado do titular. */
export const DESCRICAO_DA_ACAO: Record<string, string> = {
  "prontuario.lido": "Consultou seu prontuário",
  "prontuario.ficha_atualizada": "Atualizou sua ficha clínica",
  "prontuario.sinais_registrados": "Registrou sinais vitais",
  "prontuario.anexo_enviado": "Enviou um exame/anexo",
  "prontuario.anexo_baixado": "Abriu um exame/anexo",
  "prontuario.evolucao_criada": "Iniciou uma evolução clínica",
  "prontuario.adendo_registrado": "Registrou um adendo",
  "documento.emitido": "Emitiu um documento",
  "documento.assinado": "Assinou um documento",
  "documento.baixado": "Baixou um documento assinado",
  "consulta.cancelada": "Cancelou uma consulta",
  "lgpd.dados_exportados": "Exportou seus dados (portabilidade)",
};

/**
 * Os consentimentos que faltam: tipo sem aceite na versao atual, ou cujo
 * ultimo registro e uma revogacao.
 */
export function consentimentosPendentes(registros: { tipo: TipoConsentimento; acao: "aceito" | "revogado"; versao: string; criadoEm: string | Date }[]): TipoConsentimento[] {
  const tipos = Object.keys(VERSOES_LEGAIS) as TipoConsentimento[];
  return tipos.filter((tipo) => {
    const ultimo = registros
      .filter((r) => r.tipo === tipo)
      .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())[0];
    return !ultimo || ultimo.acao === "revogado" || ultimo.versao !== VERSOES_LEGAIS[tipo];
  });
}
