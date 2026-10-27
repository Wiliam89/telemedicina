CREATE TYPE "public"."tipo_notificacao" AS ENUM('consulta_marcada', 'consulta_cancelada', 'lembrete_24h', 'lembrete_1h', 'documento_disponivel', 'pedido_lgpd_respondido', 'crm_verificado');--> statement-breakpoint
CREATE TABLE "notificacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"clinica_id" uuid,
	"tipo" "tipo_notificacao" NOT NULL,
	"titulo" text NOT NULL,
	"corpo" text NOT NULL,
	"link" text,
	"chave" text NOT NULL,
	"lida_em" timestamp with time zone,
	"email_enviado_em" timestamp with time zone,
	"email_erro" text,
	"email_tentativas" smallint DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notificacoes_chave" ON "notificacoes" USING btree ("perfil_id","chave");--> statement-breakpoint
CREATE INDEX "notificacoes_perfil_criado" ON "notificacoes" USING btree ("perfil_id","criado_em");--> statement-breakpoint
CREATE INDEX "notificacoes_email_pendente" ON "notificacoes" USING btree ("email_enviado_em","email_tentativas");
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0019)
--  A pessoa le as proprias notificacoes. Criar e marcar como lida e pela API.
-- =============================================================================
ALTER TABLE "notificacoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notificacoes: cada um ve as suas" ON "notificacoes"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "notificacoes" FROM anon, authenticated;
