/**
 * Tabela `cartoes_salvos` - o cartao que o paciente deixou cadastrado
 * (ADR-0023).
 *
 * Cadastrar e OPCIONAL. Quem cadastra nao paga antes: a consulta acontece e
 * o valor e cobrado no cartao quando o medico a encerra. Quem nao cadastra
 * paga por Pix antes de a consulta comecar.
 *
 * O QUE NUNCA ENTRA AQUI: numero do cartao, codigo de seguranca, nome
 * impresso. O navegador entrega esses dados direto ao provedor de pagamento,
 * que devolve um identificador. So o identificador, a bandeira e os quatro
 * ultimos digitos (para a pessoa reconhecer o cartao) chegam a nos. E o que
 * mantem a plataforma fora do escopo pesado do PCI DSS.
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { perfis } from "./perfis.js";

export const statusCartaoEnum = pgEnum("status_cartao", ["ativo", "removido"]);

export const cartoesSalvos = pgTable(
  "cartoes_salvos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perfilId: uuid("perfil_id")
      .notNull()
      .references(() => perfis.id, { onDelete: "cascade" }),
    /** O cartao fica guardado na conta do provedor que esta clinica usa. */
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    provedor: text("provedor").notNull(),
    /** O "cliente" e o "cartao" como o provedor os conhece. */
    provedorClienteId: text("provedor_cliente_id").notNull(),
    provedorCartaoId: text("provedor_cartao_id").notNull(),
    bandeira: varchar("bandeira", { length: 30 }).notNull(),
    ultimos4: varchar("ultimos4", { length: 4 }).notNull(),
    validadeMes: smallint("validade_mes").notNull(),
    validadeAno: smallint("validade_ano").notNull(),
    status: statusCartaoEnum("status").notNull().default("ativo"),
    /**
     * Quando a pessoa autorizou a cobranca ao final da consulta, e sobre
     * qual versao do texto que ela leu (o mesmo cuidado do consentimento).
     */
    autorizadoEm: timestamp("autorizado_em", { withTimezone: true }).notNull().defaultNow(),
    autorizacaoVersao: text("autorizacao_versao").notNull(),
    removidoEm: timestamp("removido_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("cartoes_ultimos4", sql`${t.ultimos4} ~ '^[0-9]{4}$'`),
    check("cartoes_validade", sql`${t.validadeMes} between 1 and 12 and ${t.validadeAno} between 2020 and 2100`),
    check("cartoes_remocao_coerente", sql`(${t.status} = 'removido') = (${t.removidoEm} is not null)`),
    // Um cartao ativo por pessoa em cada clinica: a cobranca automatica nao
    // pode ter duvida sobre qual usar.
    uniqueIndex("cartoes_um_ativo_por_pessoa").on(t.perfilId, t.clinicaId).where(sql`${t.status} = 'ativo'`),
    index("cartoes_perfil").on(t.perfilId),
  ],
);

export type CartaoSalvo = typeof cartoesSalvos.$inferSelect;
