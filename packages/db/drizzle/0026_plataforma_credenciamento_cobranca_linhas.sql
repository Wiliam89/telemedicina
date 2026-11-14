CREATE TYPE "public"."status_cartao" AS ENUM('ativo', 'removido');--> statement-breakpoint
CREATE TYPE "public"."forma_de_cobranca" AS ENUM('antecipada', 'cartao_ao_final');--> statement-breakpoint
CREATE TYPE "public"."linha_atendimento" AS ENUM('pronto_atendimento', 'teleconsulta');--> statement-breakpoint
CREATE TYPE "public"."status_credenciamento" AS ENUM('rascunho', 'em_analise', 'pendente_de_ajuste', 'aprovado', 'recusado');--> statement-breakpoint
CREATE TYPE "public"."status_verificacao_identidade" AS ENUM('pendente', 'aprovada', 'reprovada', 'inconclusiva');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento_do_medico" AS ENUM('identidade_frente', 'identidade_verso', 'carteira_crm', 'diploma', 'titulo_especialista', 'comprovante_endereco', 'selfie');--> statement-breakpoint
ALTER TYPE "public"."tipo_atendimento" ADD VALUE 'teleconsulta_imediata';--> statement-breakpoint
ALTER TYPE "public"."tipo_atendimento" ADD VALUE 'pronto_agendado';--> statement-breakpoint
ALTER TYPE "public"."tipo_notificacao" ADD VALUE 'chamado_na_fila';--> statement-breakpoint
ALTER TYPE "public"."tipo_notificacao" ADD VALUE 'credenciamento';--> statement-breakpoint
ALTER TYPE "public"."tipo_notificacao" ADD VALUE 'pagamento';--> statement-breakpoint
CREATE TABLE "cartoes_salvos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"clinica_id" uuid NOT NULL,
	"provedor" text NOT NULL,
	"provedor_cliente_id" text NOT NULL,
	"provedor_cartao_id" text NOT NULL,
	"bandeira" varchar(30) NOT NULL,
	"ultimos4" varchar(4) NOT NULL,
	"validade_mes" smallint NOT NULL,
	"validade_ano" smallint NOT NULL,
	"status" "status_cartao" DEFAULT 'ativo' NOT NULL,
	"autorizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"autorizacao_versao" text NOT NULL,
	"removido_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cartoes_ultimos4" CHECK ("cartoes_salvos"."ultimos4" ~ '^[0-9]{4}$'),
	CONSTRAINT "cartoes_validade" CHECK ("cartoes_salvos"."validade_mes" between 1 and 12 and "cartoes_salvos"."validade_ano" between 2020 and 2100),
	CONSTRAINT "cartoes_remocao_coerente" CHECK (("cartoes_salvos"."status" = 'removido') = ("cartoes_salvos"."removido_em" is not null))
);
--> statement-breakpoint
CREATE TABLE "credenciamentos_medicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"status" "status_credenciamento" DEFAULT 'rascunho' NOT NULL,
	"especialidades_solicitadas" text[] DEFAULT '{}'::text[] NOT NULL,
	"quer_pronto_atendimento" boolean DEFAULT true NOT NULL,
	"rqe" text,
	"consentimento_biometria_em" timestamp with time zone,
	"consentimento_biometria_versao" text,
	"enviado_em" timestamp with time zone,
	"decidido_em" timestamp with time zone,
	"decidido_por" uuid,
	"motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credenciamentos_decisao_completa" CHECK ("credenciamentos_medicos"."status" not in ('aprovado', 'recusado', 'pendente_de_ajuste') or ("credenciamentos_medicos"."decidido_em" is not null and "credenciamentos_medicos"."decidido_por" is not null)),
	CONSTRAINT "credenciamentos_recusa_explicada" CHECK ("credenciamentos_medicos"."status" not in ('recusado', 'pendente_de_ajuste') or length(trim(coalesce("credenciamentos_medicos"."motivo", ''))) >= 5),
	CONSTRAINT "credenciamentos_envio" CHECK ("credenciamentos_medicos"."status" = 'rascunho' or "credenciamentos_medicos"."enviado_em" is not null),
	CONSTRAINT "credenciamentos_biometria" CHECK ("credenciamentos_medicos"."status" = 'rascunho' or ("credenciamentos_medicos"."consentimento_biometria_em" is not null and "credenciamentos_medicos"."consentimento_biometria_versao" is not null))
);
--> statement-breakpoint
CREATE TABLE "documentos_do_medico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"tipo" "tipo_documento_do_medico" NOT NULL,
	"caminho" text NOT NULL,
	"tipo_arquivo" varchar(60) NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documentos_do_medico_hash" CHECK ("documentos_do_medico"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documentos_do_medico_tamanho" CHECK ("documentos_do_medico"."tamanho_bytes" > 0 and "documentos_do_medico"."tamanho_bytes" <= 15728640)
);
--> statement-breakpoint
CREATE TABLE "verificacoes_de_identidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"provedor" text NOT NULL,
	"status" "status_verificacao_identidade" NOT NULL,
	"pontuacao" smallint,
	"referencia" text,
	"selfie_id" uuid,
	"documento_id" uuid,
	"detalhes" jsonb,
	"observacao" text,
	"verificado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verificacoes_identidade_pontuacao" CHECK ("verificacoes_de_identidade"."pontuacao" is null or "verificacoes_de_identidade"."pontuacao" between 0 and 100),
	CONSTRAINT "verificacoes_identidade_manual_tem_autor" CHECK ("verificacoes_de_identidade"."provedor" <> 'manual' or "verificacoes_de_identidade"."status" = 'pendente' or "verificacoes_de_identidade"."verificado_por" is not null),
	CONSTRAINT "verificacoes_identidade_reprovacao_explicada" CHECK ("verificacoes_de_identidade"."provedor" <> 'manual' or "verificacoes_de_identidade"."status" <> 'reprovada' or length(trim(coalesce("verificacoes_de_identidade"."observacao", ''))) >= 5)
);
--> statement-breakpoint
DROP INDEX "precos_clinica_tipo_medico";--> statement-breakpoint
ALTER TABLE "fila_atendimento" ALTER COLUMN "pagamento_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "medicos" ADD COLUMN "especialidades" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "medicos" ADD COLUMN "atende_pronto_atendimento" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "linha" "linha_atendimento" DEFAULT 'teleconsulta' NOT NULL;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "especialidade" text;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "forma_de_cobranca" "forma_de_cobranca" DEFAULT 'antecipada' NOT NULL;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "cartao_id" uuid;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "valor_combinado_centavos" integer;--> statement-breakpoint
ALTER TABLE "precos" ADD COLUMN "especialidade" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "cartao_id" uuid;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD COLUMN "cartao_id" uuid;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD COLUMN "valor_combinado_centavos" integer;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD COLUMN "linha" "linha_atendimento" DEFAULT 'pronto_atendimento' NOT NULL;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD COLUMN "especialidade" text;--> statement-breakpoint
ALTER TABLE "cartoes_salvos" ADD CONSTRAINT "cartoes_salvos_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cartoes_salvos" ADD CONSTRAINT "cartoes_salvos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciamentos_medicos" ADD CONSTRAINT "credenciamentos_medicos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciamentos_medicos" ADD CONSTRAINT "credenciamentos_medicos_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciamentos_medicos" ADD CONSTRAINT "credenciamentos_medicos_decidido_por_perfis_id_fk" FOREIGN KEY ("decidido_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_do_medico" ADD CONSTRAINT "documentos_do_medico_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_do_medico" ADD CONSTRAINT "documentos_do_medico_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_de_identidade" ADD CONSTRAINT "verificacoes_de_identidade_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_de_identidade" ADD CONSTRAINT "verificacoes_de_identidade_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_de_identidade" ADD CONSTRAINT "verificacoes_de_identidade_selfie_id_documentos_do_medico_id_fk" FOREIGN KEY ("selfie_id") REFERENCES "public"."documentos_do_medico"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_de_identidade" ADD CONSTRAINT "verificacoes_de_identidade_documento_id_documentos_do_medico_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documentos_do_medico"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_de_identidade" ADD CONSTRAINT "verificacoes_de_identidade_verificado_por_perfis_id_fk" FOREIGN KEY ("verificado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cartoes_um_ativo_por_pessoa" ON "cartoes_salvos" USING btree ("perfil_id","clinica_id") WHERE "cartoes_salvos"."status" = 'ativo';--> statement-breakpoint
CREATE INDEX "cartoes_perfil" ON "cartoes_salvos" USING btree ("perfil_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credenciamentos_medico_clinica" ON "credenciamentos_medicos" USING btree ("medico_id","clinica_id");--> statement-breakpoint
CREATE INDEX "credenciamentos_clinica_status" ON "credenciamentos_medicos" USING btree ("clinica_id","status");--> statement-breakpoint
CREATE INDEX "documentos_do_medico_atual" ON "documentos_do_medico" USING btree ("medico_id","clinica_id","tipo","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_do_medico_caminho" ON "documentos_do_medico" USING btree ("caminho");--> statement-breakpoint
CREATE INDEX "verificacoes_identidade_medico" ON "verificacoes_de_identidade" USING btree ("medico_id","clinica_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "verificacoes_identidade_referencia" ON "verificacoes_de_identidade" USING btree ("referencia","status");--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_cartao_id_cartoes_salvos_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes_salvos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_cartao_id_cartoes_salvos_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes_salvos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_atendimento_cartao_id_cartoes_salvos_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes_salvos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultas_a_cobrar" ON "consultas" USING btree ("status","forma_de_cobranca");--> statement-breakpoint
CREATE INDEX "fila_despacho" ON "fila_atendimento" USING btree ("clinica_id","status","linha","especialidade","entrou_em");--> statement-breakpoint
-- (escrito a mao) O indice antigo deixava passar dois "precos padrao" do mesmo
-- tipo, porque nulo nao repete. Antes da regra nova, fica so o mais recente.
DELETE FROM "precos" a USING "precos" b
  WHERE a."clinica_id" = b."clinica_id" AND a."tipo" = b."tipo"
    AND a."medico_id" IS NOT DISTINCT FROM b."medico_id"
    AND a."especialidade" IS NOT DISTINCT FROM b."especialidade"
    AND (a."atualizado_em", a."id") < (b."atualizado_em", b."id");--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_clinica_tipo_medico_especialidade" UNIQUE NULLS NOT DISTINCT("clinica_id","tipo","medico_id","especialidade");--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_cartao_ao_final_completo" CHECK ("consultas"."forma_de_cobranca" <> 'cartao_ao_final' or ("consultas"."cartao_id" is not null and "consultas"."valor_combinado_centavos" is not null));--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_valor_combinado" CHECK ("consultas"."valor_combinado_centavos" is null or "consultas"."valor_combinado_centavos" > 0);--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_medico_ou_especialidade" CHECK ("precos"."medico_id" is null or "precos"."especialidade" is null);--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_exige_garantia_de_pagamento" CHECK ("fila_atendimento"."pagamento_id" is not null or ("fila_atendimento"."cartao_id" is not null and "fila_atendimento"."valor_combinado_centavos" is not null));--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_especialidade_da_linha" CHECK (("fila_atendimento"."linha" = 'teleconsulta') = ("fila_atendimento"."especialidade" is not null));
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0022 a ADR-0025)
--
--  COMPATIBILIDADE: tudo aqui so ACRESCENTA. A versao anterior da API continua
--  funcionando com este banco (colunas novas tem valor padrao, e a coluna que
--  deixou de ser obrigatoria continua sendo preenchida por ela).
-- =============================================================================

-- Consulta que nasceu da fila sempre foi pronto atendimento.
UPDATE "consultas" SET "linha" = 'pronto_atendimento'
  WHERE "id" IN (SELECT "consulta_id" FROM "fila_atendimento" WHERE "consulta_id" IS NOT NULL);
--> statement-breakpoint

-- Documento enviado e conferencia de identidade sao prova: nao se alteram nem
-- se apagam. Documento novo e linha nova; vale o mais recente de cada tipo.
CREATE TRIGGER "documentos_do_medico_imutaveis" BEFORE UPDATE OR DELETE ON "documentos_do_medico"
  FOR EACH ROW EXECUTE FUNCTION "public"."somente_insercao"();
--> statement-breakpoint
CREATE TRIGGER "verificacoes_de_identidade_imutaveis" BEFORE UPDATE OR DELETE ON "verificacoes_de_identidade"
  FOR EACH ROW EXECUTE FUNCTION "public"."somente_insercao"();
--> statement-breakpoint

ALTER TABLE "cartoes_salvos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credenciamentos_medicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documentos_do_medico" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verificacoes_de_identidade" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- O cartao e de quem o cadastrou. Nem a administracao o ve.
CREATE POLICY "cartoes_salvos: cada um ve o seu" ON "cartoes_salvos"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "credenciamentos_medicos: medico ve o seu" ON "credenciamentos_medicos"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "credenciamentos_medicos: administracao ve os da clinica" ON "credenciamentos_medicos"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
CREATE POLICY "documentos_do_medico: medico ve os seus" ON "documentos_do_medico"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "documentos_do_medico: administracao ve os da clinica" ON "documentos_do_medico"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
CREATE POLICY "verificacoes_de_identidade: medico ve as suas" ON "verificacoes_de_identidade"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "verificacoes_de_identidade: administracao ve as da clinica" ON "verificacoes_de_identidade"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint

-- Tudo se grava pela API.
REVOKE INSERT, UPDATE, DELETE ON "cartoes_salvos" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "credenciamentos_medicos" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "documentos_do_medico" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "verificacoes_de_identidade" FROM anon, authenticated;
