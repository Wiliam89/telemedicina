/**
 * Tabela `disponibilidades` - a grade semanal do medico NAQUELA clinica.
 *
 * Nao guardamos horarios livres um a um: guardamos a REGRA ("segunda das 8h
 * as 12h, consultas de 30 minutos") e calculamos os horarios na hora. Duas
 * razoes: a agenda vale para sempre sem precisar gerar linhas para o futuro,
 * e mudar a grade nao exige apagar milhares de registros.
 *
 * Repare no `clinicaId`: a mesma medica pode atender segunda de manha na
 * Clinica A e segunda de manha na Clinica B. Sao duas grades diferentes -
 * e o sistema impede que ela seja marcada nas duas ao mesmo tempo (a trava
 * de sobreposicao da migracao 0007 olha o medico, nao a clinica).
 */
import { check, index, integer, pgTable, time, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";

export const disponibilidades = pgTable(
  "disponibilidades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "cascade" }),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "cascade" }),
    /** 0 = domingo ... 6 = sabado. Mesma convencao do JavaScript (getDay). */
    diaSemana: integer("dia_semana").notNull(),
    /** Hora local da clinica (America/Sao_Paulo). Ver ADR-0009. */
    horaInicio: time("hora_inicio").notNull(),
    horaFim: time("hora_fim").notNull(),
    /** Tamanho de cada consulta neste bloco, em minutos. */
    duracaoMinutos: integer("duracao_minutos").notNull().default(30),
  },
  (t) => [
    check("disponibilidades_dia_valido", sql`${t.diaSemana} between 0 and 6`),
    check("disponibilidades_fim_depois_do_inicio", sql`${t.horaFim} > ${t.horaInicio}`),
    // 10 a 120 minutos: fora disso e quase certamente erro de digitacao.
    check("disponibilidades_duracao_razoavel", sql`${t.duracaoMinutos} between 10 and 120`),
    // O mesmo bloco nao se repete. (Blocos que se sobrepoem sao impedidos
    // pela restricao de exclusao da migracao 0007.)
    uniqueIndex("disponibilidades_bloco_unico").on(t.medicoId, t.clinicaId, t.diaSemana, t.horaInicio),
    index("disponibilidades_clinica_dia").on(t.clinicaId, t.diaSemana),
  ],
);

export type Disponibilidade = typeof disponibilidades.$inferSelect;
export type NovaDisponibilidade = typeof disponibilidades.$inferInsert;
