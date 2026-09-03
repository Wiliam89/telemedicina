/**
 * Tabela `plantoes` - a escala de quem esta de plantao.
 *
 * A grade semanal (`disponibilidades`, Modulo 7) serve para AGENDAMENTO:
 * o paciente escolhe dia e hora com um profissional. O plantao serve para
 * o PRONTO ATENDIMENTO: o paciente entra na fila e e chamado por quem
 * estiver disponivel. Sao dois modos do mesmo produto, e as plataformas de
 * referencia operam os dois - por isso a escala nasce agora, junto do
 * prontuario, e nao depois (Modulo 11 acrescenta as telas e a distribuicao).
 *
 * O plantao e da clinica: um medico pode estar de plantao na Clinica A e
 * atendendo agendado na Clinica B - mas nao nas duas ao mesmo tempo, o que
 * a trava de exclusao garante.
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";

export const statusPlantaoEnum = pgEnum("status_plantao", ["escalado", "aberto", "encerrado"]);

export const plantoes = pgTable(
  "plantoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    inicio: timestamp("inicio", { withTimezone: true }).notNull(),
    fim: timestamp("fim", { withTimezone: true }).notNull(),
    /**
     * escalado  - esta na escala, ainda nao comecou
     * aberto    - o medico "abriu" o plantao e esta recebendo da fila
     * encerrado - terminou
     */
    status: statusPlantaoEnum("status").notNull().default("escalado"),
    /** Quando o medico efetivamente abriu e fechou (pode diferir da escala). */
    abertoEm: timestamp("aberto_em", { withTimezone: true }),
    encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("plantoes_fim_depois_do_inicio", sql`${t.fim} > ${t.inicio}`),
    index("plantoes_clinica_inicio").on(t.clinicaId, t.inicio),
    index("plantoes_medico_inicio").on(t.medicoId, t.inicio),
  ],
);

export type Plantao = typeof plantoes.$inferSelect;
export type NovoPlantao = typeof plantoes.$inferInsert;
