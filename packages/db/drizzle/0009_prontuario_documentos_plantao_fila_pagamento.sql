-- =============================================================================
--  0009 - Prontuario, documentos, plantao, fila e pagamento
--
--  Cinco tabelas de uma vez, de proposito. As duas primeiras (evolucoes e
--  documentos) sao o assunto do Modulo 8. As tres seguintes (plantoes,
--  fila_atendimento e pagamentos) so ganham telas nos Modulos 10 e 11 - mas
--  nascem agora porque `fila` aponta para `pagamentos`, e criar essas
--  ligacoes depois significaria migrar um banco que ja tem prontuario real
--  dentro. Migracao estrutural com dado clinico e o que se evita.
-- =============================================================================

CREATE TYPE "public"."status_plantao" AS ENUM('escalado', 'aberto', 'encerrado');--> statement-breakpoint
CREATE TYPE "public"."metodo_pagamento" AS ENUM('pix', 'cartao_credito', 'cortesia');--> statement-breakpoint
CREATE TYPE "public"."status_pagamento" AS ENUM('pendente', 'autorizado', 'confirmado', 'recusado', 'estornado', 'expirado');--> statement-breakpoint
CREATE TYPE "public"."status_fila" AS ENUM('aguardando', 'chamado', 'em_atendimento', 'atendido', 'desistiu', 'expirado');--> statement-breakpoint
CREATE TYPE "public"."status_evolucao" AS ENUM('rascunho', 'finalizada');--> statement-breakpoint
CREATE TYPE "public"."status_documento" AS ENUM('emitido', 'assinado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento" AS ENUM('receita_simples', 'receita_controle_especial', 'atestado', 'pedido_exame', 'relatorio', 'declaracao_comparecimento');--> statement-breakpoint
CREATE TABLE "plantoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"status" "status_plantao" DEFAULT 'escalado' NOT NULL,
	"aberto_em" timestamp with time zone,
	"encerrado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plantoes_fim_depois_do_inicio" CHECK ("plantoes"."fim" > "plantoes"."inicio")
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"pagador_id" uuid NOT NULL,
	"consulta_id" uuid,
	"metodo" "metodo_pagamento" NOT NULL,
	"status" "status_pagamento" DEFAULT 'pendente' NOT NULL,
	"valor_centavos" integer NOT NULL,
	"valor_clinica_centavos" integer NOT NULL,
	"valor_plataforma_centavos" integer NOT NULL,
	"provedor" text NOT NULL,
	"provedor_id" text,
	"provedor_payload" jsonb,
	"autorizado_em" timestamp with time zone,
	"confirmado_em" timestamp with time zone,
	"estornado_em" timestamp with time zone,
	"motivo_estorno" text,
	"expira_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagamentos_valores_positivos" CHECK ("pagamentos"."valor_centavos" > 0 and "pagamentos"."valor_clinica_centavos" >= 0 and "pagamentos"."valor_plataforma_centavos" >= 0),
	CONSTRAINT "pagamentos_split_fecha" CHECK ("pagamentos"."valor_clinica_centavos" + "pagamentos"."valor_plataforma_centavos" <= "pagamentos"."valor_centavos"),
	CONSTRAINT "pagamentos_confirmacao_coerente" CHECK ("pagamentos"."status" <> 'confirmado' or "pagamentos"."confirmado_em" is not null),
	CONSTRAINT "pagamentos_estorno_coerente" CHECK ("pagamentos"."status" <> 'estornado' or ("pagamentos"."estornado_em" is not null and "pagamentos"."motivo_estorno" is not null))
);
--> statement-breakpoint
CREATE TABLE "fila_atendimento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"pagamento_id" uuid NOT NULL,
	"status" "status_fila" DEFAULT 'aguardando' NOT NULL,
	"queixa" text,
	"prioridade" text DEFAULT '3' NOT NULL,
	"entrou_em" timestamp with time zone DEFAULT now() NOT NULL,
	"chamado_em" timestamp with time zone,
	"plantao_id" uuid,
	"consulta_id" uuid,
	"encerrado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evolucoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"consulta_id" uuid NOT NULL,
	"paciente_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"status" "status_evolucao" DEFAULT 'rascunho' NOT NULL,
	"subjetivo" text,
	"objetivo" text,
	"avaliacao" text,
	"plano" text,
	"cid10" text,
	"adendo_de" uuid,
	"finalizada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evolucoes_finalizacao_coerente" CHECK (("evolucoes"."status" = 'rascunho' and "evolucoes"."finalizada_em" is null) or ("evolucoes"."status" = 'finalizada' and "evolucoes"."finalizada_em" is not null)),
	CONSTRAINT "evolucoes_conteudo_minimo" CHECK ("evolucoes"."status" = 'rascunho' or coalesce("evolucoes"."subjetivo", '') || coalesce("evolucoes"."objetivo", '') || coalesce("evolucoes"."avaliacao", '') || coalesce("evolucoes"."plano", '') <> '')
);
--> statement-breakpoint
CREATE TABLE "documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"consulta_id" uuid,
	"paciente_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"tipo" "tipo_documento" NOT NULL,
	"status" "status_documento" DEFAULT 'emitido' NOT NULL,
	"ano" integer NOT NULL,
	"numero" integer NOT NULL,
	"conteudo" jsonb NOT NULL,
	"texto_impresso" text NOT NULL,
	"hash" varchar(64) NOT NULL,
	"codigo_validacao" varchar(24) NOT NULL,
	"assinado_em" timestamp with time zone,
	"assinatura_provedor" text,
	"assinatura_id" text,
	"arquivo_url" text,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documentos_hash_formato" CHECK ("documentos"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documentos_cancelamento_completo" CHECK (("documentos"."status" <> 'cancelado' and "documentos"."cancelado_em" is null) or ("documentos"."status" = 'cancelado' and "documentos"."cancelado_em" is not null and "documentos"."motivo_cancelamento" is not null)),
	CONSTRAINT "documentos_assinatura_coerente" CHECK (("documentos"."status" <> 'assinado' and "documentos"."assinado_em" is null) or ("documentos"."status" = 'assinado' and "documentos"."assinado_em" is not null and "documentos"."assinatura_provedor" is not null))
);
--> statement-breakpoint
ALTER TABLE "plantoes" ADD CONSTRAINT "plantoes_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantoes" ADD CONSTRAINT "plantoes_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_pagador_id_perfis_id_fk" FOREIGN KEY ("pagador_id") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_atendimento_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_atendimento_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_atendimento_pagamento_id_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamentos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_atendimento_plantao_id_plantoes_id_fk" FOREIGN KEY ("plantao_id") REFERENCES "public"."plantoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ADD CONSTRAINT "fila_atendimento_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes" ADD CONSTRAINT "evolucoes_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes" ADD CONSTRAINT "evolucoes_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes" ADD CONSTRAINT "evolucoes_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes" ADD CONSTRAINT "evolucoes_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_paciente_id_pacientes_perfil_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_medico_id_medicos_perfil_id_fk" FOREIGN KEY ("medico_id") REFERENCES "public"."medicos"("perfil_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_cancelado_por_perfis_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "public"."perfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plantoes_clinica_inicio" ON "plantoes" USING btree ("clinica_id","inicio");--> statement-breakpoint
CREATE INDEX "plantoes_medico_inicio" ON "plantoes" USING btree ("medico_id","inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_provedor_id_unico" ON "pagamentos" USING btree ("provedor","provedor_id");--> statement-breakpoint
CREATE INDEX "pagamentos_clinica_criado" ON "pagamentos" USING btree ("clinica_id","criado_em");--> statement-breakpoint
CREATE INDEX "pagamentos_pagador" ON "pagamentos" USING btree ("pagador_id");--> statement-breakpoint
CREATE INDEX "fila_clinica_status_entrada" ON "fila_atendimento" USING btree ("clinica_id","status","entrou_em");--> statement-breakpoint
CREATE INDEX "fila_paciente" ON "fila_atendimento" USING btree ("paciente_id");--> statement-breakpoint
CREATE INDEX "evolucoes_paciente_criado" ON "evolucoes" USING btree ("paciente_id","criado_em");--> statement-breakpoint
CREATE INDEX "evolucoes_consulta" ON "evolucoes" USING btree ("consulta_id");--> statement-breakpoint
CREATE INDEX "evolucoes_clinica_criado" ON "evolucoes" USING btree ("clinica_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_numero_por_clinica_ano" ON "documentos" USING btree ("clinica_id","ano","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_codigo_validacao" ON "documentos" USING btree ("codigo_validacao");--> statement-breakpoint
CREATE INDEX "documentos_paciente_criado" ON "documentos" USING btree ("paciente_id","criado_em");--> statement-breakpoint
CREATE INDEX "documentos_clinica_criado" ON "documentos" USING btree ("clinica_id","criado_em");