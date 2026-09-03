/**
 * Tabela `vinculos` - "esta pessoa e X naquela clinica".
 *
 * E o coracao do modelo multi-clinica. Uma pessoa tem um unico login e um
 * unico `perfil` (nome, CPF, telefone), mas pode ser paciente na Clinica A e
 * medica na Clinica B. O papel deixou de morar em `perfis` (Modulo 4) e
 * passou a morar aqui (Modulo 6).
 *
 * Papeis:
 *   paciente        - e atendido nesta clinica
 *   medico          - atende nesta clinica (precisa ter linha em `medicos`)
 *   recepcao        - agenda e cadastra, nao ve prontuario
 *   admin_clinica   - gerencia equipe e dados da clinica
 *
 * `suporte_plataforma` NAO e um papel de vinculo: e um papel global da nossa
 * equipe, guardado em `perfis.suporte_plataforma`, e nunca da acesso a
 * prontuario (ADR-0008).
 */
import { index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { perfis } from "./perfis.js";

export const papelVinculoEnum = pgEnum("papel_vinculo", ["paciente", "medico", "recepcao", "admin_clinica"]);
export const statusVinculoEnum = pgEnum("status_vinculo", ["ativo", "suspenso", "encerrado"]);

export const vinculos = pgTable(
  "vinculos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perfilId: uuid("perfil_id")
      .notNull()
      .references(() => perfis.id, { onDelete: "cascade" }),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    papel: papelVinculoEnum("papel").notNull(),
    status: statusVinculoEnum("status").notNull().default("ativo"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Uma pessoa nao tem dois papeis iguais na mesma clinica.
    uniqueIndex("vinculos_perfil_clinica_papel").on(t.perfilId, t.clinicaId, t.papel),
    // "quem sou eu nesta clinica?" - consultado por CADA politica de RLS.
    index("vinculos_perfil_clinica").on(t.perfilId, t.clinicaId),
    index("vinculos_clinica_papel").on(t.clinicaId, t.papel),
  ],
);

export type Vinculo = typeof vinculos.$inferSelect;
export type NovoVinculo = typeof vinculos.$inferInsert;
