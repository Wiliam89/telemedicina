import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";
import { pacientes } from "./pacientes.js";
import { perfis } from "./perfis.js";

/**
 * =====================================================================
 * O PRONTUARIO ALEM DA EVOLUCAO (ADR-0015)
 * =====================================================================
 *
 * A evolucao (SOAP) registra UMA consulta. O prontuario de verdade tem
 * mais tres partes, como em qualquer sistema clinico de mercado:
 *
 *   fichas_clinicas  o resumo que o medico le antes de atender: alergias,
 *                    remedios em uso, doencas, antecedentes
 *   sinais_vitais    medidas ao longo do tempo (peso, pressao, glicemia...)
 *   anexos           exames e laudos em arquivo (PDF, foto)
 *
 * As tres sao SOMENTE INSERCAO, como a evolucao finalizada: nada e
 * reescrito nem apagado. A ficha "muda" ganhando uma VERSAO nova - a
 * anterior continua la, e a pericia ve quem mudou o que e quando.
 *
 * Tudo e por clinica (ADR-0008): o prontuario que uma clinica produziu
 * nao aparece em outra, mesmo sendo o mesmo paciente.
 */

export const tiposSanguineos = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export const fichasClinicas = pgTable(
  "fichas_clinicas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    /** 1, 2, 3... A versao atual e a maior. */
    versao: integer("versao").notNull(),

    alergias: text("alergias").array().notNull().default(sql`'{}'::text[]`),
    /** true = o paciente NEGA alergias (diferente de "nao perguntado"). */
    negaAlergias: boolean("nega_alergias").notNull().default(false),
    medicamentosEmUso: text("medicamentos_em_uso").array().notNull().default(sql`'{}'::text[]`),
    comorbidades: text("comorbidades"),
    antecedentesFamiliares: text("antecedentes_familiares"),
    cirurgiasInternacoes: text("cirurgias_internacoes"),
    habitos: text("habitos"),
    tipoSanguineo: varchar("tipo_sanguineo", { length: 3 }),
    observacoes: text("observacoes"),

    registradoPor: uuid("registrado_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fichas_clinicas_versao").on(t.clinicaId, t.pacienteId, t.versao),
    check("fichas_clinicas_versao_positiva", sql`${t.versao} >= 1`),
    // "Nega alergias" e lista de alergias se contradizem.
    check("fichas_clinicas_alergias_coerentes", sql`not (${t.negaAlergias} and cardinality(${t.alergias}) > 0)`),
    check("fichas_clinicas_tipo_sanguineo", sql`${t.tipoSanguineo} is null or ${t.tipoSanguineo} in ('A+','A-','B+','B-','AB+','AB-','O+','O-')`),
  ],
);

export const origemRegistroEnum = pgEnum("origem_registro", ["profissional", "paciente"]);

export const sinaisVitais = pgTable(
  "sinais_vitais",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    consultaId: uuid("consulta_id").references(() => consultas.id, { onDelete: "restrict" }),
    /** Medido pelo profissional, ou informado pelo paciente (medidor de casa). */
    origem: origemRegistroEnum("origem").notNull(),
    registradoPor: uuid("registrado_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    medidoEm: timestamp("medido_em", { withTimezone: true }).notNull(),

    pesoKg: numeric("peso_kg", { precision: 5, scale: 2 }),
    alturaCm: numeric("altura_cm", { precision: 5, scale: 1 }),
    pressaoSistolica: smallint("pressao_sistolica"),
    pressaoDiastolica: smallint("pressao_diastolica"),
    frequenciaCardiaca: smallint("frequencia_cardiaca"),
    frequenciaRespiratoria: smallint("frequencia_respiratoria"),
    temperaturaC: numeric("temperatura_c", { precision: 4, scale: 1 }),
    saturacaoO2: smallint("saturacao_o2"),
    glicemiaMgDl: smallint("glicemia_mg_dl"),
    observacao: text("observacao"),

    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sinais_vitais_paciente_medido").on(t.clinicaId, t.pacienteId, t.medidoEm),
    // Faixas fisiologicamente possiveis: barra erro de digitacao (peso 700,
    // pressao 1200), nao julga se o valor e saudavel.
    check("sinais_vitais_peso", sql`${t.pesoKg} is null or (${t.pesoKg} > 0.3 and ${t.pesoKg} < 400)`),
    check("sinais_vitais_altura", sql`${t.alturaCm} is null or (${t.alturaCm} > 20 and ${t.alturaCm} < 260)`),
    check("sinais_vitais_pa", sql`(${t.pressaoSistolica} is null) = (${t.pressaoDiastolica} is null)
      and (${t.pressaoSistolica} is null or (${t.pressaoSistolica} between 40 and 300 and ${t.pressaoDiastolica} between 20 and 200 and ${t.pressaoSistolica} > ${t.pressaoDiastolica}))`),
    check("sinais_vitais_fc", sql`${t.frequenciaCardiaca} is null or ${t.frequenciaCardiaca} between 20 and 250`),
    check("sinais_vitais_fr", sql`${t.frequenciaRespiratoria} is null or ${t.frequenciaRespiratoria} between 4 and 80`),
    check("sinais_vitais_temperatura", sql`${t.temperaturaC} is null or ${t.temperaturaC} between 30 and 45`),
    check("sinais_vitais_saturacao", sql`${t.saturacaoO2} is null or ${t.saturacaoO2} between 50 and 100`),
    check("sinais_vitais_glicemia", sql`${t.glicemiaMgDl} is null or ${t.glicemiaMgDl} between 10 and 1500`),
    check(
      "sinais_vitais_algum_valor",
      sql`coalesce(${t.pesoKg}::text, ${t.alturaCm}::text, ${t.pressaoSistolica}::text, ${t.frequenciaCardiaca}::text,
        ${t.frequenciaRespiratoria}::text, ${t.temperaturaC}::text, ${t.saturacaoO2}::text, ${t.glicemiaMgDl}::text) is not null`,
    ),
  ],
);

export const categoriaAnexoEnum = pgEnum("categoria_anexo", ["exame_laboratorial", "exame_imagem", "laudo", "receita_externa", "outro"]);

export const anexos = pgTable(
  "anexos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    consultaId: uuid("consulta_id").references(() => consultas.id, { onDelete: "restrict" }),
    origem: origemRegistroEnum("origem").notNull(),
    enviadoPor: uuid("enviado_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),

    categoria: categoriaAnexoEnum("categoria").notNull(),
    titulo: text("titulo").notNull(),
    /** Data do exame (nao do envio): e a que importa para a linha do tempo. */
    dataDoExame: timestamp("data_do_exame", { withTimezone: true }),

    caminho: text("caminho").notNull(),
    tipoArquivo: varchar("tipo_arquivo", { length: 60 }).notNull(),
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    hash: varchar("hash", { length: 64 }).notNull(),

    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("anexos_paciente_criado").on(t.clinicaId, t.pacienteId, t.criadoEm),
    uniqueIndex("anexos_caminho").on(t.caminho),
    check("anexos_hash_formato", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check("anexos_tamanho", sql`${t.tamanhoBytes} > 0 and ${t.tamanhoBytes} <= 15728640`),
    check("anexos_titulo", sql`length(trim(${t.titulo})) between 2 and 160`),
  ],
);

export type FichaClinica = typeof fichasClinicas.$inferSelect;
export type SinalVital = typeof sinaisVitais.$inferSelect;
export type Anexo = typeof anexos.$inferSelect;
