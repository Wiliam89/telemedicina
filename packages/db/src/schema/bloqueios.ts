/**
 * Tabela `bloqueios` - "neste periodo eu nao atendo".
 *
 * Ferias, congresso, feriado, almoco fora do padrao. E a excecao que se
 * sobrepoe a grade semanal: um horario so aparece como livre se estiver
 * dentro da disponibilidade E fora de qualquer bloqueio.
 *
 * O bloqueio pertence ao medico numa clinica; ferias de verdade viram um
 * bloqueio em cada clinica onde ele atende (a tela avisa e oferece criar
 * nas duas).
 */
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";

export const bloqueios = pgTable(
  "bloqueios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "cascade" }),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "cascade" }),
    inicio: timestamp("inicio", { withTimezone: true }).notNull(),
    fim: timestamp("fim", { withTimezone: true }).notNull(),
    /** "Ferias", "Congresso de cardiologia". Aparece so para a equipe. */
    motivo: text("motivo"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bloqueios_fim_depois_do_inicio", sql`${t.fim} > ${t.inicio}`),
    index("bloqueios_medico_periodo").on(t.medicoId, t.inicio),
    index("bloqueios_clinica_periodo").on(t.clinicaId, t.inicio),
  ],
);

export type Bloqueio = typeof bloqueios.$inferSelect;
export type NovoBloqueio = typeof bloqueios.$inferInsert;
