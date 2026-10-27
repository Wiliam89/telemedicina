/**
 * Tipos do prontuario do paciente (ADR-0015): lista de pacientes, ficha
 * clinica, sinais vitais, anexos e a linha do tempo que junta tudo.
 */

export interface PacienteNaLista {
  id: string;
  nomeCompleto: string;
  dataNascimento: string | null;
  idade: number | null;
  telefone: string | null;
  ultimaConsulta: string | null;
  proximaConsulta: string | null;
  totalConsultas: number;
}

export interface PacienteDetalhe extends PacienteNaLista {
  cpf: string | null;
  /** Quem esta olhando pode ler dado clinico? (medico que atende ou o proprio paciente) */
  acessoClinico: boolean;
}

export const TIPOS_SANGUINEOS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type TipoSanguineo = (typeof TIPOS_SANGUINEOS)[number];

export interface DadosDaFicha {
  alergias: string[];
  negaAlergias: boolean;
  medicamentosEmUso: string[];
  comorbidades: string | null;
  antecedentesFamiliares: string | null;
  cirurgiasInternacoes: string | null;
  habitos: string | null;
  tipoSanguineo: TipoSanguineo | null;
  observacoes: string | null;
}

export interface FichaClinicaResumo extends DadosDaFicha {
  versao: number;
  registradoPor: string;
  criadoEm: string;
}

export interface DadosDeSinaisVitais {
  medidoEm?: string;
  pesoKg?: number | null;
  alturaCm?: number | null;
  pressaoSistolica?: number | null;
  pressaoDiastolica?: number | null;
  frequenciaCardiaca?: number | null;
  frequenciaRespiratoria?: number | null;
  temperaturaC?: number | null;
  saturacaoO2?: number | null;
  glicemiaMgDl?: number | null;
  observacao?: string | null;
  consultaId?: string | null;
}

export interface SinalVitalResumo {
  id: string;
  medidoEm: string;
  origem: "profissional" | "paciente";
  registradoPor: string;
  pesoKg: number | null;
  alturaCm: number | null;
  imc: number | null;
  pressaoSistolica: number | null;
  pressaoDiastolica: number | null;
  frequenciaCardiaca: number | null;
  frequenciaRespiratoria: number | null;
  temperaturaC: number | null;
  saturacaoO2: number | null;
  glicemiaMgDl: number | null;
  observacao: string | null;
}

export const CATEGORIAS_DE_ANEXO = {
  exame_laboratorial: "Exame laboratorial",
  exame_imagem: "Exame de imagem",
  laudo: "Laudo",
  receita_externa: "Receita externa",
  outro: "Outro",
} as const;
export type CategoriaAnexo = keyof typeof CATEGORIAS_DE_ANEXO;

export const TIPOS_DE_ARQUIVO_ACEITOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const TAMANHO_MAXIMO_ANEXO = 15 * 1024 * 1024;

export interface AnexoResumo {
  id: string;
  categoria: CategoriaAnexo;
  titulo: string;
  dataDoExame: string | null;
  tipoArquivo: string;
  tamanhoBytes: number;
  origem: "profissional" | "paciente";
  enviadoPor: string;
  criadoEm: string;
}

export type TipoDeEvento = "consulta" | "evolucao" | "documento" | "sinais" | "anexo" | "ficha";

export interface EventoDaLinhaDoTempo {
  tipo: TipoDeEvento;
  id: string;
  em: string;
  titulo: string;
  detalhe: string | null;
  autor: string | null;
  /** Estado curto quando faz sentido (agendada, assinado, rascunho...). */
  estado: string | null;
}

/** IMC com uma casa decimal, ou null se faltar peso ou altura. */
export function calcularImc(pesoKg: number | null | undefined, alturaCm: number | null | undefined): number | null {
  if (!pesoKg || !alturaCm) return null;
  const m = alturaCm / 100;
  return Math.round((pesoKg / (m * m)) * 10) / 10;
}

/** Classificacao do IMC (OMS) para adultos. */
export function classificarImc(imc: number): string {
  if (imc < 18.5) return "Abaixo do peso";
  if (imc < 25) return "Peso adequado";
  if (imc < 30) return "Sobrepeso";
  if (imc < 35) return "Obesidade grau I";
  if (imc < 40) return "Obesidade grau II";
  return "Obesidade grau III";
}

/** Idade completa em anos numa data de referencia (padrao: hoje). */
export function calcularIdade(dataNascimento: string, referencia = new Date()): number {
  const [a, m, d] = dataNascimento.split("-").map(Number) as [number, number, number];
  let idade = referencia.getFullYear() - a;
  const mes = referencia.getMonth() + 1;
  if (mes < m || (mes === m && referencia.getDate() < d)) idade -= 1;
  return idade;
}
