-- =============================================================================
--  0005_rls_multi_clinica.sql  (ESCRITA A MAO)
--
--  A seguranca por linha do Modulo 4 respondia uma pergunta: "esta linha e
--  sua?". Agora ela responde duas: "esta linha e sua E da clinica em que
--  voce esta?".
--
--  Como o banco sabe em qual clinica voce esta? Nao sabe - e nem precisa.
--  Cada politica pergunta "existe vinculo ativo entre voce e a clinica DESTA
--  linha?". Assim nao ha estado de sessao para alguem forjar: o isolamento
--  vale para toda consulta, venha de onde vier.
--
--  Por que ler `vinculos` em vez de por a clinica no token (JWT)?
--    - claims em metadados do usuario podem ser alterados pelo proprio
--      usuario; autorizacao nao se apoia neles;
--    - claim fica velho: suspender um vinculo so teria efeito no proximo
--      login. Lendo a tabela, tem efeito imediato;
--    - claim customizado exige configurar hook no painel do Supabase, e
--      neste projeto nada de estrutura nasce de clique (ADR-0004).
--  O custo (uma consulta indexada por politica) e resolvido por
--  vinculos_perfil_clinica e por envolver as funcoes em (SELECT ...), que faz
--  o Postgres avaliar uma vez por consulta em vez de uma vez por linha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Funcoes de contexto. SECURITY DEFINER: leem `vinculos` e `perfis` sem
--    esbarrar no RLS dessas proprias tabelas (senao, recursao infinita).
--    search_path vazio: ninguem sequestra os nomes das tabelas.
-- -----------------------------------------------------------------------------

/** O papel da pessoa logada NA clinica indicada, ou NULL se nao houver vinculo ativo. */
CREATE OR REPLACE FUNCTION "public"."papel_na_clinica"(p_clinica uuid)
RETURNS "public"."papel_vinculo"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT v.papel FROM public.vinculos v
  WHERE v.perfil_id = auth.uid() AND v.clinica_id = p_clinica AND v.status = 'ativo'
  ORDER BY CASE v.papel WHEN 'admin_clinica' THEN 1 WHEN 'medico' THEN 2 WHEN 'recepcao' THEN 3 ELSE 4 END
  LIMIT 1;
$$;
--> statement-breakpoint

/** Tem algum vinculo ativo nesta clinica? (qualquer papel) */
CREATE OR REPLACE FUNCTION "public"."tem_vinculo"(p_clinica uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos v
    WHERE v.perfil_id = auth.uid() AND v.clinica_id = p_clinica AND v.status = 'ativo'
  );
$$;
--> statement-breakpoint

/** Tem um dos papeis indicados nesta clinica? Ex.: equipe_da_clinica(id, ARRAY['medico','admin_clinica']) */
CREATE OR REPLACE FUNCTION "public"."tem_papel"(p_clinica uuid, p_papeis "public"."papel_vinculo"[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos v
    WHERE v.perfil_id = auth.uid() AND v.clinica_id = p_clinica
      AND v.status = 'ativo' AND v.papel = ANY(p_papeis)
  );
$$;
--> statement-breakpoint

/** As clinicas em que a pessoa logada tem vinculo ativo. */
CREATE OR REPLACE FUNCTION "public"."minhas_clinicas"()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT v.clinica_id FROM public.vinculos v
  WHERE v.perfil_id = auth.uid() AND v.status = 'ativo';
$$;
--> statement-breakpoint

/**
 * Compartilham alguma clinica? Usada para decidir se a equipe pode ver os
 * dados globais (nome, CPF) de uma pessoa: so quem atende com ela, ou quem
 * e atendido por ela, no mesmo lugar.
 */
CREATE OR REPLACE FUNCTION "public"."compartilha_clinica"(p_perfil uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos meu
    JOIN public.vinculos dele ON dele.clinica_id = meu.clinica_id
    WHERE meu.perfil_id = auth.uid() AND meu.status = 'ativo'
      AND dele.perfil_id = p_perfil AND dele.status = 'ativo'
  );
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."papel_na_clinica"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."tem_vinculo"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."tem_papel"(uuid, "public"."papel_vinculo"[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."minhas_clinicas"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."compartilha_clinica"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."papel_na_clinica"(uuid) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."tem_vinculo"(uuid) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."tem_papel"(uuid, "public"."papel_vinculo"[]) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."minhas_clinicas"() TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."compartilha_clinica"(uuid) TO authenticated;--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2) RLS ligado nas tabelas novas (as outras cinco ja estao, desde a 0002).
-- -----------------------------------------------------------------------------
ALTER TABLE "clinicas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vinculos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "convites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3) clinicas: voce ve as suas. Criar e alterar clinica e rota da API.
-- -----------------------------------------------------------------------------
CREATE POLICY "clinicas: ver as minhas" ON "clinicas"
  FOR SELECT TO authenticated
  USING ("id" IN (SELECT "public"."minhas_clinicas"()));
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4) vinculos: voce ve os seus; a equipe ve quem mais trabalha na clinica.
--    Ninguem insere, altera nem apaga pelo banco: papel se muda pela API,
--    com auditoria. Alem da ausencia de politica, revogamos o privilegio -
--    porque politica de UPDATE nao sabe comparar valor novo com o antigo,
--    entao "pode editar a linha" viraria "pode editar o papel".
-- -----------------------------------------------------------------------------
CREATE POLICY "vinculos: ver os meus" ON "vinculos"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "vinculos: equipe ve a equipe" ON "vinculos"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['medico','recepcao','admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "vinculos" FROM anon, authenticated;--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 5) convites: so a administracao da clinica ve. Aceitar e rota da API
--    (o codigo do convite nem chega ao banco - so o hash dele).
-- -----------------------------------------------------------------------------
CREATE POLICY "convites: admin da clinica ve" ON "convites"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "convites" FROM anon, authenticated;--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 6) perfis: o proprio, e quem divide clinica com voce.
--    Editar: so o proprio. Nao ha mais "papel" aqui para proteger, mas
--    `suporte_plataforma` sim: por isso a coluna fica fora do UPDATE.
-- -----------------------------------------------------------------------------
CREATE POLICY "perfis: ver o proprio" ON "perfis"
  FOR SELECT TO authenticated
  USING ("id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "perfis: ver quem divide clinica comigo" ON "perfis"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."compartilha_clinica"("id")));
--> statement-breakpoint
CREATE POLICY "perfis: editar o proprio" ON "perfis"
  FOR UPDATE TO authenticated
  USING ("id" = (SELECT auth.uid()))
  WITH CHECK ("id" = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE UPDATE ON "perfis" FROM anon, authenticated;--> statement-breakpoint
GRANT UPDATE ("nome_completo", "telefone") ON "perfis" TO authenticated;--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 7) medicos: dados profissionais. Visiveis a quem divide clinica (o paciente
--    precisa ver com quem vai marcar). CRM nunca e editado pelo banco: e
--    dado verificado, e mudanca passa pela API.
-- -----------------------------------------------------------------------------
CREATE POLICY "medicos: ver quem divide clinica comigo" ON "medicos"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()) OR (SELECT "public"."compartilha_clinica"("perfil_id")));
--> statement-breakpoint
REVOKE UPDATE ON "medicos" FROM anon, authenticated;--> statement-breakpoint
GRANT UPDATE ("especialidade") ON "medicos" TO authenticated;--> statement-breakpoint
CREATE POLICY "medicos: editar a propria especialidade" ON "medicos"
  FOR UPDATE TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()))
  WITH CHECK ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 8) pacientes: o proprio; e a equipe assistencial da clinica onde ele tem
--    vinculo de paciente. Recepcao ve (precisa para agendar); a barreira do
--    prontuario em si vem no modulo do prontuario.
-- -----------------------------------------------------------------------------
CREATE POLICY "pacientes: ver o proprio" ON "pacientes"
  FOR SELECT TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "pacientes: equipe ve os pacientes da clinica" ON "pacientes"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "vinculos" v
    WHERE v."perfil_id" = "pacientes"."perfil_id" AND v."papel" = 'paciente' AND v."status" = 'ativo'
      AND (SELECT "public"."tem_papel"(v."clinica_id", ARRAY['medico','recepcao','admin_clinica']::"public"."papel_vinculo"[]))
  ));
--> statement-breakpoint
CREATE POLICY "pacientes: editar o proprio" ON "pacientes"
  FOR UPDATE TO authenticated
  USING ("perfil_id" = (SELECT auth.uid()))
  WITH CHECK ("perfil_id" = (SELECT auth.uid()));
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 9) consultas: alem de ser sua, tem de ser da clinica onde voce tem vinculo.
--    Um medico com vinculo em duas clinicas nao ve, na Clinica A, a consulta
--    que ele mesmo atendeu na Clinica B (ADR-0008).
-- -----------------------------------------------------------------------------
CREATE POLICY "consultas: ver as minhas nesta clinica" ON "consultas"
  FOR SELECT TO authenticated
  USING (
    (SELECT "public"."tem_vinculo"("clinica_id"))
    AND (
      "paciente_id" = (SELECT auth.uid())
      OR "medico_id" = (SELECT auth.uid())
      OR (SELECT "public"."tem_papel"("clinica_id", ARRAY['recepcao','admin_clinica']::"public"."papel_vinculo"[]))
    )
  );
--> statement-breakpoint
CREATE POLICY "consultas: paciente marca na clinica dele" ON "consultas"
  FOR INSERT TO authenticated
  WITH CHECK (
    "paciente_id" = (SELECT auth.uid())
    AND (SELECT "public"."papel_na_clinica"("clinica_id")) = 'paciente'
  );
--> statement-breakpoint
CREATE POLICY "consultas: os dois lados atualizam" ON "consultas"
  FOR UPDATE TO authenticated
  USING ((SELECT "public"."tem_vinculo"("clinica_id")) AND ("paciente_id" = (SELECT auth.uid()) OR "medico_id" = (SELECT auth.uid())))
  WITH CHECK ((SELECT "public"."tem_vinculo"("clinica_id")) AND ("paciente_id" = (SELECT auth.uid()) OR "medico_id" = (SELECT auth.uid())));
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 10) auditoria: so a administracao da PROPRIA clinica le. Inserir continua
--     permitido em proprio nome; alterar e apagar, ninguem (ADR-0005).
-- -----------------------------------------------------------------------------
CREATE POLICY "auditoria: admin da clinica le" ON "auditoria"
  FOR SELECT TO authenticated
  USING ("clinica_id" IS NOT NULL AND (SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
CREATE POLICY "auditoria: inserir em proprio nome" ON "auditoria"
  FOR INSERT TO authenticated
  WITH CHECK ("quem" = (SELECT auth.uid()));
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 11) Documentacao dentro do banco.
-- -----------------------------------------------------------------------------
COMMENT ON TABLE "clinicas" IS 'O cliente da plataforma. Unidade de isolamento de todo dado assistencial.';--> statement-breakpoint
COMMENT ON TABLE "vinculos" IS 'Pessoa x clinica x papel. Onde mora o papel desde o Modulo 6.';--> statement-breakpoint
COMMENT ON TABLE "convites" IS 'Convite de profissional. Guarda apenas o hash do codigo.';--> statement-breakpoint
COMMENT ON COLUMN "perfis"."suporte_plataforma" IS 'Equipe da plataforma. Nunca da acesso a prontuario (ADR-0008).';
