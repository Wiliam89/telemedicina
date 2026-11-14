/**
 * =====================================================================
 * CREDENCIAMENTO DO MEDICO (ADR-0022)
 * =====================================================================
 *
 * Na plataforma que e a propria clinica, o medico nao chega por convite: ele
 * se cadastra e PEDE para atender. Ate a administracao aprovar, ele e so
 * mais uma conta - nao ve paciente, agenda nem fila.
 *
 * O pedido junta tres provas:
 *   1. os DOCUMENTOS (identidade, carteira do CRM, diploma, titulo de
 *      especialista, comprovante de endereco);
 *   2. a IDENTIDADE: a selfie comparada com a foto do documento, para que
 *      ninguem atenda com o CRM de outra pessoa;
 *   3. o CRM conferido no Conselho (ADR-0016, que continua valendo).
 *
 * Tres tabelas:
 *   credenciamentos_medicos      o pedido e a decisao
 *   documentos_do_medico         os arquivos (somente insercao)
 *   verificacoes_de_identidade   cada conferencia facial (somente insercao)
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";
import { perfis } from "./perfis.js";

export const statusCredenciamentoEnum = pgEnum("status_credenciamento", ["rascunho", "em_analise", "pendente_de_ajuste", "aprovado", "recusado"]);

export const credenciamentosMedicos = pgTable(
  "credenciamentos_medicos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    status: statusCredenciamentoEnum("status").notNull().default("rascunho"),
    /** O que o medico pede para atender (codigos de especialidade). */
    especialidadesSolicitadas: text("especialidades_solicitadas").array().notNull().default(sql`'{}'::text[]`),
    querProntoAtendimento: boolean("quer_pronto_atendimento").notNull().default(true),
    /** Numero do registro de especialista (RQE), como o medico informou. */
    rqe: text("rqe"),
    /**
     * A selfie e dado biometrico (LGPD, art. 5, II). Guardamos quando o
     * medico concordou com o uso dela na conferencia, e a versao do texto.
     */
    consentimentoBiometriaEm: timestamp("consentimento_biometria_em", { withTimezone: true }),
    consentimentoBiometriaVersao: text("consentimento_biometria_versao"),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    decididoEm: timestamp("decidido_em", { withTimezone: true }),
    decididoPor: uuid("decidido_por").references(() => perfis.id, { onDelete: "restrict" }),
    /** Motivo da recusa, ou o que precisa ser ajustado. */
    motivo: text("motivo"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Um pedido por medico em cada clinica: reenviar atualiza o mesmo.
    uniqueIndex("credenciamentos_medico_clinica").on(t.medicoId, t.clinicaId),
    index("credenciamentos_clinica_status").on(t.clinicaId, t.status),
    check("credenciamentos_decisao_completa", sql`${t.status} not in ('aprovado', 'recusado', 'pendente_de_ajuste') or (${t.decididoEm} is not null and ${t.decididoPor} is not null)`),
    check("credenciamentos_recusa_explicada", sql`${t.status} not in ('recusado', 'pendente_de_ajuste') or length(trim(coalesce(${t.motivo}, ''))) >= 5`),
    check("credenciamentos_envio", sql`${t.status} = 'rascunho' or ${t.enviadoEm} is not null`),
    check("credenciamentos_biometria", sql`${t.status} = 'rascunho' or (${t.consentimentoBiometriaEm} is not null and ${t.consentimentoBiometriaVersao} is not null)`),
  ],
);

export const tipoDocumentoDoMedicoEnum = pgEnum("tipo_documento_do_medico", [
  "identidade_frente",
  "identidade_verso",
  "carteira_crm",
  "diploma",
  "titulo_especialista",
  "comprovante_endereco",
  "selfie",
]);

export const documentosDoMedico = pgTable(
  "documentos_do_medico",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    tipo: tipoDocumentoDoMedicoEnum("tipo").notNull(),
    caminho: text("caminho").notNull(),
    tipoArquivo: varchar("tipo_arquivo", { length: 60 }).notNull(),
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    hash: varchar("hash", { length: 64 }).notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // O documento em vigor de cada tipo e o mais recente.
    index("documentos_do_medico_atual").on(t.medicoId, t.clinicaId, t.tipo, t.criadoEm),
    uniqueIndex("documentos_do_medico_caminho").on(t.caminho),
    check("documentos_do_medico_hash", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check("documentos_do_medico_tamanho", sql`${t.tamanhoBytes} > 0 and ${t.tamanhoBytes} <= 15728640`),
  ],
);

export const statusVerificacaoDeIdentidadeEnum = pgEnum("status_verificacao_identidade", ["pendente", "aprovada", "reprovada", "inconclusiva"]);

export const verificacoesDeIdentidade = pgTable(
  "verificacoes_de_identidade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    /** "manual" (a administracao compara), "local_teste" ou o nome do servico externo. */
    provedor: text("provedor").notNull(),
    status: statusVerificacaoDeIdentidadeEnum("status").notNull(),
    /** Semelhanca de 0 a 100, quando o provedor informa. */
    pontuacao: smallint("pontuacao"),
    /**
     * Identificador que liga esta conferencia ao servico de fora: e o que ele
     * devolve no aviso assinado. Nulo na conferencia manual.
     */
    referencia: text("referencia"),
    selfieId: uuid("selfie_id").references(() => documentosDoMedico.id, { onDelete: "restrict" }),
    documentoId: uuid("documento_id").references(() => documentosDoMedico.id, { onDelete: "restrict" }),
    /** Resposta do provedor, sem imagem e sem modelo biometrico. */
    detalhes: jsonb("detalhes"),
    observacao: text("observacao"),
    /** Quem conferiu. Nulo quando foi um servico automatico. */
    verificadoPor: uuid("verificado_por").references(() => perfis.id, { onDelete: "restrict" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verificacoes_identidade_medico").on(t.medicoId, t.clinicaId, t.criadoEm),
    uniqueIndex("verificacoes_identidade_referencia").on(t.referencia, t.status),
    check("verificacoes_identidade_pontuacao", sql`${t.pontuacao} is null or ${t.pontuacao} between 0 and 100`),
    check("verificacoes_identidade_manual_tem_autor", sql`${t.provedor} <> 'manual' or ${t.status} = 'pendente' or ${t.verificadoPor} is not null`),
    check("verificacoes_identidade_reprovacao_explicada", sql`${t.provedor} <> 'manual' or ${t.status} <> 'reprovada' or length(trim(coalesce(${t.observacao}, ''))) >= 5`),
  ],
);

export type CredenciamentoMedico = typeof credenciamentosMedicos.$inferSelect;
export type DocumentoDoMedico = typeof documentosDoMedico.$inferSelect;
export type VerificacaoDeIdentidade = typeof verificacoesDeIdentidade.$inferSelect;
