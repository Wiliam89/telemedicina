/**
 * Tabela `auditoria` - quem fez o que, quando, em qual registro.
 *
 * Em sistema de saude isso nao e opcional: a trilha de auditoria e a prova
 * de que o acesso ao prontuario foi legitimo (CFM 2.314/2022; LGPD, art. 37,
 * "registro das operacoes de tratamento"). Regra: aqui so se INSERE. Nada e
 * alterado nem apagado - o Modulo 4 trava isso no banco (RLS + permissoes).
 */
import { bigserial, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { perfis } from "./perfis.js";

export const auditoria = pgTable(
  "auditoria",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    quando: timestamp("quando", { withTimezone: true }).notNull().defaultNow(),
    /** Quem fez. Nulo quando foi o proprio sistema (ex.: rotina automatica). */
    quem: uuid("quem").references(() => perfis.id, { onDelete: "set null" }),
    /**
     * Em qual clinica a acao aconteceu. Nulo apenas para acoes que existem
     * fora de qualquer clinica (criar o proprio perfil, criar uma clinica).
     */
    clinicaId: uuid("clinica_id").references(() => clinicas.id, { onDelete: "restrict" }),
    /** Ex.: "consulta.criada", "prontuario.lido". Sempre "coisa.acao". */
    acao: text("acao").notNull(),
    tabela: text("tabela").notNull(),
    registroId: text("registro_id").notNull(),
    /** O que mudou, se fizer sentido guardar (nunca dados clinicos em claro). */
    detalhes: jsonb("detalhes"),
    ip: inet("ip"),
  },
  (t) => [
    index("auditoria_quem_quando").on(t.quem, t.quando),
    index("auditoria_tabela_registro").on(t.tabela, t.registroId),
    index("auditoria_clinica_quando").on(t.clinicaId, t.quando),
  ],
);

export type Auditoria = typeof auditoria.$inferSelect;
export type NovaAuditoria = typeof auditoria.$inferInsert;
