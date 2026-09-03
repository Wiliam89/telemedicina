/**
 * Tabela `documentos` - receita, atestado, pedido de exame, relatorio.
 *
 * Aqui nasce o artefato que sai da plataforma e vale no mundo: a farmacia
 * aceita, o RH aceita, o laboratorio aceita. Por isso ele e tratado como
 * documento, nao como registro de banco:
 *
 *   - o CONTEUDO e congelado no momento da emissao (jsonb + texto);
 *   - o HASH (SHA-256) do conteudo canonico e guardado junto: qualquer
 *     alteracao posterior seria detectavel;
 *   - o NUMERO e sequencial por clinica e por ano (1/2026, 2/2026...),
 *     como talonario;
 *   - o CODIGO DE VALIDACAO permite a terceiros conferirem a autenticidade
 *     sem login, informando so o minimo (tipo, data, CRM) - nunca o
 *     conteudo clinico.
 *
 * As colunas de assinatura ficam prontas aqui e sao preenchidas no Modulo 9
 * (ICP-Brasil em nuvem). Documento emitido e imutavel; para desfazer,
 * cancela-se com motivo - e o cancelamento tambem fica registrado.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { clinicas } from "./clinicas.js";
import { consultas } from "./consultas.js";
import { medicos } from "./medicos.js";
import { pacientes } from "./pacientes.js";
import { perfis } from "./perfis.js";

export const tipoDocumentoEnum = pgEnum("tipo_documento", [
  "receita_simples",
  "receita_controle_especial",
  "atestado",
  "pedido_exame",
  "relatorio",
  "declaracao_comparecimento",
]);

export const statusDocumentoEnum = pgEnum("status_documento", ["emitido", "assinado", "cancelado"]);

export const documentos = pgTable(
  "documentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicaId: uuid("clinica_id")
      .notNull()
      .references(() => clinicas.id, { onDelete: "restrict" }),
    consultaId: uuid("consulta_id").references(() => consultas.id, { onDelete: "restrict" }),
    pacienteId: uuid("paciente_id")
      .notNull()
      .references(() => pacientes.perfilId, { onDelete: "restrict" }),
    medicoId: uuid("medico_id")
      .notNull()
      .references(() => medicos.perfilId, { onDelete: "restrict" }),

    tipo: tipoDocumentoEnum("tipo").notNull(),
    status: statusDocumentoEnum("status").notNull().default("emitido"),

    /** Numeracao por clinica e ano, como talonario: 1/2026, 2/2026... */
    ano: integer("ano").notNull(),
    numero: integer("numero").notNull(),

    /** O conteudo estruturado (itens da receita, dias de atestado...). */
    conteudo: jsonb("conteudo").notNull(),
    /** O mesmo conteudo em texto, exatamente como foi impresso/exibido. */
    textoImpresso: text("texto_impresso").notNull(),
    /** SHA-256 hexadecimal do texto canonico. A impressao digital do documento. */
    hash: varchar("hash", { length: 64 }).notNull(),

    /** Codigo publico de validacao. Curto o bastante para digitar. */
    codigoValidacao: varchar("codigo_validacao", { length: 24 }).notNull(),

    // --- assinatura (preenchido no Modulo 9) --------------------------------
    assinadoEm: timestamp("assinado_em", { withTimezone: true }),
    /** "birdid", "vidaas", "safeid", "a1_local"... */
    assinaturaProvedor: text("assinatura_provedor"),
    /** Identificador da assinatura no provedor, para auditoria. */
    assinaturaId: text("assinatura_id"),
    /** Caminho do PDF assinado no armazenamento (Supabase Storage). */
    arquivoUrl: text("arquivo_url"),
    /** SHA-256 do PDF assinado. Detecta troca do arquivo no armazenamento. */
    arquivoHash: varchar("arquivo_hash", { length: 64 }),
    /** Instante do carimbo do tempo da autoridade, quando o provedor aplica. */
    carimboEm: timestamp("carimbo_em", { withTimezone: true }),
    /** Titular do certificado, como consta nele: "NOME:CPF" separado. */
    assinanteNome: text("assinante_nome"),
    assinanteCpf: varchar("assinante_cpf", { length: 11 }),

    // --- cancelamento -------------------------------------------------------
    canceladoEm: timestamp("cancelado_em", { withTimezone: true }),
    canceladoPor: uuid("cancelado_por").references(() => perfis.id, { onDelete: "set null" }),
    motivoCancelamento: text("motivo_cancelamento"),

    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documentos_numero_por_clinica_ano").on(t.clinicaId, t.ano, t.numero),
    uniqueIndex("documentos_codigo_validacao").on(t.codigoValidacao),
    check("documentos_hash_formato", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check(
      "documentos_cancelamento_completo",
      sql`(${t.status} <> 'cancelado' and ${t.canceladoEm} is null) or (${t.status} = 'cancelado' and ${t.canceladoEm} is not null and ${t.motivoCancelamento} is not null)`,
    ),
    check(
      "documentos_assinatura_coerente",
      sql`(${t.status} <> 'assinado' and ${t.assinadoEm} is null)
          or (${t.status} = 'assinado' and ${t.assinadoEm} is not null and ${t.assinaturaProvedor} is not null
              and ${t.arquivoUrl} is not null and ${t.arquivoHash} is not null)`,
    ),
    check("documentos_arquivo_hash_formato", sql`${t.arquivoHash} is null or ${t.arquivoHash} ~ '^[0-9a-f]{64}$'`),
    index("documentos_paciente_criado").on(t.pacienteId, t.criadoEm),
    index("documentos_clinica_criado").on(t.clinicaId, t.criadoEm),
  ],
);

export type Documento = typeof documentos.$inferSelect;
export type NovoDocumento = typeof documentos.$inferInsert;
