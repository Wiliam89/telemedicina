/**
 * Tabela `medicos` - dados profissionais de quem atende.
 *
 * Resolucao CFM 2.314/2022: todo atendimento por telemedicina e feito por
 * medico com registro no CRM. Por isso CRM e UF sao obrigatorios e a dupla
 * (crm, crm_uf) e unica: nao existem dois medicos com o mesmo CRM na mesma UF.
 */
import { sql } from "drizzle-orm";
import { boolean, char, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { perfis } from "./perfis.js";

export const medicos = pgTable(
  "medicos",
  {
    /** Mesmo id do perfil. Um perfil com papel "medico" tem uma linha aqui. */
    perfilId: uuid("perfil_id")
      .primaryKey()
      .references(() => perfis.id, { onDelete: "cascade" }),
    crm: text("crm").notNull(),
    crmUf: char("crm_uf", { length: 2 }).notNull(),
    /** Texto livre do cadastro (o que o medico declarou). So para exibir. */
    especialidade: text("especialidade"),
    /**
     * Especialidades CONFERIDAS no credenciamento (codigos de
     * @tele/shared/especialidades). E por elas que a teleconsulta
     * especializada encontra o medico: quem declara nao decide; quem
     * confere o registro de especialista e a administracao (ADR-0024).
     */
    especialidades: text("especialidades").array().notNull().default(sql`'{}'::text[]`),
    /** Atende o pronto atendimento, como clinico geral (ADR-0024). */
    atendeProntoAtendimento: boolean("atende_pronto_atendimento").notNull().default(true),
  },
  (t) => [uniqueIndex("medicos_crm_uf_unico").on(t.crm, t.crmUf)],
);

export type Medico = typeof medicos.$inferSelect;
export type NovoMedico = typeof medicos.$inferInsert;
