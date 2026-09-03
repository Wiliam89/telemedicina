/**
 * Tabela `consultas` - cada atendimento agendado entre um paciente e um medico.
 *
 * `status` conta a historia da consulta: agendada -> em_andamento -> concluida
 * (ou cancelada). O prontuario, a prescricao e o video entram em modulos
 * seguintes, sempre ligados a uma linha desta tabela.
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";
import { pacientes } from "./pacientes.js";
import { perfis } from "./perfis.js";

export const statusConsultaEnum = pgEnum("status_consulta", [
  /** Horario reservado, esperando o pagamento (Modulo 10). */
  "aguardando_pagamento",
  "agendada",
  "em_andamento",
  "concluida",
  "cancelada",
]);

export const consultas = pgTable(
  "consultas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Em qual clinica o atendimento acontece. Nunca nulo (Modulo 6). */
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    inicio: timestamp("inicio", { withTimezone: true }).notNull(),
    fim: timestamp("fim", { withTimezone: true }).notNull(),
    status: statusConsultaEnum("status").notNull().default("agendada"),
    /** O que o paciente escreveu ao agendar. Nao e o prontuario. */
    motivo: text("motivo"),
    /**
     * Quem marcou: o proprio paciente, ou alguem da recepcao em nome dele.
     * Em prontuario, "quem fez" e tao importante quanto "o que foi feito".
     */
    marcadoPor: uuid("marcado_por").references(() => perfis.id, { onDelete: "set null" }),
    /**
     * Modulo 10: enquanto o paciente paga, o horario fica preso. Vencido o
     * prazo, a consulta e cancelada e o horario volta a ficar livre.
     */
    expiraReservaEm: timestamp("expira_reserva_em", { withTimezone: true }),
    pagamentoId: uuid("pagamento_id"),

    /** Preenchidos juntos quando status vira "cancelada" (Modulo 7). */
    canceladoPor: uuid("cancelado_por").references(() => perfis.id, { onDelete: "set null" }),
    canceladoEm: timestamp("cancelado_em", { withTimezone: true }),
    motivoCancelamento: text("motivo_cancelamento"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // O banco recusa uma consulta que termina antes de comecar.
    check("consultas_fim_depois_do_inicio", sql`${t.fim} > ${t.inicio}`),
    // Cancelamento so faz sentido com autor, data e motivo - os quatro
    // campos andam juntos ou nao existem.
    check(
      "consultas_cancelamento_completo",
      sql`(${t.status} <> 'cancelada' and ${t.canceladoEm} is null and ${t.canceladoPor} is null)
          or (${t.status} = 'cancelada' and ${t.canceladoEm} is not null)`,
    ),
    // "Minha agenda de hoje" e a pergunta mais comum: indice por medico e horario.
    index("consultas_medico_inicio").on(t.medicoId, t.inicio),
    index("consultas_paciente_inicio").on(t.pacienteId, t.inicio),
    // "a agenda da clinica hoje" - e o filtro de isolamento de toda consulta.
    index("consultas_clinica_inicio").on(t.clinicaId, t.inicio),
  ],
);

export type Consulta = typeof consultas.$inferSelect;
export type NovaConsulta = typeof consultas.$inferInsert;
