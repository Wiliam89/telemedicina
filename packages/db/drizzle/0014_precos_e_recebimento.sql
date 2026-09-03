CREATE TYPE "public"."tipo_atendimento" AS ENUM('agendada', 'pronto_atendimento');--> statement-breakpoint
CREATE TABLE "precos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"tipo" "tipo_atendimento" NOT NULL,
	"medico_id" uuid,
	"valor_centavos" integer NOT NULL,
	"comissao_plataforma_bps" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precos_valor_razoavel" CHECK ("precos"."valor_centavos" between 100 and 1000000),
	CONSTRAINT "precos_comissao_razoavel" CHECK ("precos"."comissao_plataforma_bps" between 0 and 3000)
);
--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "pagamento_provedor" text;--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "pagamento_conta_id" text;--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "pagamento_token_cifrado" text;--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "pagamento_refresh_cifrado" text;--> statement-breakpoint
ALTER TABLE "clinicas" ADD COLUMN "pagamento_token_expira_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "pix_copia_e_cola" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "pix_qr_base64" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "chave_idempotencia" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "precos_clinica_tipo_medico" ON "precos" USING btree ("clinica_id","tipo","medico_id");--> statement-breakpoint
CREATE INDEX "precos_clinica" ON "precos" USING btree ("clinica_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_chave_idempotencia" ON "pagamentos" USING btree ("chave_idempotencia");