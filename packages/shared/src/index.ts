import type { SituacaoCrm } from "./crm.js";
import type { TipoConsentimento } from "./lgpd.js";
import type { LinhaDeAtendimento } from "./atendimento.js";
import type { FormaDeCobranca } from "./cobranca.js";
import type { StatusDoCredenciamento } from "./credenciamento.js";

export type { Indicadores } from "./indicadores.js";

/**
 * @tele/shared - tipos e regras que o site (apps/web) e a API (apps/api)
 * usam juntos.
 *
 * Por que existe: se a API mudar o formato de uma resposta e o site nao
 * souber, o erro aparece na frente do paciente. Compartilhando o tipo, o
 * erro aparece no editor, antes de rodar.
 *
 * Os tipos das TABELAS (Perfil, Consulta...) nao ficam aqui: eles nascem do
 * schema em packages/db e sao exportados de la (`import { Consulta } from
 * "@tele/db"`). Aqui ficam so os formatos de resposta da API.
 */

/** Toda resposta de sucesso da API tem este formato. */
export interface RespostaOk<T> {
  ok: true;
  dados: T;
}

/** Toda resposta de erro da API tem este formato. */
export interface RespostaErro {
  ok: false;
  erro: {
    codigo: string;
    mensagem: string;
    detalhes?: unknown;
  };
}

export type Resposta<T> = RespostaOk<T> | RespostaErro;

/** O que a rota GET /saude devolve. O site usa isto para acender as luzes. */
export interface StatusSaude {
  /**
   * Este ambiente produz documento com valor legal? Falso quando a
   * assinatura esta em modo de teste - o site mostra tarja avisando.
   */
  documentosComValorLegal?: boolean;
  /**
   * Este ambiente faz videochamada de verdade? Falso quando o provedor de
   * video esta simulado - o site mostra tarja avisando (Modulo 12).
   */
  videoReal?: boolean;
  api: "no_ar";
  supabase: "conectado" | "falhou";
  /** Modulo 3: o Postgres responde e as migracoes estao aplicadas? */
  banco: {
    estado: "migrado" | "faltam_migracoes" | "sem_tabelas" | "falhou";
    migracoesAplicadas: number;
    migracoesEsperadas: number;
    tabelas: string[];
  };
  /** Modulo 4: RLS ligado nas 5 tabelas, politicas presentes, auditoria protegida? */
  seguranca: {
    estado: "protegido" | "incompleto" | "desconhecido";
    tabelasSemRls: string[];
    politicas: number;
  };
  versao: string;
  horario: string;
}

/**
 * Os TIPOS da agenda ficam disponiveis aqui (o site so precisa deles).
 * As FUNCOES vivem em "@tele/shared/agenda", importadas so pela API:
 * reexportar valores daqui obrigaria o empacotador do site a resolver o
 * arquivo, e ele nao lida com o sufixo .js que o Node exige.
 */
export type { BlocoDaGrade, EntradaHorarios, HorarioLivre, Periodo } from "./agenda.js";

/**
 * Os tipos dos documentos ficam aqui; as funcoes de montagem e hash vivem
 * em "@tele/shared/documentos" - mesmo motivo da agenda.
 */
/**
 * O termo de telemedicina vive em "@tele/shared/consentimento" - subcaminho
 * proprio, importado tanto pela tela quanto pela API. Nao e reexportado
 * daqui porque o empacotador do site nao resolve o sufixo .js que o Node
 * exige nos reexports (mesmo motivo da agenda e dos documentos).
 */

export type {
  ConteudoDocumento,
  DadosDoDocumento,
  ItemReceita,
  ResultadoValidacao,
  TipoDocumento,
} from "./documentos.js";

/**
 * Os tipos da sala de video ficam aqui; a REGRA de quando a sala abre vive
 * em "@tele/shared/video", usada pela API e pela tela - mesmo motivo da
 * agenda e dos documentos.
 */
export type { DecisaoDeEntrada, EntradaNaSala, MotivoDeRecusa, StatusParaVideo } from "./video.js";

export type {
  AnexoResumo,
  CategoriaAnexo,
  DadosDaFicha,
  DadosDeSinaisVitais,
  EventoDaLinhaDoTempo,
  FichaClinicaResumo,
  PacienteDetalhe,
  PacienteNaLista,
  SinalVitalResumo,
  TipoDeEvento,
  TipoSanguineo,
} from "./prontuario.js";

export type { MedicoComCrm, SituacaoCrm, VerificacaoCrmResumo } from "./crm.js";

/** As funcoes vivem em "@tele/shared/atendimento", "/credenciamento" e "/cobranca". */
export type {
  ChamadoNaFila,
  Especialidade,
  EspecialidadeDisponivel,
  LinhaDeAtendimento,
  ModoDeAtendimento,
  OpcoesDeAtendimento,
  PainelDeChamados,
  TipoDePreco,
} from "./atendimento.js";
export type {
  CredenciamentoParaAnalise,
  DocumentoDoMedicoResumo,
  MeuCredenciamento,
  StatusDaIdentidade,
  StatusDoCredenciamento,
  TipoDeDocumentoDoMedico,
  VerificacaoDeIdentidadeResumo,
} from "./credenciamento.js";
export type { CartaoResumo, FormaDeCobranca, MeiosDePagamento, PendenciaDePagamento } from "./cobranca.js";

/**
 * GET /plataforma (publica): a plataforma opera como UMA clinica (ADR-0022)?
 * Quando sim, ninguem escolhe nem cria clinica: todo mundo entra nesta.
 */
export interface PlataformaPublica {
  /** Verdadeiro = modo plataforma unica. Falso = varias clinicas (modo antigo). */
  unica: boolean;
  slug: string | null;
  nome: string | null;
  /** A clinica da plataforma ja foi criada pela administracao? */
  configurada: boolean;
  aceitandoPacientes: boolean;
}

export type {
  AcessoAosMeusDados,
  ConsentimentoResumo,
  SolicitacaoResumo,
  StatusSolicitacao,
  TipoConsentimento,
  TipoSolicitacao,
} from "./lgpd.js";

/** O que a pessoa e DENTRO de uma clinica (Modulo 6). Espelha o enum papel_vinculo. */
export type PapelVinculo = "paciente" | "medico" | "recepcao" | "admin_clinica";

export type StatusClinica = "em_implantacao" | "ativa" | "suspensa" | "encerrada";

/** Uma clinica onde a pessoa logada tem vinculo ativo. */
export interface ClinicaResumo {
  id: string;
  slug: string;
  nomeFantasia: string;
  status: StatusClinica;
  /** Fuso IANA: define a hora local da agenda desta clinica. */
  fusoHorario: string;
  /** O papel mais forte que a pessoa tem nesta clinica. */
  papel: PapelVinculo;
  /** Todos os papeis da pessoa nesta clinica (medico E administracao, por ex.). */
  papeis?: PapelVinculo[];
  /** So para quem e medico nesta clinica: a conferencia do CRM (ADR-0016). */
  situacaoCrm?: SituacaoCrm;
}

/** O que GET /perfis/eu e POST /perfis devolvem: a PESSOA e onde ela atua. */
export interface PerfilResposta {
  id: string;
  nomeCompleto: string;
  telefone: string | null;
  cpf: string | null;
  criadoEm: string;
  medico: { crm: string; crmUf: string; especialidade: string | null; especialidades?: string[]; atendeProntoAtendimento?: boolean } | null;
  paciente: { dataNascimento: string } | null;
  /** Medico que pediu para atender na plataforma: em que pe esta (ADR-0022). */
  credenciamento?: StatusDoCredenciamento | null;
  /** Vazio quando a pessoa ainda nao entrou em nenhuma clinica. */
  clinicas: ClinicaResumo[];
  /** Termos/politica/telemedicina sem aceite na versao atual (ADR-0018). */
  consentimentosPendentes: TipoConsentimento[];
}

/** Um item de GET /medicos (dentro de uma clinica). */
export interface MedicoResumo {
  id: string;
  nomeCompleto: string;
  crm: string;
  crmUf: string;
  especialidade: string | null;
  /** Especialidades conferidas (codigos de @tele/shared/atendimento). */
  especialidades?: string[];
  atendeProntoAtendimento?: boolean;
  situacaoCrm: SituacaoCrm;
}

/** Um item de GET /membros (a equipe da clinica atual). */
export interface MembroResumo {
  vinculoId: string;
  perfilId: string;
  nomeCompleto: string;
  /** Uma pessoa pode acumular papeis na mesma clinica (medica e admin). */
  papeis: PapelVinculo[];
  status: "ativo" | "suspenso" | "encerrado";
  desde: string;
}

/** Um convite pendente, como o admin o ve. */
export interface ConviteResumo {
  id: string;
  email: string;
  papel: PapelVinculo;
  status: "pendente" | "aceito" | "revogado" | "expirado";
  expiraEm: string;
  criadoEm: string;
}

/** O que POST /convites devolve: o convite e o link para entregar a pessoa. */
export interface ConviteCriado extends ConviteResumo {
  /** Aparece UMA vez, na criacao. Depois so o hash fica no banco. */
  linkDeAceite: string;
}

/** Um bloco da grade semanal, como o site o exibe (HH:MM, sem segundos). */
export interface DisponibilidadeResumo {
  id: string;
  diaSemana: number;
  horaInicio: string;
  horaFim: string;
  duracaoMinutos: number;
}

export type StatusConsulta = "aguardando_pagamento" | "agendada" | "em_andamento" | "concluida" | "cancelada";

/** Uma consulta como as telas de agenda a mostram. */
export interface ConsultaResumo {
  id: string;
  inicio: string;
  fim: string;
  status: StatusConsulta;
  motivo: string | null;
  paciente: { id: string; nomeCompleto: string };
  medico: { id: string; nomeCompleto: string; especialidade: string | null; crm: string; crmUf: string };
  motivoCancelamento: string | null;
  /** ADR-0024: pronto atendimento (clinico geral) ou teleconsulta (especialista). */
  linha?: LinhaDeAtendimento;
  /** Codigo da especialidade da consulta (so na teleconsulta). */
  especialidadeDaConsulta?: string | null;
  /** ADR-0023: Pix antes, ou cartao cadastrado debitado ao final. */
  formaDeCobranca?: FormaDeCobranca;
  valorCombinadoCentavos?: number | null;
}

/** Nome de cada dia da semana, indexado por 0-6 (domingo a sabado). */
export const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export type StatusEvolucao = "rascunho" | "finalizada";

/** Uma evolucao como as telas a mostram. */
export interface EvolucaoResumo {
  id: string;
  status: StatusEvolucao;
  subjetivo: string | null;
  objetivo: string | null;
  avaliacao: string | null;
  plano: string | null;
  cid10: string | null;
  adendoDe: string | null;
  medico: { id: string; nomeCompleto: string; crm: string; crmUf: string };
  consultaId: string;
  finalizadaEm: string | null;
  criadoEm: string;
}

export type StatusDocumento = "emitido" | "assinado" | "cancelado";

/** Um documento como as telas o mostram. */
export interface DocumentoResumo {
  id: string;
  tipo: string;
  status: StatusDocumento;
  ano: number;
  numero: number;
  codigoValidacao: string;
  hash: string;
  textoImpresso: string;
  assinadoEm: string | null;
  motivoCancelamento: string | null;
  criadoEm: string;
  medico: { nomeCompleto: string; crm: string; crmUf: string };
  paciente: { nomeCompleto: string };
}
