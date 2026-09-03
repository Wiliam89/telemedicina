-- =============================================================================
--  0003_clinicas_e_vinculos.sql
--
--  Gerada por `pnpm db:gerar` e EDITADA A MAO antes de ser aplicada, para
--  levar os dados existentes junto (ver blocos "-- [dados]"). Editar uma
--  migracao gerada ANTES da primeira aplicacao e pratica normal; o que nunca
--  se edita e migracao ja aplicada em producao (ADR-0004).
--
--  O que ela faz:
--    1. cria clinicas, vinculos e convites
--    2. move o CPF de `pacientes` para `perfis` (o CPF e da pessoa)
--    3. da a `consultas` e `auditoria` a coluna clinica_id
--    4. [dados] cria a "Clinica Demonstracao" e liga a ela tudo que ja existe
-- =============================================================================

CREATE TYPE "public"."status_clinica" AS ENUM('em_implantacao', 'ativa', 'suspensa', 'encerrada');--> statement-breakpoint
CREATE TYPE "public"."papel_vinculo" AS ENUM('paciente', 'medico', 'recepcao', 'admin_clinica');--> statement-breakpoint
CREATE TYPE "public"."status_vinculo" AS ENUM('ativo', 'suspenso', 'encerrado');--> statement-breakpoint
CREATE TYPE "public"."status_convite" AS ENUM('pendente', 'aceito', 'revogado', 'expirado');--> statement-breakpoint
CREATE TABLE "clinicas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(40) NOT NULL,
	"nome_fantasia" text NOT NULL,
	"razao_social" text NOT NULL,
	"cnpj" varchar(14) NOT NULL,
	"status" "status_clinica" DEFAULT 'em_implantacao' NOT NULL,
	"responsavel_tecnico_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinicas_slug_unique" UNIQUE("slug"),
	CONSTRAINT "clinicas_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "vinculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"clinica_id" uuid NOT NULL,
	"papel" "papel_vinculo" NOT NULL,
	"status" "status_vinculo" DEFAULT 'ativo' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinica_id" uuid NOT NULL,
	"email" text NOT NULL,
	"papel" "papel_vinculo" NOT NULL,
	"codigo_hash" text NOT NULL,
	"status" "status_convite" DEFAULT 'pendente' NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"convidado_por" uuid NOT NULL,
	"aceito_por" uuid,
	"aceito_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "pacientes_cpf_unico";--> statement-breakpoint
ALTER TABLE "perfis" ADD COLUMN "cpf" varchar(11);--> statement-breakpoint
-- [dados] o CPF ja cadastrado acompanha a pessoa para a nova coluna.
UPDATE "perfis" p SET "cpf" = pa."cpf" FROM "pacientes" pa WHERE pa."perfil_id" = p."id" AND pa."cpf" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "perfis" ADD COLUMN "suporte_plataforma" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- [dados] Se ja existe alguem no sistema, tudo o que existe passa a pertencer
-- a uma clinica de demonstracao. Num banco vazio (instalacao nova) nada e
-- criado, e a primeira clinica nasce pela tela "Criar clinica".
INSERT INTO "clinicas" ("slug", "nome_fantasia", "razao_social", "cnpj", "status")
SELECT 'demonstracao', 'Clinica Demonstracao', 'Clinica Demonstracao LTDA', '00000000000000', 'em_implantacao'
WHERE EXISTS (SELECT 1 FROM "perfis");--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN "clinica_id" uuid;--> statement-breakpoint
UPDATE "consultas" SET "clinica_id" = (SELECT "id" FROM "clinicas" WHERE "slug" = 'demonstracao') WHERE "clinica_id" IS NULL;--> statement-breakpoint
ALTER TABLE "consultas" ALTER COLUMN "clinica_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auditoria" ADD COLUMN "clinica_id" uuid;--> statement-breakpoint
ALTER TABLE "clinicas" ADD CONSTRAINT "clinicas_responsavel_tecnico_id_perfis_id_fk" FOREIGN KEY ("responsavel_tecnico_id") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculos" ADD CONSTRAINT "vinculos_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculos" ADD CONSTRAINT "vinculos_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_convidado_por_perfis_id_fk" FOREIGN KEY ("convidado_por") REFERENCES "public"."perfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_aceito_por_perfis_id_fk" FOREIGN KEY ("aceito_por") REFERENCES "public"."perfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vinculos_perfil_clinica_papel" ON "vinculos" USING btree ("perfil_id","clinica_id","papel");--> statement-breakpoint
CREATE INDEX "vinculos_perfil_clinica" ON "vinculos" USING btree ("perfil_id","clinica_id");--> statement-breakpoint
CREATE INDEX "vinculos_clinica_papel" ON "vinculos" USING btree ("clinica_id","papel");--> statement-breakpoint
CREATE UNIQUE INDEX "convites_codigo_hash" ON "convites" USING btree ("codigo_hash");--> statement-breakpoint
CREATE INDEX "convites_clinica_status" ON "convites" USING btree ("clinica_id","status");--> statement-breakpoint
CREATE INDEX "convites_email" ON "convites" USING btree ("email");--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_clinica_id_clinicas_id_fk" FOREIGN KEY ("clinica_id") REFERENCES "public"."clinicas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perfis_cpf_unico" ON "perfis" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "consultas_clinica_inicio" ON "consultas" USING btree ("clinica_id","inicio");--> statement-breakpoint
CREATE INDEX "auditoria_clinica_quando" ON "auditoria" USING btree ("clinica_id","quando");--> statement-breakpoint
ALTER TABLE "pacientes" DROP COLUMN "cpf";--> statement-breakpoint

-- [dados] Cada perfil existente vira um vinculo na clinica de demonstracao,
-- com o papel que ele tinha. O papel "admin" antigo vira "admin_clinica".
INSERT INTO "vinculos" ("perfil_id", "clinica_id", "papel", "status")
SELECT p."id",
       (SELECT "id" FROM "clinicas" WHERE "slug" = 'demonstracao'),
       (CASE p."papel"::text WHEN 'admin' THEN 'admin_clinica' ELSE p."papel"::text END)::"papel_vinculo",
       'ativo'
FROM "perfis" p
WHERE EXISTS (SELECT 1 FROM "clinicas" WHERE "slug" = 'demonstracao');--> statement-breakpoint

-- [dados] A clinica precisa de alguem que a administre, senao nasce orfa:
-- sem admin nao ha quem convide a equipe nem ajuste os dados. O primeiro
-- medico assume; se nao houver medico, o primeiro perfil criado.
INSERT INTO "vinculos" ("perfil_id", "clinica_id", "papel", "status")
SELECT COALESCE(
         (SELECT v."perfil_id" FROM "vinculos" v JOIN "clinicas" c ON c."id" = v."clinica_id"
          WHERE c."slug" = 'demonstracao' AND v."papel" = 'medico' ORDER BY v."criado_em" LIMIT 1),
         (SELECT p."id" FROM "perfis" p ORDER BY p."criado_em" LIMIT 1)
       ),
       (SELECT "id" FROM "clinicas" WHERE "slug" = 'demonstracao'),
       'admin_clinica', 'ativo'
WHERE EXISTS (SELECT 1 FROM "clinicas" WHERE "slug" = 'demonstracao')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- [dados] A auditoria ja registrada pertence a mesma clinica.
UPDATE "auditoria" SET "clinica_id" = (SELECT "id" FROM "clinicas" WHERE "slug" = 'demonstracao')
WHERE "clinica_id" IS NULL AND EXISTS (SELECT 1 FROM "clinicas" WHERE "slug" = 'demonstracao');--> statement-breakpoint

-- [dados] O primeiro medico vinculado vira o responsavel tecnico provisorio
-- (CFM 2.314/2022 exige RT; a tela de configuracao permite trocar depois).
UPDATE "clinicas" c SET "responsavel_tecnico_id" = (
  SELECT v."perfil_id" FROM "vinculos" v WHERE v."clinica_id" = c."id" AND v."papel" = 'medico' ORDER BY v."criado_em" LIMIT 1
) WHERE c."slug" = 'demonstracao';