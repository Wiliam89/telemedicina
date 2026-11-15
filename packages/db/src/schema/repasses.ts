/**
 * =====================================================================
 * REPASSE AOS MEDICOS (ADR-0026)
 * =====================================================================
 *
 * O paciente paga a PLATAFORMA (ela e a clinica, ADR-0022). O medico recebe
 * uma porcentagem de cada consulta que realiza:
 *
 *   clinicas.repasse_padrao_bps   a porcentagem padrao (7000 = 70%)
 *   percentuais_medicos           a porcentagem de um medico especifico
 *   consultas.repasse_medico_bps  a porcentagem CONGELADA quando a consulta
 *                                 nasceu: mudar a regra depois nao muda o que
 *                                 ja foi combinado
 *
 * O dinheiro em si nao passa por aqui: a plataforma transfere ao medico por
 * fora (Pix, TED) e REGISTRA a transferencia em `repasses_medicos`. O saldo
 * de cada medico e o que ele ganhou menos o que ja foi registrado como pago.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";
import { perfis } from "./perfis.js";

export const percentuaisMedicos = pgTable(
  "percentuais_medicos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    /** Pontos-base: 7000 = 70% do valor da consulta fica com o medico. */
    percentualBps: integer("percentual_bps").notNull(),
    definidoPor: uuid("definido_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("percentuais_medicos_um_por_medico").on(t.clinicaId, t.medicoId),
    check("percentuais_medicos_faixa", sql`${t.percentualBps} between 0 and 10000`),
  ],
);

export const repassesMedicos = pgTable(
  "repasses_medicos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    valorCentavos: integer("valor_centavos").notNull(),
    /** Quando o dinheiro saiu (pode ser anterior ao registro). */
    pagoEm: timestamp("pago_em", { withTimezone: true }).notNull(),
    /** Como saiu: "Pix", "TED", o identificador da transferencia... Nunca dado bancario completo. */
    referencia: text("referencia").notNull(),
    observacao: text("observacao"),
    registradoPor: uuid("registrado_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    /** Registro feito por engano: cancelado com motivo, nunca apagado. */
    canceladoEm: timestamp("cancelado_em", { withTimezone: true }),
    canceladoPor: uuid("cancelado_por").references(() => perfis.id, { onDelete: "restrict" }),
    motivoCancelamento: text("motivo_cancelamento"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("repasses_medicos_medico").on(t.clinicaId, t.medicoId, t.pagoEm),
    check("repasses_valor_positivo", sql`${t.valorCentavos} > 0`),
    check("repasses_referencia", sql`length(trim(${t.referencia})) between 2 and 120`),
    check(
      "repasses_cancelamento_completo",
      sql`(${t.canceladoEm} is null and ${t.canceladoPor} is null and ${t.motivoCancelamento} is null)
          or (${t.canceladoEm} is not null and ${t.canceladoPor} is not null and length(trim(coalesce(${t.motivoCancelamento}, ''))) >= 5)`,
    ),
  ],
);

export type PercentualMedico = typeof percentuaisMedicos.$inferSelect;
export type RepasseMedico = typeof repassesMedicos.$inferSelect;
