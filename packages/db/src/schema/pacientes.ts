/**
 * Tabela `pacientes` - dados de quem e atendido.
 *
 * Assim como `medicos`, e GLOBAL: a pessoa tem uma data de nascimento so,
 * atenda onde atender. Quem decide qual clinica pode VER esses dados e o
 * RLS, que exige um vinculo ativo de paciente naquela clinica (migracao
 * 0004). O CPF mudou-se para `perfis` no Modulo 6: e da pessoa, nao do papel.
 *
 * LGPD, art. 6, III (necessidade): so o minimo para identificar no prontuario.
 */
import { date, pgTable, uuid } from "drizzle-orm/pg-core";
import { perfis } from "./perfis.js";

export const pacientes = pgTable("pacientes", {
  /** Mesmo id do perfil. */
  perfilId: uuid("perfil_id")
    .primaryKey()
    .references(() => perfis.id, { onDelete: "cascade" }),
  dataNascimento: date("data_nascimento").notNull(),
});

export type Paciente = typeof pacientes.$inferSelect;
export type NovoPaciente = typeof pacientes.$inferInsert;
