/**
 * Tabela `precos` - quanto custa ser atendido.
 *
 * Sem preco nao ha cobranca, e sem cobranca o paciente nao entra na fila
 * nem confirma consulta. Por isso esta tabela nasce junto do pagamento.
 *
 * O preco e da CLINICA, e pode ser refinado por medico: a clinica define um
 * valor padrao para consulta agendada e outro para pronto atendimento, e
 * opcionalmente um valor diferente para um profissional especifico (um
 * especialista costuma custar mais que o clinico geral).
 *
 * Valores sempre em CENTAVOS, inteiros. Ponto flutuante em dinheiro vira
 * divergencia de centavos que ninguem consegue explicar.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { medicos } from "./medicos.js";

export const tipoAtendimentoEnum = pgEnum("tipo_atendimento", ["agendada", "pronto_atendimento"]);

export const precos = pgTable(
  "precos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "cascade" }),
    tipo: tipoAtendimentoEnum("tipo").notNull(),
    /** Nulo = preco padrao da clinica. Preenchido = preco daquele medico. */
    medicoId: uuid("medico_id").references(() => medicos.perfilId, { onDelete: "cascade" }),

    valorCentavos: integer("valor_centavos").notNull(),
    /**
     * Quanto a plataforma retem, em pontos-base (1% = 100). Guardado no
     * momento em que o preco e definido: mudar a comissao depois nao pode
     * alterar retroativamente o que ja foi combinado.
     */
    comissaoPlataformaBps: integer("comissao_plataforma_bps").notNull().default(0),

    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // De R$ 1,00 a R$ 10.000,00. Fora disso e quase certamente erro de digitacao.
    check("precos_valor_razoavel", sql`${t.valorCentavos} between 100 and 1000000`),
    check("precos_comissao_razoavel", sql`${t.comissaoPlataformaBps} between 0 and 3000`),
    // Um preco padrao por tipo, e um por medico por tipo.
    uniqueIndex("precos_clinica_tipo_medico").on(t.clinicaId, t.tipo, t.medicoId),
    index("precos_clinica").on(t.clinicaId),
  ],
);

export type Preco = typeof precos.$inferSelect;
export type NovoPreco = typeof precos.$inferInsert;
