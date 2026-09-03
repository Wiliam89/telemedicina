CREATE TABLE "disponibilidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medico_id" uuid NOT NULL,
	"clinica_id" uuid NOT NULL,
	"dia_semana" integer NOT NULL,
	"hora_inicio" time NOT NULL,
	"hora_fim" time NOT NULL,
	"duracao_minutos" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "disponibilidades_dia_valido" CHECK ("disponibilidades"."dia_semana" between 0 and 6),
	CONSTRAINT "disponibilidades_fim_depois_do_inicio" CHECK ("disponibilidades"."hora_fim" > "disponibilidades"."hora_inicio"),
	CONSTRAINT "disponibilidades_duracao_razoavel" CHECK ("disponibilidades"."duracao_minutos" between 10 and 120)
);
--> statement-breakpoint
CREATE TABLE "bloqueios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medico_id" uuid NOT NULL,
	"clinica_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bloqueios_fim_depois_do_inicio" CHECK ("bloqueios"."fim" > "bloqueios"."inicio")
);
--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "marcado_por" uuid;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "cancelado_por" uuid;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "cancelado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "motivo_cancelamento" text;--> statement-breakpoint
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disponibilidades_bloco_unico" ON "disponibilidades" USING btree ("medico_id","clinica_id","dia_semana","hora_inicio");--> statement-breakpoint
CREATE INDEX "disponibilidades_clinica_dia" ON "disponibilidades" USING btree ("clinica_id","dia_semana");--> statement-breakpoint
CREATE INDEX "bloqueios_medico_periodo" ON "bloqueios" USING btree ("medico_id","inicio");--> statement-breakpoint
CREATE INDEX "bloqueios_clinica_periodo" ON "bloqueios" USING btree ("clinica_id","inicio");--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_marcado_por_perfis_id_fk" FOREIGN KEY ("marcado_por") REFERENCES "public"."perfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_cancelado_por_perfis_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "public"."perfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_cancelamento_completo" CHECK (("consultas"."status" <> 'cancelada' and "consultas"."cancelado_em" is null and "consultas"."cancelado_por" is null)
          or ("consultas"."status" = 'cancelada' and "consultas"."cancelado_em" is not null));