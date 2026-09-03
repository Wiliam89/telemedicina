/**
 * Tabela `evolucoes` - o REGISTRO CLINICO de um atendimento.
 *
 * E o coracao do prontuario. Segue o formato SOAP, que e como o medico ja
 * pensa e escreve:
 *   S (subjetivo)  o que o paciente relata
 *   O (objetivo)   o que o medico constata
 *   A (avaliacao)  a hipotese diagnostica
 *   P (plano)      a conduta
 *
 * A REGRA QUE MANDA AQUI: enquanto e rascunho, o medico edita a vontade.
 * Depois de FINALIZADA, a linha vira pedra - nao se altera nem se apaga,
 * nem pelo autor, nem pelo administrador, nem pela API com chave secreta.
 * Um gatilho no banco garante isso (migracao 0010).
 *
 * Errou depois de finalizar? Escreve-se um ADENDO, que aponta para a
 * evolucao original. E como se faz em prontuario de papel: nao se rasura,
 * acrescenta-se. A CFM 1.821/2007 exige justamente que o sistema permita
 * "tirar conclusoes satisfatorias sobre a validade" do que foi registrado.
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";
import { medicos } from "./medicos.js";
import { pacientes } from "./pacientes.js";

export const statusEvolucaoEnum = pgEnum("status_evolucao", ["rascunho", "finalizada"]);

export const evolucoes = pgTable(
  "evolucoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    consultaId: uuid("consulta_id")
      .notNull()
      .references(() => consultas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    /** Quem escreveu. So o medico da consulta pode. */
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),

    status: statusEvolucaoEnum("status").notNull().default("rascunho"),

    subjetivo: text("subjetivo"),
    objetivo: text("objetivo"),
    avaliacao: text("avaliacao"),
    plano: text("plano"),
    /** CID-10, quando houver. Texto livre por enquanto; vira tabela propria. */
    cid10: text("cid10"),

    /**
     * Adendo: aponta para a evolucao que ele corrige ou complementa.
     * Nulo em evolucao normal. A original NUNCA muda.
     */
    adendoDe: uuid("adendo_de"),

    finalizadaEm: timestamp("finalizada_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Finalizada tem data de finalizacao; rascunho nao tem. Os dois andam juntos.
    check(
      "evolucoes_finalizacao_coerente",
      sql`(${t.status} = 'rascunho' and ${t.finalizadaEm} is null) or (${t.status} = 'finalizada' and ${t.finalizadaEm} is not null)`,
    ),
    // Registro vazio nao e registro: ao menos um campo do SOAP preenchido.
    check(
      "evolucoes_conteudo_minimo",
      sql`${t.status} = 'rascunho' or coalesce(${t.subjetivo}, '') || coalesce(${t.objetivo}, '') || coalesce(${t.avaliacao}, '') || coalesce(${t.plano}, '') <> ''`,
    ),
    index("evolucoes_paciente_criado").on(t.pacienteId, t.criadoEm),
    index("evolucoes_consulta").on(t.consultaId),
    index("evolucoes_clinica_criado").on(t.clinicaId, t.criadoEm),
  ],
);

export type Evolucao = typeof evolucoes.$inferSelect;
export type NovaEvolucao = typeof evolucoes.$inferInsert;
