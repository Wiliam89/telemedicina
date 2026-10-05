CREATE TYPE "public"."provedor_video" AS ENUM('local_teste', 'daily');--> statement-breakpoint
CREATE TABLE "salas_de_video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"consulta_id" uuid NOT NULL,
	"provedor" "provedor_video" NOT NULL,
	"nome_no_provedor" text NOT NULL,
	"url" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"encerrada_em" timestamp with time zone,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salas_de_video_expira_depois_de_criada" CHECK ("salas_de_video"."expira_em" > "salas_de_video"."criada_em")
);
--> statement-breakpoint
ALTER TABLE "salas_de_video" ADD CONSTRAINT "salas_de_video_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salas_de_video" ADD CONSTRAINT "salas_de_video_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salas_de_video_consulta" ON "salas_de_video" USING btree ("consulta_id");--> statement-breakpoint
CREATE INDEX "salas_de_video_clinica_expira" ON "salas_de_video" USING btree ("clinica_id","expira_em");--> statement-breakpoint

-- =====================================================================
-- RLS DA SALA DE VIDEO - A REGRA MAIS ESTREITA DO BANCO
-- =====================================================================
--
-- Em toda tabela ate aqui, "a equipe da clinica ve" foi uma regra
-- razoavel: a recepcao precisa ver a agenda, a administracao precisa ver
-- os pagamentos. Aqui nao.
--
-- Uma consulta e entre DUAS pessoas. Quem nao e uma delas nao entra - nem
-- a recepcao, nem a administracao da clinica, nem o dono da plataforma.
-- Por isso esta politica nao usa `tem_papel`: ela compara com o paciente
-- e com o medico DAQUELA consulta, e e isso.
--
-- A administracao continua sabendo que o atendimento aconteceu (consultas,
-- pagamentos, auditoria). O que ela nao tem e caminho para dentro da sala.
ALTER TABLE "salas_de_video" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "salas_de_video: so os dois da consulta" ON "salas_de_video"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "consultas" c
      WHERE c."id" = "salas_de_video"."consulta_id"
        AND (SELECT auth.uid()) IN (c."paciente_id", c."medico_id")
    )
  );
--> statement-breakpoint

-- Criar e encerrar sala e pela API: e ela que confere o estado da consulta,
-- a janela de horario, pede o token ao provedor e audita. Ninguem escreve
-- aqui direto, nem o medico.
REVOKE INSERT, UPDATE, DELETE ON "salas_de_video" FROM anon, authenticated;
