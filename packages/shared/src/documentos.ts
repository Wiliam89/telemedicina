/**
 * =====================================================================
 * MONTAGEM E VALIDACAO DE DOCUMENTOS
 * =====================================================================
 *
 * Fica em @tele/shared, e nao na API, pelo mesmo motivo do calculo de
 * horarios: o texto que o paciente ve na tela tem de ser BYTE A BYTE o
 * texto cujo hash foi guardado. Se o site montasse o seu e a API o dela,
 * a validacao publica acusaria adulteracao onde nao houve.
 *
 * O hash e do TEXTO CANONICO - uma forma unica e sem ambiguidade do
 * documento. Espacos, ordem dos campos e quebras de linha entram na conta,
 * entao tudo isso e definido aqui, em um lugar so.
 */

export type TipoDocumento =
  | "receita_simples"
  | "receita_controle_especial"
  | "atestado"
  | "pedido_exame"
  | "relatorio"
  | "declaracao_comparecimento";

export const NOME_DO_TIPO: Record<TipoDocumento, string> = {
  receita_simples: "Receita",
  receita_controle_especial: "Receita de Controle Especial",
  atestado: "Atestado Medico",
  pedido_exame: "Pedido de Exame",
  relatorio: "Relatorio Medico",
  declaracao_comparecimento: "Declaracao de Comparecimento",
};

export interface ItemReceita {
  medicamento: string;
  /** "1 comprimido de 8 em 8 horas por 7 dias" */
  posologia: string;
  quantidade?: string | undefined;
}

export interface ConteudoDocumento {
  /** receita: itens; atestado: dias e CID; exame: lista; relatorio: texto. */
  itens?: ItemReceita[] | undefined;
  diasAfastamento?: number | undefined;
  cid10?: string | undefined;
  exames?: string[] | undefined;
  texto?: string | undefined;
  /** Vale para todos: orientacoes ao paciente. */
  observacoes?: string | undefined;
}

export interface DadosDoDocumento {
  tipo: TipoDocumento;
  ano: number;
  numero: number;
  emitidoEm: string;
  clinica: { nomeFantasia: string; cnpj: string };
  medico: { nomeCompleto: string; crm: string; crmUf: string; especialidade?: string | null | undefined };
  paciente: { nomeCompleto: string; cpf?: string | null | undefined; dataNascimento?: string | null | undefined };
  conteudo: ConteudoDocumento;
  codigoValidacao: string;
}

/** "12345678901" -> "123.456.789-01" */
function formatarCpf(cpf: string): string {
  return cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
}

function formatarCnpj(cnpj: string): string {
  return cnpj.length === 14 ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}` : cnpj;
}

/**
 * O texto do documento, exatamente como sera impresso e como sera
 * verificado. Determinista: os mesmos dados produzem sempre o mesmo texto.
 */
export function montarTextoDocumento(d: DadosDoDocumento): string {
  const linhas: string[] = [];
  const sep = "-".repeat(64);

  linhas.push(d.clinica.nomeFantasia.toUpperCase());
  linhas.push(`CNPJ ${formatarCnpj(d.clinica.cnpj)}`);
  linhas.push(sep);
  linhas.push(NOME_DO_TIPO[d.tipo].toUpperCase());
  linhas.push(`No ${d.numero}/${d.ano}`);
  linhas.push(sep);
  linhas.push(`Paciente: ${d.paciente.nomeCompleto}`);
  if (d.paciente.cpf) linhas.push(`CPF: ${formatarCpf(d.paciente.cpf)}`);
  if (d.paciente.dataNascimento) linhas.push(`Nascimento: ${d.paciente.dataNascimento}`);
  linhas.push(sep);

  const c = d.conteudo;
  if (c.itens?.length) {
    linhas.push("PRESCRICAO");
    c.itens.forEach((item, i) => {
      linhas.push(`${i + 1}. ${item.medicamento}${item.quantidade ? ` - ${item.quantidade}` : ""}`);
      linhas.push(`   ${item.posologia}`);
    });
  }
  if (typeof c.diasAfastamento === "number") {
    linhas.push(`Atesto, para os devidos fins, o afastamento de ${d.paciente.nomeCompleto}`);
    linhas.push(`por ${c.diasAfastamento} dia(s), a partir de ${d.emitidoEm.slice(0, 10)}.`);
  }
  if (c.exames?.length) {
    linhas.push("EXAMES SOLICITADOS");
    c.exames.forEach((e, i) => linhas.push(`${i + 1}. ${e}`));
  }
  if (c.texto) linhas.push(c.texto);
  // O CID so entra quando o paciente autoriza (art. 76 do Codigo de Etica
  // Medica): quem decide e a tela, que so manda o campo se houver consentimento.
  if (c.cid10) linhas.push(`CID-10: ${c.cid10}`);
  if (c.observacoes) {
    linhas.push("");
    linhas.push(`Observacoes: ${c.observacoes}`);
  }

  linhas.push(sep);
  linhas.push(`${d.medico.nomeCompleto}`);
  linhas.push(`CRM ${d.medico.crm}-${d.medico.crmUf}${d.medico.especialidade ? ` | ${d.medico.especialidade}` : ""}`);
  linhas.push(`Emitido em ${d.emitidoEm}`);
  linhas.push(`Codigo de validacao: ${d.codigoValidacao}`);

  // \n sempre, nunca \r\n: o hash nao pode depender do sistema operacional.
  return linhas.join("\n");
}

/**
 * Codigo de validacao legivel: sem 0/O nem 1/I/L, que a pessoa erra ao
 * digitar do papel. 12 caracteres em blocos de 4.
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function gerarCodigoValidacao(sorteio: (max: number) => number): string {
  const letras = Array.from({ length: 12 }, () => ALFABETO[sorteio(ALFABETO.length)]);
  return `${letras.slice(0, 4).join("")}-${letras.slice(4, 8).join("")}-${letras.slice(8).join("")}`;
}

/** Aceita com ou sem hifen, maiusculo ou minusculo. */
export function normalizarCodigo(codigo: string): string {
  const limpo = codigo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return limpo.length === 12 ? `${limpo.slice(0, 4)}-${limpo.slice(4, 8)}-${limpo.slice(8)}` : limpo;
}

/** O que a validacao PUBLICA devolve: prova autenticidade sem expor clinica. */
export interface ResultadoValidacao {
  valido: boolean;
  tipo?: string;
  numero?: string;
  emitidoEm?: string;
  /** Iniciais apenas: "M. S. O." - confirma sem identificar. */
  pacienteIniciais?: string;
  medico?: { nomeCompleto: string; crm: string; crmUf: string };
  clinica?: string;
  assinado?: boolean;
  assinadoEm?: string | null;
  hash?: string;
  motivo?: string;
}

/** "Maria Silva Oliveira" -> "M. S. O." */
export function iniciaisDoNome(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]/.test(p))
    .map((p) => `${p[0]?.toUpperCase()}.`)
    .join(" ");
}
