/**
 * Tabela `fila_atendimento` - quem esta esperando o pronto atendimento.
 *
 * O paciente paga, entra na fila e aguarda na "sala de espera" ate um
 * medico de plantao chama-lo. E o segundo modo de atendimento da
 * plataforma, ao lado do agendamento.
 *
 * Por que a tabela nasce agora (Modulo 8) se as telas so vem no Modulo 11:
 * porque `consultas` e `pagamentos` precisam apontar para ela, e criar a
 * coluna depois significaria migrar prontuario com dado real.
 *
 * REGRA: ninguem entra na fila sem pagamento confirmado. A coluna
 * `pagamento_id` e obrigatoria, e o pagamento so vira "confirmado" quando
 * o provedor avisa (Modulo 10).
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";
import { pacientes } from "./pacientes.js";
import { pagamentos } from "./pagamentos.js";
import { plantoes } from "./plantoes.js";

export const statusFilaEnum = pgEnum("status_fila", [
  "aguardando",
  "chamado",
  "em_atendimento",
  "atendido",
  "desistiu",
  "expirado",
]);

export const filaAtendimento = pgTable(
  "fila_atendimento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    /** Ninguem entra na fila sem pagamento. Obrigatorio desde o inicio. */
    pagamentoId: uuid("pagamento_id")
      .notNull()
      .references(() => pagamentos.id, { onDelete: "restrict" }),
    status: statusFilaEnum("status").notNull().default("aguardando"),
    /** O que o paciente relata ao entrar na fila. Ajuda na triagem. */
    queixa: text("queixa"),

    /**
     * CONSENTIMENTO PARA TELEMEDICINA.
     *
     * A Resolucao CFM 2.314/2022 exige o consentimento do paciente para o
     * atendimento a distancia, e as plataformas do setor pedem isso como
     * etapa propria do fluxo - entre o pagamento e a fila.
     *
     * Guardamos QUANDO e sobre QUAL VERSAO do texto: se o termo mudar, o
     * que vale para este atendimento e a versao que a pessoa leu, nao a
     * atual. Sem isso, o registro nao prova nada.
     */
    consentimentoEm: timestamp("consentimento_em", { withTimezone: true }),
    consentimentoVersao: text("consentimento_versao"),
    /**
     * Prioridade de triagem (protocolo de Manchester, quando houver):
     * 1 = mais urgente, 5 = menos. Padrao 3 ate haver triagem.
     */
    prioridade: text("prioridade").notNull().default("3"),
    /** Mensagem do medico ao chamar, ou motivo de encerramento. */
    observacao: text("observacao"),
    entrouEm: timestamp("entrou_em", { withTimezone: true }).notNull().defaultNow(),
    chamadoEm: timestamp("chamado_em", { withTimezone: true }),
    /** Quem chamou, e a consulta que nasceu do atendimento. */
    plantaoId: uuid("plantao_id").references(() => plantoes.id, { onDelete: "set null" }),
    consultaId: uuid("consulta_id").references(() => consultas.id, { onDelete: "set null" }),
    encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Ninguem espera atendimento sem ter consentido. O banco garante.
    check(
      "fila_exige_consentimento",
      sql`${t.status} <> 'aguardando' or (${t.consentimentoEm} is not null and ${t.consentimentoVersao} is not null)`,
    ),
    // "quem esta esperando agora, por ordem" - a consulta mais frequente da fila.
    index("fila_clinica_status_entrada").on(t.clinicaId, t.status, t.entrouEm),
    index("fila_paciente").on(t.pacienteId),
  ],
);

export type ItemDaFila = typeof filaAtendimento.$inferSelect;
export type NovoItemDaFila = typeof filaAtendimento.$inferInsert;
