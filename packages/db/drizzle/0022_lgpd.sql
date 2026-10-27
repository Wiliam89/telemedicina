CREATE TYPE "public"."acao_consentimento" AS ENUM('aceito', 'revogado');--> statement-breakpoint
CREATE TYPE "public"."status_solicitacao_titular" AS ENUM('aberta', 'em_andamento', 'concluida', 'negada');--> statement-breakpoint
CREATE TYPE "public"."tipo_consentimento" AS ENUM('termos_de_uso', 'politica_de_privacidade', 'telemedicina');--> statement-breakpoint
CREATE TYPE "public"."tipo_solicitacao_titular" AS ENUM('confirmacao_e_acesso', 'correcao', 'anonimizacao_ou_exclusao', 'portabilidade', 'informacao_compartilhamento', 'revogacao_consentimento', 'outro');--> statement-breakpoint
CREATE TABLE "consentimentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"tipo" "tipo_consentimento" NOT NULL,
	"acao" "acao_consentimento" NOT NULL,
	"versao" text NOT NULL,
	"ip" "inet",
	"navegador" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solicitacoes_titular" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"clinica_id" uuid,
	"tipo" "tipo_solicitacao_titular" NOT NULL,
	"descricao" text NOT NULL,
	"status" "status_solicitacao_titular" DEFAULT 'aberta' NOT NULL,
	"resposta" text,
	"respondido_por" uuid,
	"respondido_em" timestamp with time zone,
	"prazo" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solicitacoes_titular_descricao" CHECK (length(trim("solicitacoes_titular"."descricao")) between 10 and 3000),
	CONSTRAINT "solicitacoes_titular_resposta" CHECK (("solicitacoes_titular"."status" in ('aberta','em_andamento')) or ("solicitacoes_titular"."resposta" is not null and "solicitacoes_titular"."respondido_em" is not null))
);
--> statement-breakpoint
ALTER TABLE "consentimentos" ADD CONSTRAINT "consentimentos_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacoes_titular" ADD CONSTRAINT "solicitacoes_titular_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacoes_titular" ADD CONSTRAINT "solicitacoes_titular_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacoes_titular" ADD CONSTRAINT "solicitacoes_titular_respondido_por_perfis_id_fk" FOREIGN KEY ("respondido_por") REFERENCES "public"."perfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consentimentos_perfil_tipo" ON "consentimentos" USING btree ("perfil_id","tipo","criado_em");--> statement-breakpoint
CREATE INDEX "solicitacoes_titular_perfil" ON "solicitacoes_titular" USING btree ("perfil_id","criado_em");--> statement-breakpoint
CREATE INDEX "solicitacoes_titular_clinica" ON "solicitacoes_titular" USING btree ("clinica_id","status","prazo");
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0018)
-- =============================================================================
-- Consentimento e prova: aceitar e revogar sao linhas novas, nunca edicao.
CREATE TRIGGER "consentimentos_imutaveis" BEFORE UPDATE OR DELETE ON "consentimentos"
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION "public"."somente_insercao"();
--> statement-breakpoint

ALTER TABLE "consentimentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "solicitacoes_titular" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "consentimentos: titular ve os seus" ON "consentimentos"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "solicitacoes_titular: titular ve as suas" ON "solicitacoes_titular"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "solicitacoes_titular: administracao ve as dirigidas a clinica" ON "solicitacoes_titular"
  FOR SELECT TO authenticated
  USING ("clinica_id" IS NOT NULL AND (SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "consentimentos" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "solicitacoes_titular" FROM anon, authenticated;
