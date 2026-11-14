/**
 * =====================================================================
 * CREDENCIAMENTO DO MEDICO (ADR-0022)
 * =====================================================================
 *
 * O medico se cadastra, envia os documentos, faz a conferencia de identidade
 * (selfie comparada com a foto do documento) e a administracao decide. So
 * depois de aprovado ele passa a atender.
 *
 * As regras ficam aqui para a tela e a API concordarem sobre o que falta.
 */

export type TipoDeDocumentoDoMedico =
  | "identidade_frente"
  | "identidade_verso"
  | "carteira_crm"
  | "diploma"
  | "titulo_especialista"
  | "comprovante_endereco"
  | "selfie";

export const TIPOS_DE_DOCUMENTO_DO_MEDICO: TipoDeDocumentoDoMedico[] = [
  "identidade_frente",
  "identidade_verso",
  "carteira_crm",
  "diploma",
  "titulo_especialista",
  "comprovante_endereco",
  "selfie",
];

export const NOME_DO_DOCUMENTO_DO_MEDICO: Record<TipoDeDocumentoDoMedico, string> = {
  identidade_frente: "Documento de identidade com foto (frente)",
  identidade_verso: "Documento de identidade (verso)",
  carteira_crm: "Carteira ou cédula do CRM",
  diploma: "Diploma de Medicina",
  titulo_especialista: "Título de especialista ou certificado de residência",
  comprovante_endereco: "Comprovante de endereço",
  selfie: "Foto do rosto (selfie)",
};

export const AJUDA_DO_DOCUMENTO_DO_MEDICO: Record<TipoDeDocumentoDoMedico, string> = {
  identidade_frente: "RG, CNH ou a própria carteira do CRM. A foto precisa estar nítida.",
  identidade_verso: "O verso do mesmo documento.",
  carteira_crm: "Frente da carteira profissional emitida pelo Conselho.",
  diploma: "Frente e verso no mesmo arquivo, se possível.",
  titulo_especialista: "Um para cada especialidade que você quer atender. Obrigatório para a teleconsulta especializada.",
  comprovante_endereco: "Conta de consumo dos últimos 3 meses.",
  selfie: "Tirada agora, com o rosto inteiro, sem óculos escuros nem boné. Ela é comparada com a foto do seu documento.",
};

/** Sempre exigidos. O titulo de especialista entra quando ha especialidade pedida. */
export const DOCUMENTOS_OBRIGATORIOS: TipoDeDocumentoDoMedico[] = ["identidade_frente", "identidade_verso", "carteira_crm", "diploma", "selfie"];

/** Selfie e documentos de identidade so aceitam imagem: sao comparados como foto. */
export const DOCUMENTOS_SO_IMAGEM: TipoDeDocumentoDoMedico[] = ["selfie", "identidade_frente"];

export type StatusDoCredenciamento = "rascunho" | "em_analise" | "pendente_de_ajuste" | "aprovado" | "recusado";

export const NOME_DO_STATUS_DO_CREDENCIAMENTO: Record<StatusDoCredenciamento, string> = {
  rascunho: "Cadastro incompleto",
  em_analise: "Em análise",
  pendente_de_ajuste: "Precisa de ajuste",
  aprovado: "Aprovado",
  recusado: "Recusado",
};

export type StatusDaIdentidade = "pendente" | "aprovada" | "reprovada" | "inconclusiva";

export const NOME_DO_STATUS_DA_IDENTIDADE: Record<StatusDaIdentidade | "nao_iniciada", string> = {
  nao_iniciada: "Não iniciada",
  pendente: "Aguardando conferência",
  aprovada: "Identidade confirmada",
  reprovada: "Identidade não confirmada",
  inconclusiva: "Inconclusiva: precisa de nova foto",
};

/**
 * A selfie e dado biometrico, que a LGPD trata como dado sensivel. O medico
 * le este texto e concorda antes de enviar; a versao fica gravada no pedido.
 * Ao mudar o texto, mude a versao.
 */
export const VERSAO_DO_TERMO_DE_BIOMETRIA = "2026-11-12";

export const TERMO_DE_BIOMETRIA =
  "Para proteger os pacientes e o seu registro profissional, comparamos a foto do seu rosto com a foto do seu documento. " +
  "A imagem é usada somente para confirmar que é você quem está se cadastrando e para repetir essa conferência quando necessário. " +
  "Ela fica guardada com acesso restrito à administração da plataforma, não é usada para nenhum outro fim e a conferência pode ser feita por um serviço especializado contratado pela plataforma. " +
  "Sem essa conferência não é possível atender pela plataforma.";

/** O que falta para o pedido poder ser enviado. Vazio = pode enviar. */
export function pendenciasDoCredenciamento(d: {
  documentos: TipoDeDocumentoDoMedico[];
  especialidadesSolicitadas: string[];
  querProntoAtendimento: boolean;
  temCpf: boolean;
}): string[] {
  const faltas: string[] = [];
  if (!d.temCpf) faltas.push("Informe seu CPF em Minha conta.");
  if (!d.querProntoAtendimento && d.especialidadesSolicitadas.length === 0) {
    faltas.push("Escolha ao menos uma forma de atender: pronto atendimento ou uma especialidade.");
  }
  for (const tipo of DOCUMENTOS_OBRIGATORIOS) {
    if (!d.documentos.includes(tipo)) faltas.push(`Envie: ${NOME_DO_DOCUMENTO_DO_MEDICO[tipo]}.`);
  }
  if (d.especialidadesSolicitadas.length > 0 && !d.documentos.includes("titulo_especialista")) {
    faltas.push(`Envie: ${NOME_DO_DOCUMENTO_DO_MEDICO.titulo_especialista}.`);
  }
  return faltas;
}

export interface DocumentoDoMedicoResumo {
  id: string;
  tipo: TipoDeDocumentoDoMedico;
  tipoArquivo: string;
  tamanhoBytes: number;
  criadoEm: string;
}

export interface VerificacaoDeIdentidadeResumo {
  id: string;
  provedor: string;
  status: StatusDaIdentidade;
  pontuacao: number | null;
  observacao: string | null;
  verificadoPor: string | null;
  criadoEm: string;
}

/** O pedido como o proprio medico o ve. */
export interface MeuCredenciamento {
  id: string | null;
  status: StatusDoCredenciamento;
  especialidadesSolicitadas: string[];
  querProntoAtendimento: boolean;
  rqe: string | null;
  motivo: string | null;
  enviadoEm: string | null;
  decididoEm: string | null;
  /** O documento em vigor de cada tipo (o mais recente). */
  documentos: DocumentoDoMedicoResumo[];
  identidade: VerificacaoDeIdentidadeResumo | null;
  pendencias: string[];
  /** Endereco do servico de fora para fazer a prova de vida, quando houver. */
  urlDaProvaDeVida: string | null;
}

/** O pedido como a administracao o ve. */
export interface CredenciamentoParaAnalise extends Omit<MeuCredenciamento, "pendencias" | "urlDaProvaDeVida"> {
  id: string;
  medico: { id: string; nomeCompleto: string; cpfMascarado: string | null; crm: string; crmUf: string; especialidadeDeclarada: string | null };
  situacaoCrm: "pendente" | "verificado" | "recusado" | "vencido";
  historicoDeIdentidade: VerificacaoDeIdentidadeResumo[];
}
