-- =============================================================================
--  0001_auth_e_gatilhos.sql  (migracao ESCRITA A MAO: pnpm db:gerar --custom)
--
--  Duas coisas que o Drizzle nao gera sozinho:
--    1. a chave estrangeira perfis.id -> auth.users.id (o schema auth e do
--       Supabase; o Drizzle so gerencia o schema public)
--    2. o gatilho que atualiza atualizado_em sozinho a cada UPDATE
-- =============================================================================

-- 1) Todo perfil pertence a um login. Se o login for apagado, o perfil vai
--    junto (e, por cascata da migracao 0000, medico/paciente tambem).
ALTER TABLE "perfis"
  ADD CONSTRAINT "perfis_id_auth_users_id_fk"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade;
--> statement-breakpoint

-- 2) Funcao do gatilho: grava a hora atual em atualizado_em antes de salvar.
CREATE OR REPLACE FUNCTION "public"."definir_atualizado_em"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "perfis_atualizado_em"
  BEFORE UPDATE ON "perfis"
  FOR EACH ROW EXECUTE FUNCTION "public"."definir_atualizado_em"();
--> statement-breakpoint

CREATE TRIGGER "consultas_atualizado_em"
  BEFORE UPDATE ON "consultas"
  FOR EACH ROW EXECUTE FUNCTION "public"."definir_atualizado_em"();
--> statement-breakpoint

-- 3) Documentacao dentro do proprio banco (aparece no painel do Supabase e
--    em qualquer ferramenta SQL). Prestacao de contas comeca aqui.
COMMENT ON TABLE "perfis"    IS 'Pessoas do sistema. id = auth.users.id. Papel decide o acesso (RLS).';
--> statement-breakpoint
COMMENT ON TABLE "medicos"   IS 'Dados profissionais (CRM/UF obrigatorios - CFM 2.314/2022).';
--> statement-breakpoint
COMMENT ON TABLE "pacientes" IS 'Dados minimos de identificacao do paciente (LGPD art. 6, III).';
--> statement-breakpoint
COMMENT ON TABLE "consultas" IS 'Atendimentos agendados. Prontuario e prescricao apontam para ca.';
--> statement-breakpoint
COMMENT ON TABLE "auditoria" IS 'Trilha de auditoria. Somente INSERT (LGPD art. 37).';
