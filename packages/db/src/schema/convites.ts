/**
 * Tabela `convites` - como um profissional entra numa clinica.
 *
 * O admin da clinica convida por e-mail com um papel definido. O sistema
 * guarda apenas o HASH do codigo (SHA-256), nunca o codigo em si: quem
 * roubar o banco nao consegue aceitar convite nenhum - mesmo principio de
 * uma senha bem guardada.
 *
 * Convite expira (padrao: 7 dias) e so pode ser aceito uma vez.
 */
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { perfis } from "./perfis.js";
import { papelVinculoEnum } from "./vinculos.js";

export const statusConviteEnum = pgEnum("status_convite", ["pendente", "aceito", "revogado", "expirado"]);

export const convites = pgTable(
  "convites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    papel: papelVinculoEnum("papel").notNull(),
    /** SHA-256 do codigo, em hexadecimal. O codigo em si so existe no e-mail. */
    codigoHash: text("codigo_hash").notNull(),
    status: statusConviteEnum("status").notNull().default("pendente"),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    convidadoPor: uuid("convidado_por")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    aceitoPor: uuid("aceito_por").references(() => perfis.id, { onDelete: "set null" }),
    aceitoEm: timestamp("aceito_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("convites_codigo_hash").on(t.codigoHash),
    index("convites_clinica_status").on(t.clinicaId, t.status),
    index("convites_email").on(t.email),
  ],
);

export type Convite = typeof convites.$inferSelect;
export type NovoConvite = typeof convites.$inferInsert;
