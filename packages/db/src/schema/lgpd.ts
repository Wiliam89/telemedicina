import { sql } from "drizzle-orm";
import { check, index, inet, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { perfis } from "./perfis.js";

/**
 * =====================================================================
 * LGPD: CONSENTIMENTO E DIREITOS DO TITULAR (ADR-0018)
 * =====================================================================
 *
 * consentimentos       cada aceite (e cada revogacao) dos termos, da
 *                      politica de privacidade e do atendimento por
 *                      telemedicina, com a VERSAO do texto aceito, quando,
 *                      de onde. Somente insercao: e a prova (art. 8, par. 2:
 *                      o onus de provar o consentimento e do controlador).
 *
 * solicitacoes_titular os pedidos do art. 18 (acesso, correcao, exclusao,
 *                      portabilidade, informacao, revogacao), com prazo e
 *                      resposta. Muda de estado - e cada mudanca vai para a
 *                      auditoria.
 */
export const tipoConsentimentoEnum = pgEnum("tipo_consentimento", ["termos_de_uso", "politica_de_privacidade", "telemedicina"]);
export const acaoConsentimentoEnum = pgEnum("acao_consentimento", ["aceito", "revogado"]);

export const consentimentos = pgTable(
  "consentimentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perfilId: uuid("perfil_id")
      .notNull()
      .references(() => perfis.id, { onDelete: "cascade" }),
    tipo: tipoConsentimentoEnum("tipo").notNull(),
    acao: acaoConsentimentoEnum("acao").notNull(),
    /** A versao do texto (data de publicacao, ex.: "2026-10-26"). */
    versao: text("versao").notNull(),
    ip: inet("ip"),
    navegador: text("navegador"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consentimentos_perfil_tipo").on(t.perfilId, t.tipo, t.criadoEm)],
);

export const tipoSolicitacaoEnum = pgEnum("tipo_solicitacao_titular", [
  "confirmacao_e_acesso",
  "correcao",
  "anonimizacao_ou_exclusao",
  "portabilidade",
  "informacao_compartilhamento",
  "revogacao_consentimento",
  "outro",
]);
export const statusSolicitacaoEnum = pgEnum("status_solicitacao_titular", ["aberta", "em_andamento", "concluida", "negada"]);

export const solicitacoesTitular = pgTable(
  "solicitacoes_titular",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perfilId: uuid("perfil_id")
      .notNull()
      .references(() => perfis.id, { onDelete: "cascade" }),
    /** A quem o pedido e dirigido: a clinica (controladora) ou, nulo, a plataforma. */
    clinicaId: uuid("clinica_id").references(() => clinicas.id, { onDelete: "restrict" }),
    tipo: tipoSolicitacaoEnum("tipo").notNull(),
    descricao: text("descricao").notNull(),
    status: statusSolicitacaoEnum("status").notNull().default("aberta"),
    resposta: text("resposta"),
    respondidoPor: uuid("respondido_por").references(() => perfis.id, { onDelete: "set null" }),
    respondidoEm: timestamp("respondido_em", { withTimezone: true }),
    /** Art. 19, II: resposta completa em ate 15 dias. */
    prazo: timestamp("prazo", { withTimezone: true }).notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("solicitacoes_titular_perfil").on(t.perfilId, t.criadoEm),
    index("solicitacoes_titular_clinica").on(t.clinicaId, t.status, t.prazo),
    check("solicitacoes_titular_descricao", sql`length(trim(${t.descricao})) between 10 and 3000`),
    check(
      "solicitacoes_titular_resposta",
      sql`(${t.status} in ('aberta','em_andamento')) or (${t.resposta} is not null and ${t.respondidoEm} is not null)`,
    ),
  ],
);

export type Consentimento = typeof consentimentos.$inferSelect;
export type SolicitacaoTitular = typeof solicitacoesTitular.$inferSelect;
