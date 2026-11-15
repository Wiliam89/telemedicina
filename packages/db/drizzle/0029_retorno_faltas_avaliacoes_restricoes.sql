CREATE TABLE "avaliacoes_consulta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"consulta_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"nota" integer NOT NULL,
	"comentario" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avaliacoes_nota_faixa" CHECK ("avaliacoes_consulta"."nota" between 0 and 10),
	CONSTRAINT "avaliacoes_comentario_curto" CHECK ("avaliacoes_consulta"."comentario" is null or length("avaliacoes_consulta"."comentario") <= 500)
);
--> statement-breakpoint
CREATE TABLE "restricoes_pacientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"motivo" text NOT NULL,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"encerrado_em" timestamp with time zone,
	"encerrado_por" uuid,
	CONSTRAINT "restricoes_motivo" CHECK (length(trim("restricoes_pacientes"."motivo")) between 5 and 300),
	CONSTRAINT "restricoes_encerramento_completo" CHECK (("restricoes_pacientes"."encerrado_em" is null) = ("restricoes_pacientes"."encerrado_por" is null))
);
--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "retorno_prazo_maximo_dias" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "retorno_ate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "retorno_de" uuid;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "ausencia" text;--> statement-breakpoint
ALTER TABLE "avaliacoes_consulta" ADD CONSTRAINT "avaliacoes_consulta_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avaliacoes_consulta" ADD CONSTRAINT "avaliacoes_consulta_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avaliacoes_consulta" ADD CONSTRAINT "avaliacoes_consulta_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avaliacoes_consulta" ADD CONSTRAINT "avaliacoes_consulta_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricoes_pacientes" ADD CONSTRAINT "restricoes_pacientes_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricoes_pacientes" ADD CONSTRAINT "restricoes_pacientes_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricoes_pacientes" ADD CONSTRAINT "restricoes_pacientes_criado_por_perfis_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricoes_pacientes" ADD CONSTRAINT "restricoes_pacientes_encerrado_por_perfis_id_fk" FOREIGN KEY ("encerrado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "avaliacoes_uma_por_consulta" ON "avaliacoes_consulta" USING btree ("consulta_id");--> statement-breakpoint
CREATE INDEX "avaliacoes_clinica_data" ON "avaliacoes_consulta" USING btree ("clinica_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "restricoes_uma_em_vigor" ON "restricoes_pacientes" USING btree ("clinica_id","paciente_id") WHERE "restricoes_pacientes"."encerrado_em" is null;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_retorno_de_consultas_id_fk" FOREIGN KEY ("retorno_de") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consultas_um_retorno" ON "consultas" USING btree ("retorno_de") WHERE "consultas"."retorno_de" is not null and "consultas"."status" <> 'cancelada';--> statement-breakpoint
ALTER TABLE "clinicas" ADD CONSTRAINT "clinicas_retorno_prazo_faixa" CHECK ("clinicas"."retorno_prazo_maximo_dias" between 0 and 90);--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_retorno_sem_custo" CHECK ("consultas"."retorno_de" is null or ("consultas"."valor_combinado_centavos" is null and "consultas"."retorno_ate" is null));--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_ausencia" CHECK ("consultas"."ausencia" is null or ("consultas"."ausencia" in ('paciente', 'medico') and "consultas"."status" = 'cancelada'));--> statement-breakpoint
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0027)
--  So acrescenta: a versao anterior da API continua funcionando com este banco.
-- =============================================================================
ALTER TABLE "avaliacoes_consulta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restricoes_pacientes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "avaliacoes_consulta: paciente ve as suas" ON "avaliacoes_consulta"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
-- O medico NAO ve a nota individual (evita retaliacao ao paciente): so o agregado, pela API.
CREATE POLICY "avaliacoes_consulta: administracao ve as da clinica" ON "avaliacoes_consulta"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
CREATE POLICY "restricoes_pacientes: paciente ve as suas" ON "restricoes_pacientes"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "restricoes_pacientes: administracao ve as da clinica" ON "restricoes_pacientes"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint

-- Avaliacao dada nao se altera nem se apaga (vale o que o paciente disse).
-- Unica excecao: APAGAR O COMENTARIO (texto livre, pode ter dado pessoal) a
-- pedido do paciente (LGPD, art. 18). Nota e datas ficam.
CREATE OR REPLACE FUNCTION "public"."avaliacao_imutavel"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.comentario IS NULL AND OLD.comentario IS NOT NULL
     AND NEW.nota = OLD.nota AND NEW.consulta_id = OLD.consulta_id AND NEW.paciente_id = OLD.paciente_id
     AND NEW.medico_id = OLD.medico_id AND NEW.clinica_id = OLD.clinica_id AND NEW.criado_em = OLD.criado_em THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Avaliacao registrada nao se altera nem se apaga (so o comentario pode ser apagado).' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "avaliacoes_consulta_imutavel" BEFORE UPDATE OR DELETE ON "avaliacoes_consulta"
  FOR EACH ROW EXECUTE FUNCTION "public"."avaliacao_imutavel"();
--> statement-breakpoint

-- Restricao nao se apaga: so se encerra, uma vez.
CREATE OR REPLACE FUNCTION "public"."restricao_so_encerra"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Restricao de paciente nao se apaga: encerre.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.encerrado_em IS NOT NULL OR NEW.motivo <> OLD.motivo OR NEW.paciente_id <> OLD.paciente_id
     OR NEW.clinica_id <> OLD.clinica_id OR NEW.criado_por <> OLD.criado_por OR NEW.criado_em <> OLD.criado_em THEN
    RAISE EXCEPTION 'Restricao de paciente so pode ser encerrada, uma vez.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "restricoes_pacientes_so_encerra" BEFORE UPDATE OR DELETE ON "restricoes_pacientes"
  FOR EACH ROW EXECUTE FUNCTION "public"."restricao_so_encerra"();
--> statement-breakpoint

-- O indicador de faltas filtra por clinica, data e ausencia.
CREATE INDEX "consultas_ausencia" ON "consultas" USING btree ("clinica_id","inicio") WHERE "ausencia" is not null;--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "avaliacoes_consulta" FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "restricoes_pacientes" FROM anon, authenticated;
