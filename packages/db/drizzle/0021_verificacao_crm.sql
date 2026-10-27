CREATE TYPE "public"."metodo_verificacao_crm" AS ENUM('consulta_manual_cfm', 'servico_externo');--> statement-breakpoint
CREATE TYPE "public"."resultado_verificacao_crm" AS ENUM('verificado', 'recusado');--> statement-breakpoint
CREATE TABLE "verificacoes_crm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medico_id" uuid NOT NULL,
	"clinica_id" uuid NOT NULL,
	"resultado" "resultado_verificacao_crm" NOT NULL,
	"metodo" "metodo_verificacao_crm" NOT NULL,
	"crm" text NOT NULL,
	"crm_uf" text NOT NULL,
	"nome_no_conselho" text,
	"situacao_no_conselho" text,
	"especialidades_no_conselho" text,
	"observacao" text,
	"verificado_por" uuid,
	"valido_ate" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verificacoes_crm_validade" CHECK (("verificacoes_crm"."resultado" = 'verificado') = ("verificacoes_crm"."valido_ate" is not null)),
	CONSTRAINT "verificacoes_crm_quem" CHECK ("verificacoes_crm"."metodo" = 'servico_externo' or "verificacoes_crm"."verificado_por" is not null),
	CONSTRAINT "verificacoes_crm_recusa_explicada" CHECK ("verificacoes_crm"."resultado" = 'verificado' or length(trim(coalesce("verificacoes_crm"."observacao", ''))) >= 5)
);
--> statement-breakpoint
ALTER TABLE "verificacoes_crm" ADD CONSTRAINT "verificacoes_crm_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_crm" ADD CONSTRAINT "verificacoes_crm_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificacoes_crm" ADD CONSTRAINT "verificacoes_crm_verificado_por_perfis_id_fk" FOREIGN KEY ("verificado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verificacoes_crm_medico_clinica" ON "verificacoes_crm" USING btree ("medico_id","clinica_id","criado_em");
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0016)
--  Conferencia de CRM e prova: nao se altera nem se apaga. Para mudar a
--  situacao, registra-se uma conferencia nova.
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."somente_insercao"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Registro de % nao se altera nem se apaga. Registre um novo.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "verificacoes_crm_imutaveis" BEFORE UPDATE OR DELETE ON "verificacoes_crm"
  FOR EACH ROW EXECUTE FUNCTION "public"."somente_insercao"();
--> statement-breakpoint

ALTER TABLE "verificacoes_crm" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "verificacoes_crm: medico ve as suas" ON "verificacoes_crm"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "verificacoes_crm: administracao ve as da clinica" ON "verificacoes_crm"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "verificacoes_crm" FROM anon, authenticated;
