/**
 * Tabela `pagamentos` - o dinheiro.
 *
 * Nenhuma consulta acontece sem pagamento confirmado (agendada ou por
 * fila). Esta tabela e o registro do que foi cobrado, de quem, por qual
 * meio, e como foi repassado.
 *
 * TRES DECISOES QUE ESTAO AQUI:
 *
 * 1. VALOR EM CENTAVOS, numero inteiro. Nunca ponto flutuante: 0.1 + 0.2
 *    nao da 0.3 em binario, e em dinheiro isso vira divergencia de
 *    centavos que ninguem consegue explicar.
 *
 * 2. O SPLIT E DO GATEWAY, nao nosso. Receber o valor cheio na conta da
 *    plataforma e repassar depois caracteriza participacao em arranjo de
 *    pagamento (Circular BACEN 3.682/2013) e exigiria licenca de
 *    Instituicao de Pagamento. Guardamos aqui quanto foi de cada parte,
 *    mas quem divide e liquida e o provedor (ADR-0010).
 *
 * 3. O ESTADO VEM DO PROVEDOR, por webhook - nunca da tela. "O usuario
 *    voltou para a pagina de sucesso" nao e prova de pagamento.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";
import { perfis } from "./perfis.js";

export const metodoPagamentoEnum = pgEnum("metodo_pagamento", ["pix", "cartao_credito", "cortesia"]);

export const statusPagamentoEnum = pgEnum("status_pagamento", [
  "pendente",
  /** Cartao: valor reservado, ainda nao cobrado (pre-autorizacao). */
  "autorizado",
  "confirmado",
  "recusado",
  "estornado",
  "expirado",
]);

export const pagamentos = pgTable(
  "pagamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    /** Quem pagou. */
    pagadorId: uuid("pagador_id")
      .notNull()
      .references(() => perfis.id, { onDelete: "restrict" }),
    /** A consulta que este pagamento libera. Nulo enquanto e so fila. */
    consultaId: uuid("consulta_id").references(() => consultas.id, { onDelete: "restrict" }),

    metodo: metodoPagamentoEnum("metodo").notNull(),
    status: statusPagamentoEnum("status").notNull().default("pendente"),

    /** Tudo em centavos. bruto = clinica + plataforma + taxas. */
    valorCentavos: integer("valor_centavos").notNull(),
    valorClinicaCentavos: integer("valor_clinica_centavos").notNull(),
    valorPlataformaCentavos: integer("valor_plataforma_centavos").notNull(),

    /** "mercadopago", "pagarme", "asaas"... e o id da transacao la. */
    provedor: text("provedor").notNull(),
    provedorId: text("provedor_id"),
    /** Resposta crua do provedor, para conciliacao e disputa. */
    provedorPayload: jsonb("provedor_payload"),

    autorizadoEm: timestamp("autorizado_em", { withTimezone: true }),
    confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
    estornadoEm: timestamp("estornado_em", { withTimezone: true }),
    motivoEstorno: text("motivo_estorno"),
    expiraEm: timestamp("expira_em", { withTimezone: true }),

    /** Pix: o "copia e cola" e a imagem do QR (base64), como o provedor devolve. */
    pixCopiaECola: text("pix_copia_e_cola"),
    pixQrBase64: text("pix_qr_base64"),
    /**
     * Chave que a API manda ao provedor para ele NAO criar a mesma cobranca
     * duas vezes se a requisicao for repetida (clique duplo, retentativa de
     * rede). E nossa, gerada uma vez por tentativa.
     */
    chaveIdempotencia: uuid("chave_idempotencia").notNull().defaultRandom(),

    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("pagamentos_valores_positivos", sql`${t.valorCentavos} > 0 and ${t.valorClinicaCentavos} >= 0 and ${t.valorPlataformaCentavos} >= 0`),
    // A soma das partes nunca passa do total cobrado.
    check("pagamentos_split_fecha", sql`${t.valorClinicaCentavos} + ${t.valorPlataformaCentavos} <= ${t.valorCentavos}`),
    check("pagamentos_confirmacao_coerente", sql`${t.status} <> 'confirmado' or ${t.confirmadoEm} is not null`),
    check("pagamentos_estorno_coerente", sql`${t.status} <> 'estornado' or (${t.estornadoEm} is not null and ${t.motivoEstorno} is not null)`),
    // O mesmo id de transacao do provedor nunca entra duas vezes: e o que
    // torna o webhook seguro de reprocessar (ele chega repetido, sempre).
    uniqueIndex("pagamentos_provedor_id_unico").on(t.provedor, t.provedorId),
    index("pagamentos_clinica_criado").on(t.clinicaId, t.criadoEm),
    index("pagamentos_pagador").on(t.pagadorId),
    uniqueIndex("pagamentos_chave_idempotencia").on(t.chaveIdempotencia),
  ],
);

export type Pagamento = typeof pagamentos.$inferSelect;
export type NovoPagamento = typeof pagamentos.$inferInsert;
