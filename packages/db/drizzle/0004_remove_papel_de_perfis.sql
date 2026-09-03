-- =============================================================================
--  0004_remove_papel_de_perfis.sql
--
--  Gerada por `pnpm db:gerar` e editada a mao para desfazer, com seguranca,
--  a dependencia que o Modulo 4 tinha da coluna `perfis.papel`:
--  as politicas antigas e a funcao papel_atual() liam essa coluna.
--
--  A ordem importa: primeiro somem as politicas e a funcao que dependem da
--  coluna, so entao a coluna e o tipo. A nova seguranca (multi-clinica)
--  entra na 0005 - entre esta migracao e aquela, o RLS fica ligado e SEM
--  politica em todas as tabelas, ou seja: ninguem le nada pela chave publica.
--  E o estado seguro para se estar no meio do caminho.
-- =============================================================================

DROP POLICY IF EXISTS "perfis: ver o proprio" ON "perfis";--> statement-breakpoint
DROP POLICY IF EXISTS "perfis: admin ve todos" ON "perfis";--> statement-breakpoint
DROP POLICY IF EXISTS "perfis: editar o proprio sem mudar papel" ON "perfis";--> statement-breakpoint
DROP POLICY IF EXISTS "medicos: qualquer logado ve" ON "medicos";--> statement-breakpoint
DROP POLICY IF EXISTS "medicos: editar o proprio" ON "medicos";--> statement-breakpoint
DROP POLICY IF EXISTS "pacientes: ver o proprio" ON "pacientes";--> statement-breakpoint
DROP POLICY IF EXISTS "pacientes: medico ve quem atende" ON "pacientes";--> statement-breakpoint
DROP POLICY IF EXISTS "pacientes: admin ve todos" ON "pacientes";--> statement-breakpoint
DROP POLICY IF EXISTS "pacientes: editar o proprio" ON "pacientes";--> statement-breakpoint
DROP POLICY IF EXISTS "consultas: ver as minhas" ON "consultas";--> statement-breakpoint
DROP POLICY IF EXISTS "consultas: paciente marca a propria" ON "consultas";--> statement-breakpoint
DROP POLICY IF EXISTS "consultas: os dois lados atualizam" ON "consultas";--> statement-breakpoint
DROP POLICY IF EXISTS "auditoria: admin le" ON "auditoria";--> statement-breakpoint
DROP POLICY IF EXISTS "auditoria: inserir em proprio nome" ON "auditoria";--> statement-breakpoint

DROP FUNCTION IF EXISTS "public"."papel_atual"();--> statement-breakpoint

ALTER TABLE "perfis" DROP COLUMN "papel";--> statement-breakpoint
DROP TYPE "public"."papel";
