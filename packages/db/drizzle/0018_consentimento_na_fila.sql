ALTER TABLE "fila_atendimento" ADD COLUMN "consentimento_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD COLUMN "consentimento_versao" text;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD COLUMN "observacao" text;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_exige_consentimento" CHECK ("fila_atendimento"."status" <> 'aguardando' or ("fila_atendimento"."consentimento_em" is not null and "fila_atendimento"."consentimento_versao" is not null));