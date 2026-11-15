/**
 * =====================================================================
 * SATISFACAO E RESTRICAO DE PACIENTE (ADR-0027)
 * =====================================================================
 *
 * avaliacoes_consulta  depois da consulta concluida, o paciente responde
 *                      "de 0 a 10, quanto recomendaria?" (NPS). Uma por
 *                      consulta. O comentario e opcional e curto; a tela
 *                      pede para nao escrever dado de saude.
 *
 * restricoes_pacientes a administracao impede um paciente de MARCAR ou de
 *                      entrar na FILA (fraude, abuso, calote repetido). Ele
 *                      continua entrando para ver os proprios documentos e
 *                      exercer os direitos da LGPD. Nao se apaga: encerra-se.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";
import { medicos } from "./medicos.js";
import { pacientes } from "./pacientes.js";
import { perfis } from "./perfis.js";

export const avaliacoesConsulta = pgTable(
  "avaliacoes_consulta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    consultaId: uuid("consulta_id")
      .notNull()
      .references(() => consultas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    /** 0 a 10: "quanto voce recomendaria?" */
    nota: integer("nota").notNull(),
    comentario: text("comentario"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("avaliacoes_uma_por_consulta").on(t.consultaId),
    index("avaliacoes_clinica_data").on(t.clinicaId, t.criadoEm),
    check("avaliacoes_nota_faixa", sql`${t.nota} between 0 and 10`),
    check("avaliacoes_comentario_curto", sql`${t.comentario} is null or length(${t.comentario}) <= 500`),
  ],
);

export const restricoesPacientes = pgTable(
  "restricoes_pacientes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    motivo: text("motivo").notNull(),
    criadoPor: uuid("criado_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
    encerradoPor: uuid("encerrado_por").references(() => perfis.id, { onDelete: "restrict" }),
  },
  (t) => [
    // So uma restricao em vigor por paciente.
    uniqueIndex("restricoes_uma_em_vigor").on(t.clinicaId, t.pacienteId).where(sql`${t.encerradoEm} is null`),
    check("restricoes_motivo", sql`length(trim(${t.motivo})) between 5 and 300`),
    check("restricoes_encerramento_completo", sql`(${t.encerradoEm} is null) = (${t.encerradoPor} is null)`),
  ],
);

export type AvaliacaoConsulta = typeof avaliacoesConsulta.$inferSelect;
export type RestricaoPaciente = typeof restricoesPacientes.$inferSelect;
