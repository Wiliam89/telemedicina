import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";
import { perfis } from "./perfis.js";

/**
 * =====================================================================
 * VERIFICACAO DO CRM (ADR-0016)
 * =====================================================================
 *
 * O CRM que o medico digita no cadastro e so uma declaracao. Antes de ele
 * emitir receita, abrir plantao ou receber marcacao, ALGUEM confere no
 * Conselho que o registro existe, e da pessoa certa, e esta ATIVO.
 *
 * A conferencia e POR CLINICA: quem responde pela equipe perante o CRM e o
 * diretor tecnico daquela clinica (Resolucao CFM 2.147/2016). Uma clinica
 * nao "herda" a conferencia feita por outra.
 *
 * Somente insercao: cada conferencia e uma linha nova, com quem conferiu,
 * como, o que o Conselho mostrou e ate quando vale. A situacao atual e a
 * linha mais recente. Recusar depois de ter verificado e uma linha nova -
 * a anterior continua la, para a pericia.
 */
export const resultadoVerificacaoCrmEnum = pgEnum("resultado_verificacao_crm", ["verificado", "recusado"]);
export const metodoVerificacaoCrmEnum = pgEnum("metodo_verificacao_crm", ["consulta_manual_cfm", "servico_externo"]);

export const verificacoesCrm = pgTable(
  "verificacoes_crm",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    resultado: resultadoVerificacaoCrmEnum("resultado").notNull(),
    metodo: metodoVerificacaoCrmEnum("metodo").notNull(),

    /** O CRM conferido (copia: se o medico mudar o cadastro, a prova fica). */
    crm: text("crm").notNull(),
    crmUf: text("crm_uf").notNull(),
    /** Como o Conselho mostrou: nome, situacao ("Ativo"...), especialidades. */
    nomeNoConselho: text("nome_no_conselho"),
    situacaoNoConselho: text("situacao_no_conselho"),
    especialidadesNoConselho: text("especialidades_no_conselho"),
    observacao: text("observacao"),

    /** Quem conferiu. Nulo quando foi um servico automatico. */
    verificadoPor: uuid("verificado_por").references(() => perfis.id, { onDelete: "restrict" }),
    /** Registro pode ser suspenso depois: a conferencia vence e e refeita. */
    validoAte: timestamp("valido_ate", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verificacoes_crm_medico_clinica").on(t.medicoId, t.clinicaId, t.criadoEm),
    check("verificacoes_crm_validade", sql`(${t.resultado} = 'verificado') = (${t.validoAte} is not null)`),
    check("verificacoes_crm_quem", sql`${t.metodo} = 'servico_externo' or ${t.verificadoPor} is not null`),
    check("verificacoes_crm_recusa_explicada", sql`${t.resultado} = 'verificado' or length(trim(coalesce(${t.observacao}, ''))) >= 5`),
  ],
);

export type VerificacaoCrm = typeof verificacoesCrm.$inferSelect;
