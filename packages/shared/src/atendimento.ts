/**
 * =====================================================================
 * LINHAS DE ATENDIMENTO E ESPECIALIDADES (ADR-0024)
 * =====================================================================
 *
 * A plataforma atende por duas LINHAS, e cada uma tem dois MODOS:
 *
 *                        imediato (fila)           agendado
 *   pronto_atendimento   clinico geral, agora      clinico geral, com hora
 *   teleconsulta         especialista, agora       especialista, com hora
 *
 * No pronto atendimento o paciente nao escolhe especialidade: e atendido por
 * um clinico geral. Na teleconsulta ele escolhe a especialidade, e so medico
 * com aquela especialidade CONFERIDA o atende.
 *
 * Fica em @tele/shared para a tela e a API concordarem sobre os codigos, os
 * nomes e quem pode atender o que.
 */

export type LinhaDeAtendimento = "pronto_atendimento" | "teleconsulta";
export type ModoDeAtendimento = "imediato" | "agendado";

export const LINHAS_DE_ATENDIMENTO: LinhaDeAtendimento[] = ["pronto_atendimento", "teleconsulta"];

export const NOME_DA_LINHA: Record<LinhaDeAtendimento, string> = {
  pronto_atendimento: "Pronto atendimento",
  teleconsulta: "Teleconsulta",
};

export const DESCRICAO_DA_LINHA: Record<LinhaDeAtendimento, string> = {
  pronto_atendimento: "Clínico geral, para queixas do dia a dia. Sem escolher especialidade.",
  teleconsulta: "Consulta com especialista. Você escolhe a especialidade.",
};

/**
 * Os tipos de preco (enum tipo_atendimento do banco). Os dois primeiros nomes
 * existiam antes das linhas e foram mantidos para nao mexer em dado gravado.
 */
export type TipoDePreco = "agendada" | "pronto_atendimento" | "teleconsulta_imediata" | "pronto_agendado";

export const TIPOS_DE_PRECO: TipoDePreco[] = ["pronto_atendimento", "pronto_agendado", "teleconsulta_imediata", "agendada"];

export const NOME_DO_TIPO_DE_PRECO: Record<TipoDePreco, string> = {
  pronto_atendimento: "Pronto atendimento imediato",
  pronto_agendado: "Pronto atendimento agendado",
  teleconsulta_imediata: "Teleconsulta imediata (especialista)",
  agendada: "Teleconsulta agendada (especialista)",
};

/** Qual linha da tabela de precos vale para esta linha e este modo. */
export function tipoDePreco(linha: LinhaDeAtendimento, modo: ModoDeAtendimento): TipoDePreco {
  if (linha === "pronto_atendimento") return modo === "imediato" ? "pronto_atendimento" : "pronto_agendado";
  return modo === "imediato" ? "teleconsulta_imediata" : "agendada";
}

export interface Especialidade {
  codigo: string;
  nome: string;
}

/**
 * As especialidades medicas reconhecidas no Brasil (lista da Comissao Mista
 * de Especialidades - CFM, AMB e CNRM). O codigo e nosso, estavel e sem
 * acento: e o que fica gravado no banco. Antes de acrescentar ou renomear,
 * confira a resolucao vigente do CFM; nunca reaproveite um codigo.
 */
export const ESPECIALIDADES: Especialidade[] = [
  { codigo: "acupuntura", nome: "Acupuntura" },
  { codigo: "alergia_e_imunologia", nome: "Alergia e Imunologia" },
  { codigo: "anestesiologia", nome: "Anestesiologia" },
  { codigo: "angiologia", nome: "Angiologia" },
  { codigo: "cardiologia", nome: "Cardiologia" },
  { codigo: "cirurgia_cardiovascular", nome: "Cirurgia Cardiovascular" },
  { codigo: "cirurgia_da_mao", nome: "Cirurgia da Mão" },
  { codigo: "cirurgia_de_cabeca_e_pescoco", nome: "Cirurgia de Cabeça e Pescoço" },
  { codigo: "cirurgia_do_aparelho_digestivo", nome: "Cirurgia do Aparelho Digestivo" },
  { codigo: "cirurgia_geral", nome: "Cirurgia Geral" },
  { codigo: "cirurgia_oncologica", nome: "Cirurgia Oncológica" },
  { codigo: "cirurgia_pediatrica", nome: "Cirurgia Pediátrica" },
  { codigo: "cirurgia_plastica", nome: "Cirurgia Plástica" },
  { codigo: "cirurgia_toracica", nome: "Cirurgia Torácica" },
  { codigo: "cirurgia_vascular", nome: "Cirurgia Vascular" },
  { codigo: "clinica_medica", nome: "Clínica Médica" },
  { codigo: "coloproctologia", nome: "Coloproctologia" },
  { codigo: "dermatologia", nome: "Dermatologia" },
  { codigo: "endocrinologia_e_metabologia", nome: "Endocrinologia e Metabologia" },
  { codigo: "endoscopia", nome: "Endoscopia" },
  { codigo: "gastroenterologia", nome: "Gastroenterologia" },
  { codigo: "genetica_medica", nome: "Genética Médica" },
  { codigo: "geriatria", nome: "Geriatria" },
  { codigo: "ginecologia_e_obstetricia", nome: "Ginecologia e Obstetrícia" },
  { codigo: "hematologia_e_hemoterapia", nome: "Hematologia e Hemoterapia" },
  { codigo: "homeopatia", nome: "Homeopatia" },
  { codigo: "infectologia", nome: "Infectologia" },
  { codigo: "mastologia", nome: "Mastologia" },
  { codigo: "medicina_de_emergencia", nome: "Medicina de Emergência" },
  { codigo: "medicina_de_familia_e_comunidade", nome: "Medicina de Família e Comunidade" },
  { codigo: "medicina_do_trabalho", nome: "Medicina do Trabalho" },
  { codigo: "medicina_de_trafego", nome: "Medicina de Tráfego" },
  { codigo: "medicina_esportiva", nome: "Medicina Esportiva" },
  { codigo: "medicina_fisica_e_reabilitacao", nome: "Medicina Física e Reabilitação" },
  { codigo: "medicina_intensiva", nome: "Medicina Intensiva" },
  { codigo: "medicina_legal_e_pericia_medica", nome: "Medicina Legal e Perícia Médica" },
  { codigo: "medicina_nuclear", nome: "Medicina Nuclear" },
  { codigo: "medicina_preventiva_e_social", nome: "Medicina Preventiva e Social" },
  { codigo: "nefrologia", nome: "Nefrologia" },
  { codigo: "neurocirurgia", nome: "Neurocirurgia" },
  { codigo: "neurologia", nome: "Neurologia" },
  { codigo: "nutrologia", nome: "Nutrologia" },
  { codigo: "oftalmologia", nome: "Oftalmologia" },
  { codigo: "oncologia_clinica", nome: "Oncologia Clínica" },
  { codigo: "ortopedia_e_traumatologia", nome: "Ortopedia e Traumatologia" },
  { codigo: "otorrinolaringologia", nome: "Otorrinolaringologia" },
  { codigo: "patologia", nome: "Patologia" },
  { codigo: "patologia_clinica", nome: "Patologia Clínica / Medicina Laboratorial" },
  { codigo: "pediatria", nome: "Pediatria" },
  { codigo: "pneumologia", nome: "Pneumologia" },
  { codigo: "psiquiatria", nome: "Psiquiatria" },
  { codigo: "radiologia_e_diagnostico_por_imagem", nome: "Radiologia e Diagnóstico por Imagem" },
  { codigo: "radioterapia", nome: "Radioterapia" },
  { codigo: "reumatologia", nome: "Reumatologia" },
  { codigo: "urologia", nome: "Urologia" },
];

const POR_CODIGO = new Map(ESPECIALIDADES.map((e) => [e.codigo, e.nome]));

export function especialidadeExiste(codigo: string): boolean {
  return POR_CODIGO.has(codigo);
}

/** O nome para exibir. Codigo desconhecido volta como veio (nunca quebra a tela). */
export function nomeDaEspecialidade(codigo: string | null | undefined): string {
  if (!codigo) return "Clínico geral";
  return POR_CODIGO.get(codigo) ?? codigo;
}

/** Remove repetidos e codigos que nao existem, na ordem da lista oficial. */
export function normalizarEspecialidades(codigos: string[]): string[] {
  const pedidos = new Set(codigos);
  return ESPECIALIDADES.filter((e) => pedidos.has(e.codigo)).map((e) => e.codigo);
}

/** O que do medico decide se ele pode atender um pedido. */
export interface AptidaoDoMedico {
  especialidades: string[];
  atendeProntoAtendimento: boolean;
}

/**
 * Este medico pode atender este pedido? E a regra unica do despacho, da
 * agenda e da lista de medicos: pronto atendimento para quem aceita atender
 * como clinico geral; teleconsulta so para quem tem a especialidade conferida.
 */
export function medicoAtende(medico: AptidaoDoMedico, linha: LinhaDeAtendimento, especialidade: string | null | undefined): boolean {
  if (linha === "pronto_atendimento") return medico.atendeProntoAtendimento;
  return Boolean(especialidade) && medico.especialidades.includes(especialidade!);
}

/** Texto curto de onde o paciente esta esperando: "Pronto atendimento" ou "Teleconsulta - Ortopedia e Traumatologia". */
export function rotuloDoPedido(linha: LinhaDeAtendimento, especialidade: string | null | undefined): string {
  return linha === "pronto_atendimento" ? NOME_DA_LINHA.pronto_atendimento : `${NOME_DA_LINHA.teleconsulta} - ${nomeDaEspecialidade(especialidade)}`;
}

/** Um pedido de atendimento imediato, como o medico online o ve (ADR-0025). */
export interface ChamadoNaFila {
  id: string;
  linha: LinhaDeAtendimento;
  especialidade: string | null;
  pacienteNome: string;
  queixa: string | null;
  entrouEm: string;
  esperandoMinutos: number;
}

/** O que GET /fila/chamados devolve ao medico. */
export interface PainelDeChamados {
  /** Falso = o medico nao esta online; nada chega para ele. */
  online: boolean;
  plantaoId: string | null;
  /** Atendimento que ele aceitou e ainda nao concluiu: vai direto para a sala. */
  emAtendimento: { filaId: string; consultaId: string; pacienteNome: string } | null;
  chamados: ChamadoNaFila[];
}

/** Uma especialidade na vitrine do paciente. */
export interface EspecialidadeDisponivel {
  codigo: string;
  nome: string;
  /** Medicos aptos (CRM e especialidade conferidos). */
  medicos: number;
  /** Quantos deles estao online agora. */
  online: number;
}

/** O que GET /atendimento/opcoes devolve: o que o paciente pode escolher. */
export interface OpcoesDeAtendimento {
  prontoAtendimento: { medicos: number; online: number; valorImediatoCentavos: number | null; valorAgendadoCentavos: number | null };
  especialidades: (EspecialidadeDisponivel & { valorImediatoCentavos: number | null; valorAgendadoCentavos: number | null })[];
}
