CREATE TABLE "percentuais_medicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"percentual_bps" integer NOT NULL,
	"definido_por" uuid NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "percentuais_medicos_faixa" CHECK ("percentuais_medicos"."percentual_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "repasses_medicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"pago_em" timestamp with time zone NOT NULL,
	"referencia" text NOT NULL,
	"observacao" text,
	"registrado_por" uuid NOT NULL,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repasses_valor_positivo" CHECK ("repasses_medicos"."valor_centavos" > 0),
	CONSTRAINT "repasses_referencia" CHECK (length(trim("repasses_medicos"."referencia")) between 2 and 120),
	CONSTRAINT "repasses_cancelamento_completo" CHECK (("repasses_medicos"."cancelado_em" is null and "repasses_medicos"."cancelado_por" is null and "repasses_medicos"."motivo_cancelamento" is null)
          or ("repasses_medicos"."cancelado_em" is not null and "repasses_medicos"."cancelado_por" is not null and length(trim(coalesce("repasses_medicos"."motivo_cancelamento", ''))) >= 5))
);
--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "repasse_padrao_bps" integer;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "repasse_medico_bps" integer;--> statement-breakpoint
ALTER TABLE "percentuais_medicos" ADD CONSTRAINT "percentuais_medicos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "percentuais_medicos" ADD CONSTRAINT "percentuais_medicos_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "percentuais_medicos" ADD CONSTRAINT "percentuais_medicos_definido_por_perfis_id_fk" FOREIGN KEY ("definido_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasses_medicos" ADD CONSTRAINT "repasses_medicos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasses_medicos" ADD CONSTRAINT "repasses_medicos_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasses_medicos" ADD CONSTRAINT "repasses_medicos_registrado_por_perfis_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasses_medicos" ADD CONSTRAINT "repasses_medicos_cancelado_por_perfis_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "percentuais_medicos_um_por_medico" ON "percentuais_medicos" USING btree ("clinica_id","medico_id");--> statement-breakpoint
CREATE INDEX "repasses_medicos_medico" ON "repasses_medicos" USING btree ("clinica_id","medico_id","pago_em");--> statement-breakpoint
ALTER TABLE "clinicas" ADD CONSTRAINT "clinicas_repasse_padrao_faixa" CHECK ("clinicas"."repasse_padrao_bps" is null or "clinicas"."repasse_padrao_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_repasse_faixa" CHECK ("consultas"."repasse_medico_bps" is null or "consultas"."repasse_medico_bps" between 0 and 10000);
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0026)
--  So acrescenta: a versao anterior da API continua funcionando com este banco.
-- =============================================================================
ALTER TABLE "percentuais_medicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repasses_medicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- O medico ve a propria porcentagem e os proprios repasses; a administracao ve todos.
CREATE POLICY "percentuais_medicos: medico ve o seu, administracao ve todos" ON "percentuais_medicos"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()) OR (SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
CREATE POLICY "repasses_medicos: medico ve os seus" ON "repasses_medicos"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "repasses_medicos: administracao ve os da clinica" ON "repasses_medicos"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint

-- Repasse registrado nao se apaga; so o cancelamento (com motivo) muda a linha.
CREATE OR REPLACE FUNCTION "public"."repasse_so_cancela"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Repasse registrado nao se apaga: cancele com motivo.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.cancelado_em IS NOT NULL
     OR NEW.valor_centavos <> OLD.valor_centavos OR NEW.medico_id <> OLD.medico_id OR NEW.clinica_id <> OLD.clinica_id
     OR NEW.pago_em <> OLD.pago_em OR NEW.referencia <> OLD.referencia OR NEW.registrado_por <> OLD.registrado_por THEN
    RAISE EXCEPTION 'Repasse registrado so pode ser cancelado, uma vez.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "repasses_medicos_so_cancela" BEFORE UPDATE OR DELETE ON "repasses_medicos"
  FOR EACH ROW EXECUTE FUNCTION "public"."repasse_so_cancela"();
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "percentuais_medicos" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "repasses_medicos" FROM anon, authenticated;
