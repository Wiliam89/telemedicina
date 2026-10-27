import { index, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { perfis } from "./perfis.js";

/**
 * =====================================================================
 * NOTIFICACOES (ADR-0019)
 * =====================================================================
 *
 * Cada aviso e uma linha: aparece na central da plataforma (o sino) e,
 * quando ha e-mail configurado, sai tambem por e-mail.
 *
 * A `chave` impede aviso duplicado mesmo com varias instancias da API
 * rodando o agendador ao mesmo tempo: "lembrete-24h:<consulta>" so entra
 * uma vez, porque o indice unico recusa a segunda.
 *
 * O CONTEUDO e minimo de proposito. E-mail passa por servidores de
 * terceiros: o aviso diz "sua receita esta disponivel", nunca o remedio;
 * "consulta amanha as 9h", nunca o motivo da consulta.
 */
export const tipoNotificacaoEnum = pgEnum("tipo_notificacao", [
  "consulta_marcada",
  "consulta_cancelada",
  "lembrete_24h",
  "lembrete_1h",
  "documento_disponivel",
  "pedido_lgpd_respondido",
  "crm_verificado",
]);

export const notificacoes = pgTable(
  "notificacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perfilId: uuid("perfil_id")
      .notNull()
      .references(() => perfis.id, { onDelete: "cascade" }),
    clinicaId: uuid("clinica_id").references(() => clinicas.id, { onDelete: "cascade" }),
    tipo: tipoNotificacaoEnum("tipo").notNull(),
    titulo: text("titulo").notNull(),
    corpo: text("corpo").notNull(),
    /** Caminho no site (ex.: /c/clinica/agenda) - nunca URL externa. */
    link: text("link"),
    chave: text("chave").notNull(),

    lidaEm: timestamp("lida_em", { withTimezone: true }),
    /** E-mail: quando saiu, ou por que nao saiu. Nulos = ainda na fila. */
    emailEnviadoEm: timestamp("email_enviado_em", { withTimezone: true }),
    emailErro: text("email_erro"),
    emailTentativas: smallint("email_tentativas").notNull().default(0),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notificacoes_chave").on(t.perfilId, t.chave),
    index("notificacoes_perfil_criado").on(t.perfilId, t.criadoEm),
    index("notificacoes_email_pendente").on(t.emailEnviadoEm, t.emailTentativas),
  ],
);

export type Notificacao = typeof notificacoes.$inferSelect;
