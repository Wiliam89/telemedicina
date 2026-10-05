/**
 * Tabela `salas_de_video` - uma sala por consulta.
 *
 * A videochamada e o momento em que a telemedicina acontece de fato. Tudo
 * que veio antes (agenda, pagamento, consentimento, fila) existe para
 * chegar aqui.
 *
 * TRES DECISOES QUE ESTAO NESTA TABELA, E POR QUE:
 *
 * 1. A SALA NASCE QUANDO ALGUEM ENTRA, NAO QUANDO A CONSULTA E MARCADA.
 *    Sala criada no provedor custa e ocupa cota. Consulta marcada e
 *    consulta que pode ser cancelada, remarcada ou simplesmente esquecida.
 *    Criar a sala na hora da entrada significa que so existe sala para
 *    atendimento que realmente comecou.
 *
 * 2. NAO GUARDAMOS TOKEN DE ENTRADA AQUI - NEM EM LUGAR NENHUM.
 *    O token e a credencial que abre a sala. Token guardado e credencial
 *    parada esperando vazamento. Cada entrada gera um token novo, curto, no
 *    nome de UMA pessoa, e ele morre sozinho. O que guardamos e so o
 *    endereco da sala, que por si nao abre nada.
 *
 * 3. `consulta_id` E UNICA.
 *    Uma consulta tem uma sala, sempre a mesma. Se o medico recarregar a
 *    pagina, ou o paciente cair e voltar, as duas pessoas precisam
 *    reencontrar-se no MESMO lugar. Duas salas para a mesma consulta seriam
 *    duas pessoas em dois lugares, cada uma esperando a outra - e o banco
 *    impede isso em vez de confiar que o codigo lembre.
 *
 * O QUE NAO EXISTE AQUI, DE PROPOSITO: coluna de gravacao. O termo de
 * consentimento que o paciente le (@tele/shared/consentimento) diz "a
 * videochamada nao e gravada". Nao ha campo para ligar gravacao porque nao
 * ha gravacao - e o provedor e configurado sem essa capacidade (ADR-0014).
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";

/**
 * Qual servico hospeda a sala. "local_teste" nao e videochamada de verdade:
 * e o modo que deixa o projeto rodar na sua maquina sem contratar ninguem.
 * A API se recusa a usar ele em producao.
 */
export const provedorVideoEnum = pgEnum("provedor_video", ["local_teste", "daily"]);

export const salasDeVideo = pgTable(
  "salas_de_video",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    /** Uma sala por consulta - garantido pelo indice unico abaixo. */
    consultaId: uuid("consulta_id")
      .notNull()
      .references(() => consultas.id, { onDelete: "restrict" }),
    provedor: provedorVideoEnum("provedor").notNull(),
    /**
     * Como o provedor chama esta sala. E com este nome que pedimos a ele
     * um token de entrada, ou que mandamos apagar a sala no fim.
     */
    nomeNoProvedor: text("nome_no_provedor").notNull(),
    /** Endereco da sala. Sozinho nao abre nada: a entrada exige token. */
    url: text("url").notNull(),
    /**
     * Quando a sala deixa de existir no provedor. Amarrado a janela da
     * consulta: sala que fica aberta para sempre e porta que fica aberta
     * para sempre.
     */
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    /**
     * Preenchido quando o medico encerra o atendimento. A partir daqui a
     * sala foi apagada no provedor, e token vazado nao abre mais nada.
     */
    encerradaEm: timestamp("encerrada_em", { withTimezone: true }),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Uma consulta, uma sala. A regra do item 3 do cabecalho.
    uniqueIndex("salas_de_video_consulta").on(t.consultaId),
    // Sala nao pode expirar antes de ser criada.
    check("salas_de_video_expira_depois_de_criada", sql`${t.expiraEm} > ${t.criadaEm}`),
    // "esta sala ainda vale?" - a pergunta de toda entrada.
    index("salas_de_video_clinica_expira").on(t.clinicaId, t.expiraEm),
  ],
);

export type SalaDeVideo = typeof salasDeVideo.$inferSelect;
export type NovaSalaDeVideo = typeof salasDeVideo.$inferInsert;
