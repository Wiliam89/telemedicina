-- =============================================================================
--  0002_rls_e_politicas.sql  (migracao ESCRITA A MAO: pnpm db:gerar --custom)
--
--  Liga a seguranca por linha (RLS) nas cinco tabelas e escreve as politicas:
--  quem pode ver e mexer em cada linha. A partir daqui, um usuario logado com
--  a chave PUBLICA enxerga apenas o que estas politicas permitem. A API, com
--  a chave SECRETA, continua vendo tudo - por isso ela e quem escreve.
--
--  Vocabulario:
--    auth.uid()        -> o id do usuario logado (vem do token do Supabase)
--    papel_atual()     -> o papel desse usuario, lido de perfis
--    USING             -> quais linhas a operacao pode alcancar
--    WITH CHECK        -> quais linhas podem ser gravadas (insert/update)
-- =============================================================================

-- 0) Funcao auxiliar. SECURITY DEFINER = roda com o dono da funcao, ignorando
--    o RLS de perfis. Sem isso, uma politica de perfis que consulta perfis
--    entra em recursao infinita. STABLE + search_path vazio: seguro e rapido.
CREATE OR REPLACE FUNCTION "public"."papel_atual"()
RETURNS "public"."papel"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT papel FROM public.perfis WHERE id = auth.uid();
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."papel_atual"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."papel_atual"() TO authenticated;
--> statement-breakpoint

-- 1) Liga o RLS. A partir daqui, sem politica = ninguem ve nada.
ALTER TABLE "perfis"    ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medicos"   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pacientes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consultas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auditoria" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2) perfis: cada um ve e edita o proprio; admin ve todos; ninguem muda o
--    proprio papel (WITH CHECK exige papel igual ao atual).
CREATE POLICY "perfis: ver o proprio" ON "perfis"
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "perfis: admin ve todos" ON "perfis"
  FOR SELECT TO authenticated
  USING ((SELECT public.papel_atual()) = 'admin');
--> statement-breakpoint
CREATE POLICY "perfis: editar o proprio sem mudar papel" ON "perfis"
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()) AND papel = (SELECT public.papel_atual()));
--> statement-breakpoint

-- 3) medicos: qualquer pessoa logada ve a lista (para escolher com quem
--    marcar); so o proprio medico edita seus dados.
CREATE POLICY "medicos: qualquer logado ve" ON "medicos"
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "medicos: editar o proprio" ON "medicos"
  FOR UPDATE TO authenticated
  USING (perfil_id = (SELECT auth.uid()))
  WITH CHECK (perfil_id = (SELECT auth.uid()));
--> statement-breakpoint

-- 4) pacientes: o proprio; o medico que tem consulta com ele; admin.
CREATE POLICY "pacientes: ver o proprio" ON "pacientes"
  FOR SELECT TO authenticated
  USING (perfil_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "pacientes: medico ve quem atende" ON "pacientes"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "consultas" c
    WHERE c.paciente_id = "pacientes".perfil_id AND c.medico_id = (SELECT auth.uid())
  ));
--> statement-breakpoint
CREATE POLICY "pacientes: admin ve todos" ON "pacientes"
  FOR SELECT TO authenticated
  USING ((SELECT public.papel_atual()) = 'admin');
--> statement-breakpoint
CREATE POLICY "pacientes: editar o proprio" ON "pacientes"
  FOR UPDATE TO authenticated
  USING (perfil_id = (SELECT auth.uid()))
  WITH CHECK (perfil_id = (SELECT auth.uid()));
--> statement-breakpoint

-- 5) consultas: paciente e medico da consulta (e admin) veem; paciente marca
--    a propria; os dois lados podem atualizar (status, horario). Ninguem apaga.
CREATE POLICY "consultas: ver as minhas" ON "consultas"
  FOR SELECT TO authenticated
  USING (
    paciente_id = (SELECT auth.uid())
    OR medico_id = (SELECT auth.uid())
    OR (SELECT public.papel_atual()) = 'admin'
  );
--> statement-breakpoint
CREATE POLICY "consultas: paciente marca a propria" ON "consultas"
  FOR INSERT TO authenticated
  WITH CHECK (paciente_id = (SELECT auth.uid()) AND (SELECT public.papel_atual()) = 'paciente');
--> statement-breakpoint
CREATE POLICY "consultas: os dois lados atualizam" ON "consultas"
  FOR UPDATE TO authenticated
  USING (paciente_id = (SELECT auth.uid()) OR medico_id = (SELECT auth.uid()))
  WITH CHECK (paciente_id = (SELECT auth.uid()) OR medico_id = (SELECT auth.uid()));
--> statement-breakpoint

-- 6) auditoria: so admin le; qualquer logado insere (sempre em proprio nome);
--    NINGUEM altera ou apaga - nao ha politica, e ainda revogamos o privilegio.
CREATE POLICY "auditoria: admin le" ON "auditoria"
  FOR SELECT TO authenticated
  USING ((SELECT public.papel_atual()) = 'admin');
--> statement-breakpoint
CREATE POLICY "auditoria: inserir em proprio nome" ON "auditoria"
  FOR INSERT TO authenticated
  WITH CHECK (quem = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "auditoria" FROM anon, authenticated;
