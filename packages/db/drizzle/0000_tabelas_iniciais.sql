CREATE TYPE "public"."papel" AS ENUM('paciente', 'medico', 'admin');--> statement-breakpoint
CREATE TYPE "public"."status_consulta" AS ENUM('agendada', 'em_andamento', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TABLE "perfis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"papel" "papel" NOT NULL,
	"nome_completo" text NOT NULL,
	"telefone" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicos" (
	"perfil_id" uuid PRIMARY KEY NOT NULL,
	"crm" text NOT NULL,
	"crm_uf" char(2) NOT NULL,
	"especialidade" text
);
--> statement-breakpoint
CREATE TABLE "pacientes" (
	"perfil_id" uuid PRIMARY KEY NOT NULL,
	"data_nascimento" date NOT NULL,
	"cpf" varchar(11)
);
--> statement-breakpoint
CREATE TABLE "consultas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"status" "status_consulta" DEFAULT 'agendada' NOT NULL,
	"motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultas_fim_depois_do_inicio" CHECK ("consultas"."fim" > "consultas"."inicio")
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quando" timestamp with time zone DEFAULT now() NOT NULL,
	"quem" uuid,
	"acao" text NOT NULL,
	"tabela" text NOT NULL,
	"registro_id" text NOT NULL,
	"detalhes" jsonb,
	"ip" "inet"
);
--> statement-breakpoint
ALTER TABLE "medicos" ADD CONSTRAINT "medicos_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_quem_perfis_id_fk" FOREIGN KEY ("quem") REFERENCES "public"."perfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "medicos_crm_uf_unico" ON "medicos" USING btree ("crm","crm_uf");--> statement-breakpoint
CREATE UNIQUE INDEX "pacientes_cpf_unico" ON "pacientes" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "consultas_medico_inicio" ON "consultas" USING btree ("medico_id","inicio");--> statement-breakpoint
CREATE INDEX "consultas_paciente_inicio" ON "consultas" USING btree ("paciente_id","inicio");--> statement-breakpoint
CREATE INDEX "auditoria_quem_quando" ON "auditoria" USING btree ("quem","quando");--> statement-breakpoint
CREATE INDEX "auditoria_tabela_registro" ON "auditoria" USING btree ("tabela","registro_id");