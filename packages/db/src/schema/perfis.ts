/**
 * Tabela `perfis` - uma linha para cada PESSOA que entra no sistema.
 *
 * O `id` e o MESMO id do usuario em auth.users (o login do Supabase).
 * O perfil e GLOBAL: a pessoa e uma so, com um nome e um CPF, mesmo que
 * atenda em tres clinicas. O que ela E em cada clinica esta em `vinculos`
 * (Modulo 6) - por isso a coluna `papel` saiu daqui.
 */
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const perfis = pgTable(
  "perfis",
  {
    /** Igual a auth.users.id. Nao e gerado aqui: vem do login. */
    id: uuid("id").primaryKey(),
    nomeCompleto: text("nome_completo").notNull(),
    telefone: text("telefone"),
    /** So os 11 digitos. Identifica a pessoa em prescricao e atestado. */
    cpf: varchar("cpf", { length: 11 }),
    /**
     * Nossa equipe de suporte. NUNCA da acesso a prontuario: so a dados
     * operacionais, e todo acesso e auditado (ADR-0008). So a chave secreta
     * (a API) consegue marcar isto como verdadeiro.
     */
    suportePlataforma: boolean("suporte_plataforma").notNull().default(false),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    /** Atualizado automaticamente por gatilho (migracao 0001). */
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("perfis_cpf_unico").on(t.cpf)],
);

export type Perfil = typeof perfis.$inferSelect;
export type NovoPerfil = typeof perfis.$inferInsert;
