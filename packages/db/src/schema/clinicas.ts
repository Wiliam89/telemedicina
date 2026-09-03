/**
 * Tabela `clinicas` - o cliente da plataforma (o "tenant").
 *
 * Uma clinica e a unidade de isolamento: todo dado assistencial pertence a
 * uma, e nenhuma enxerga a outra (ADR-0008). O `slug` e o subdominio pelo
 * qual a equipe acessa: clinicavida.plataforma.com.br.
 *
 * `responsavel_tecnico_id` e o medico RT - exigencia da Resolucao CFM
 * 2.314/2022 para servicos de telemedicina. A coluna aceita nulo apenas
 * durante a criacao (o RT e definido assim que ha um medico vinculado);
 * a rota de ativacao exige que esteja preenchida.
 */
import { pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { perfis } from "./perfis.js";

export const statusClinicaEnum = pgEnum("status_clinica", ["em_implantacao", "ativa", "suspensa", "encerrada"]);

export const clinicas = pgTable("clinicas", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Subdominio. So minusculas, numeros e hifen. Unico e imutavel na pratica. */
  slug: varchar("slug", { length: 40 }).notNull().unique(),
  nomeFantasia: text("nome_fantasia").notNull(),
  razaoSocial: text("razao_social").notNull(),
  /** So os 14 digitos, sem pontuacao. */
  cnpj: varchar("cnpj", { length: 14 }).notNull().unique(),
  status: statusClinicaEnum("status").notNull().default("em_implantacao"),
  /**
   * Fuso horario da clinica, no formato IANA ("America/Sao_Paulo",
   * "America/Manaus", "America/Rio_Branco"). E o fuso em que a grade
   * semanal do medico e lida e em que os horarios sao exibidos.
   *
   * Nao guardamos "-03:00": o deslocamento muda com horario de verao, e o
   * nome IANA carrega esse historico. Ver ADR-0009.
   */
  fusoHorario: text("fuso_horario").notNull().default("America/Sao_Paulo"),
  responsavelTecnicoId: uuid("responsavel_tecnico_id").references(() => perfis.id, { onDelete: "restrict" }),

  /**
   * ASSINATURA DIGITAL - credenciais PROPRIAS desta clinica (opcional).
   *
   * Duas formas de operar, e a plataforma suporta as duas:
   *
   *   a) a clinica tem contrato proprio com o provedor de certificado.
   *      Preenche estas colunas, e a fatura vai para ela.
   *   b) a clinica nao tem. Fica em branco, e a plataforma usa as
   *      credenciais dela (apps/api/.env).
   *
   * Em ambos os casos, os CREDITOS de assinatura sao consumidos no
   * certificado do MEDICO - isto aqui e so a credencial da aplicacao.
   *
   * O segredo NUNCA e guardado em claro: a coluna abaixo tem o valor
   * cifrado com AES-256-GCM, e a chave vive fora do banco (ADR-0012).
   */
  assinaturaProvedor: text("assinatura_provedor"),
  assinaturaUrl: text("assinatura_url"),
  assinaturaClientId: text("assinatura_client_id"),
  assinaturaClientSecretCifrado: text("assinatura_client_secret_cifrado"),

  /**
   * RECEBIMENTO - a conta da clinica no provedor de pagamento.
   *
   * O split e executado pelo PROVEDOR, nunca por nos: receber o valor cheio
   * e repassar depois caracteriza participacao em arranjo de pagamento
   * (Circular BACEN 3.682/2013) e exigiria licenca de Instituicao de
   * Pagamento. Para o provedor dividir, ele precisa de autorizacao da
   * clinica - que ela da por OAuth, e que resulta nas credenciais abaixo.
   *
   * ATENCAO AO PRAZO: o token de vendedor VENCE (seis meses no Mercado
   * Pago). Vencido sem renovacao, os repasses param. Por isso guardamos
   * `pagamentoTokenExpiraEm` e avisamos antes.
   */
  pagamentoProvedor: text("pagamento_provedor"),
  /** Identificador da conta da clinica no provedor. */
  pagamentoContaId: text("pagamento_conta_id"),
  /** Cifrados com AES-256-GCM, como o segredo da assinatura. */
  pagamentoTokenCifrado: text("pagamento_token_cifrado"),
  pagamentoRefreshCifrado: text("pagamento_refresh_cifrado"),
  pagamentoTokenExpiraEm: timestamp("pagamento_token_expira_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export type Clinica = typeof clinicas.$inferSelect;
export type NovaClinica = typeof clinicas.$inferInsert;
