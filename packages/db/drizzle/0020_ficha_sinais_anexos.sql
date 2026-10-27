CREATE TYPE "public"."categoria_anexo" AS ENUM('exame_laboratorial', 'exame_imagem', 'laudo', 'receita_externa', 'outro');--> statement-breakpoint
CREATE TYPE "public"."origem_registro" AS ENUM('profissional', 'paciente');--> statement-breakpoint
CREATE TABLE "anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"consulta_id" uuid,
	"origem" "origem_registro" NOT NULL,
	"enviado_por" uuid NOT NULL,
	"categoria" "categoria_anexo" NOT NULL,
	"titulo" text NOT NULL,
	"data_do_exame" timestamp with time zone,
	"caminho" text NOT NULL,
	"tipo_arquivo" varchar(60) NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anexos_hash_formato" CHECK ("anexos"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "anexos_tamanho" CHECK ("anexos"."tamanho_bytes" > 0 and "anexos"."tamanho_bytes" <= 15728640),
	CONSTRAINT "anexos_titulo" CHECK (length(trim("anexos"."titulo")) between 2 and 160)
);
--> statement-breakpoint
CREATE TABLE "fichas_clinicas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"versao" integer NOT NULL,
	"alergias" text[] DEFAULT '{}'::text[] NOT NULL,
	"nega_alergias" boolean DEFAULT false NOT NULL,
	"medicamentos_em_uso" text[] DEFAULT '{}'::text[] NOT NULL,
	"comorbidades" text,
	"antecedentes_familiares" text,
	"cirurgias_internacoes" text,
	"habitos" text,
	"tipo_sanguineo" varchar(3),
	"observacoes" text,
	"registrado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fichas_clinicas_versao_positiva" CHECK ("fichas_clinicas"."versao" >= 1),
	CONSTRAINT "fichas_clinicas_alergias_coerentes" CHECK (not ("fichas_clinicas"."nega_alergias" and cardinality("fichas_clinicas"."alergias") > 0)),
	CONSTRAINT "fichas_clinicas_tipo_sanguineo" CHECK ("fichas_clinicas"."tipo_sanguineo" is null or "fichas_clinicas"."tipo_sanguineo" in ('A+','A-','B+','B-','AB+','AB-','O+','O-'))
);
--> statement-breakpoint
CREATE TABLE "sinais_vitais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"consulta_id" uuid,
	"origem" "origem_registro" NOT NULL,
	"registrado_por" uuid NOT NULL,
	"medido_em" timestamp with time zone NOT NULL,
	"peso_kg" numeric(5, 2),
	"altura_cm" numeric(5, 1),
	"pressao_sistolica" smallint,
	"pressao_diastolica" smallint,
	"frequencia_cardiaca" smallint,
	"frequencia_respiratoria" smallint,
	"temperatura_c" numeric(4, 1),
	"saturacao_o2" smallint,
	"glicemia_mg_dl" smallint,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sinais_vitais_peso" CHECK ("sinais_vitais"."peso_kg" is null or ("sinais_vitais"."peso_kg" > 0.3 and "sinais_vitais"."peso_kg" < 400)),
	CONSTRAINT "sinais_vitais_altura" CHECK ("sinais_vitais"."altura_cm" is null or ("sinais_vitais"."altura_cm" > 20 and "sinais_vitais"."altura_cm" < 260)),
	CONSTRAINT "sinais_vitais_pa" CHECK (("sinais_vitais"."pressao_sistolica" is null) = ("sinais_vitais"."pressao_diastolica" is null)
      and ("sinais_vitais"."pressao_sistolica" is null or ("sinais_vitais"."pressao_sistolica" between 40 and 300 and "sinais_vitais"."pressao_diastolica" between 20 and 200 and "sinais_vitais"."pressao_sistolica" > "sinais_vitais"."pressao_diastolica"))),
	CONSTRAINT "sinais_vitais_fc" CHECK ("sinais_vitais"."frequencia_cardiaca" is null or "sinais_vitais"."frequencia_cardiaca" between 20 and 250),
	CONSTRAINT "sinais_vitais_fr" CHECK ("sinais_vitais"."frequencia_respiratoria" is null or "sinais_vitais"."frequencia_respiratoria" between 4 and 80),
	CONSTRAINT "sinais_vitais_temperatura" CHECK ("sinais_vitais"."temperatura_c" is null or "sinais_vitais"."temperatura_c" between 30 and 45),
	CONSTRAINT "sinais_vitais_saturacao" CHECK ("sinais_vitais"."saturacao_o2" is null or "sinais_vitais"."saturacao_o2" between 50 and 100),
	CONSTRAINT "sinais_vitais_glicemia" CHECK ("sinais_vitais"."glicemia_mg_dl" is null or "sinais_vitais"."glicemia_mg_dl" between 10 and 1500),
	CONSTRAINT "sinais_vitais_algum_valor" CHECK (coalesce("sinais_vitais"."peso_kg"::text, "sinais_vitais"."altura_cm"::text, "sinais_vitais"."pressao_sistolica"::text, "sinais_vitais"."frequencia_cardiaca"::text,
        "sinais_vitais"."frequencia_respiratoria"::text, "sinais_vitais"."temperatura_c"::text, "sinais_vitais"."saturacao_o2"::text, "sinais_vitais"."glicemia_mg_dl"::text) is not null)
);
--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_enviado_por_perfis_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas_clinicas" ADD CONSTRAINT "fichas_clinicas_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas_clinicas" ADD CONSTRAINT "fichas_clinicas_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas_clinicas" ADD CONSTRAINT "fichas_clinicas_registrado_por_perfis_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinais_vitais" ADD CONSTRAINT "sinais_vitais_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinais_vitais" ADD CONSTRAINT "sinais_vitais_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinais_vitais" ADD CONSTRAINT "sinais_vitais_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinais_vitais" ADD CONSTRAINT "sinais_vitais_registrado_por_perfis_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anexos_paciente_criado" ON "anexos" USING btree ("clinica_id","paciente_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "anexos_caminho" ON "anexos" USING btree ("caminho");--> statement-breakpoint
CREATE UNIQUE INDEX "fichas_clinicas_versao" ON "fichas_clinicas" USING btree ("clinica_id","paciente_id","versao");--> statement-breakpoint
CREATE INDEX "sinais_vitais_paciente_medido" ON "sinais_vitais" USING btree ("clinica_id","paciente_id","medido_em");
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0015)
--
--  1) As tres tabelas sao SOMENTE INSERCAO - como a evolucao finalizada.
--     A ficha ganha versao nova; sinal vital errado se corrige com outra
--     medida; anexo enviado fica (o arquivo e a prova de que existiu).
--  2) RLS: o paciente le o que e dele; o medico le de quem ele atende
--     naquela clinica. Recepcao e administracao NAO leem dado clinico.
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."registro_clinico_somente_insercao"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Registro clinico (%) nao se altera nem se apaga. Registre um novo.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "fichas_clinicas_imutaveis" BEFORE UPDATE OR DELETE ON "fichas_clinicas"
  FOR EACH ROW EXECUTE FUNCTION "public"."registro_clinico_somente_insercao"();
--> statement-breakpoint
CREATE TRIGGER "sinais_vitais_imutaveis" BEFORE UPDATE OR DELETE ON "sinais_vitais"
  FOR EACH ROW EXECUTE FUNCTION "public"."registro_clinico_somente_insercao"();
--> statement-breakpoint
CREATE TRIGGER "anexos_imutaveis" BEFORE UPDATE OR DELETE ON "anexos"
  FOR EACH ROW EXECUTE FUNCTION "public"."registro_clinico_somente_insercao"();
--> statement-breakpoint

ALTER TABLE "fichas_clinicas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sinais_vitais" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "anexos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "fichas_clinicas: paciente le a propria" ON "fichas_clinicas"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "fichas_clinicas: medico le a de quem atende" ON "fichas_clinicas"
  FOR SELECT TO authenticated
  USING (
    (SELECT "public"."tem_papel"("clinica_id", ARRAY['medico']::"public"."papel_vinculo"[]))
    AND EXISTS (
      SELECT 1 FROM "consultas" c
      WHERE c."clinica_id" = "fichas_clinicas"."clinica_id"
        AND c."paciente_id" = "fichas_clinicas"."paciente_id"
        AND c."medico_id" = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

CREATE POLICY "sinais_vitais: paciente le os proprios" ON "sinais_vitais"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "sinais_vitais: medico le os de quem atende" ON "sinais_vitais"
  FOR SELECT TO authenticated
  USING (
    (SELECT "public"."tem_papel"("clinica_id", ARRAY['medico']::"public"."papel_vinculo"[]))
    AND EXISTS (
      SELECT 1 FROM "consultas" c
      WHERE c."clinica_id" = "sinais_vitais"."clinica_id"
        AND c."paciente_id" = "sinais_vitais"."paciente_id"
        AND c."medico_id" = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

CREATE POLICY "anexos: paciente le os proprios" ON "anexos"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "anexos: medico le os de quem atende" ON "anexos"
  FOR SELECT TO authenticated
  USING (
    (SELECT "public"."tem_papel"("clinica_id", ARRAY['medico']::"public"."papel_vinculo"[]))
    AND EXISTS (
      SELECT 1 FROM "consultas" c
      WHERE c."clinica_id" = "anexos"."clinica_id"
        AND c."paciente_id" = "anexos"."paciente_id"
        AND c."medico_id" = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

-- Escrever e so pela API: e ela que confere a relacao assistencial, valida o
-- arquivo, guarda no armazenamento privado e audita.
REVOKE INSERT, UPDATE, DELETE ON "fichas_clinicas" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "sinais_vitais" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "anexos" FROM anon, authenticated;
