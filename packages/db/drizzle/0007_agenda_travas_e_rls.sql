-- =============================================================================
--  0007_agenda_travas_e_rls.sql  (ESCRITA A MAO)
--
--  Duas coisas que o Drizzle nao gera e que sao o coracao deste modulo:
--
--  1. A TRAVA CONTRA DUPLA MARCACAO. Conferir "ja tem consulta nesse
--     horario?" no codigo da API nao basta: entre a conferencia e a
--     gravacao cabe outra requisicao. Dois pacientes clicando ao mesmo
--     segundo levam a duas consultas no mesmo horario - e a fila de espera
--     de uma manha inteira vai por agua abaixo. So o banco resolve isso, e
--     resolve com uma RESTRICAO DE EXCLUSAO: ele se recusa a guardar duas
--     linhas cujos intervalos de tempo se cruzem para o mesmo medico.
--
--  2. As politicas de RLS das tabelas novas, no mesmo padrao do Modulo 6:
--     "e da clinica onde voce tem vinculo?" antes de qualquer coisa.
-- =============================================================================

-- btree_gist permite misturar, no mesmo indice, comparacao por igualdade
-- (o uuid do medico) e por sobreposicao (o intervalo de tempo).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- O Postgres traz faixas prontas para data e para data-hora (daterange,
-- tstzrange), mas nao para hora do dia. Criamos a nossa: e o que permite
-- perguntar se dois blocos da grade semanal se cruzam.
DO $$ BEGIN
  CREATE TYPE "public"."timerange" AS RANGE (subtype = time);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 1) Nenhum medico em dois lugares ao mesmo tempo.
--
-- Le-se: "recuse uma linha nova se ja existir outra com o MESMO medico (=)
-- cujo intervalo [inicio, fim) se SOBREPONHA (&&) ao dela".
--
-- O WHERE deixa de fora consultas canceladas e concluidas: horario de
-- consulta cancelada volta a ficar livre, e consulta concluida ja passou.
--
-- Repare que a trava NAO inclui a clinica: e proposital. A mesma medica
-- atendendo em duas clinicas nao pode ser marcada as 9h nas duas.
-- -----------------------------------------------------------------------------
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_sem_sobreposicao_do_medico"
  EXCLUDE USING gist (
    "medico_id" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  ) WHERE ("status" IN ('agendada', 'em_andamento'));
--> statement-breakpoint

-- O mesmo para o paciente: ninguem esta em duas consultas ao mesmo tempo.
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_sem_sobreposicao_do_paciente"
  EXCLUDE USING gist (
    "paciente_id" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  ) WHERE ("status" IN ('agendada', 'em_andamento'));
--> statement-breakpoint

-- E os blocos da grade semanal nao se sobrepoem entre si (mesmo medico,
-- mesma clinica, mesmo dia da semana).
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_sem_sobreposicao"
  EXCLUDE USING gist (
    "medico_id" WITH =,
    "clinica_id" WITH =,
    "dia_semana" WITH =,
    timerange("hora_inicio", "hora_fim", '[)') WITH &&
  );
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2) RLS das tabelas novas.
--    disponibilidades: qualquer pessoa com vinculo na clinica ve (o paciente
--    precisa, para escolher horario); so o proprio medico edita.
-- -----------------------------------------------------------------------------
ALTER TABLE "disponibilidades" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bloqueios" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "disponibilidades: quem tem vinculo ve" ON "disponibilidades"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_vinculo"("clinica_id")));
--> statement-breakpoint
CREATE POLICY "disponibilidades: o medico edita a propria grade" ON "disponibilidades"
  FOR UPDATE TO authenticated
  USING ("medico_id" = (SELECT auth.uid()) AND (SELECT "public"."tem_vinculo"("clinica_id")))
  WITH CHECK ("medico_id" = (SELECT auth.uid()) AND (SELECT "public"."tem_vinculo"("clinica_id")));
--> statement-breakpoint

-- Bloqueio e informacao da equipe (diz onde o medico esta): o paciente nao
-- precisa saber que e "ferias" - para ele, o horario simplesmente nao aparece.
CREATE POLICY "bloqueios: a equipe ve" ON "bloqueios"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['medico','recepcao','admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint

-- Criar e apagar grade e bloqueio passa pela API (que audita).
REVOKE INSERT, DELETE ON "disponibilidades" FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "bloqueios" FROM anon, authenticated;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3) consultas: a recepcao passa a poder marcar em nome do paciente, e o
--    cancelamento ganha regra. Substituimos as politicas de escrita do
--    Modulo 6 (a de leitura continua igual).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "consultas: paciente marca na clinica dele" ON "consultas";
--> statement-breakpoint
DROP POLICY IF EXISTS "consultas: os dois lados atualizam" ON "consultas";
--> statement-breakpoint

CREATE POLICY "consultas: paciente ou recepcao marcam" ON "consultas"
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT "public"."tem_vinculo"("clinica_id"))
    AND (
      -- o proprio paciente marcando para si
      ("paciente_id" = (SELECT auth.uid()) AND (SELECT "public"."papel_na_clinica"("clinica_id")) = 'paciente')
      -- ou a equipe marcando em nome dele
      OR (SELECT "public"."tem_papel"("clinica_id", ARRAY['recepcao','admin_clinica','medico']::"public"."papel_vinculo"[]))
    )
    -- o paciente marcado precisa ter vinculo de paciente nesta clinica
    AND EXISTS (
      SELECT 1 FROM "vinculos" v
      WHERE v."perfil_id" = "consultas"."paciente_id" AND v."clinica_id" = "consultas"."clinica_id"
        AND v."papel" = 'paciente' AND v."status" = 'ativo'
    )
    -- e o medico marcado precisa atender nela
    AND EXISTS (
      SELECT 1 FROM "vinculos" v
      WHERE v."perfil_id" = "consultas"."medico_id" AND v."clinica_id" = "consultas"."clinica_id"
        AND v."papel" = 'medico' AND v."status" = 'ativo'
    )
  );
--> statement-breakpoint

CREATE POLICY "consultas: envolvidos e equipe atualizam" ON "consultas"
  FOR UPDATE TO authenticated
  USING (
    (SELECT "public"."tem_vinculo"("clinica_id"))
    AND (
      "paciente_id" = (SELECT auth.uid())
      OR "medico_id" = (SELECT auth.uid())
      OR (SELECT "public"."tem_papel"("clinica_id", ARRAY['recepcao','admin_clinica']::"public"."papel_vinculo"[]))
    )
  )
  WITH CHECK (
    (SELECT "public"."tem_vinculo"("clinica_id"))
    AND (
      "paciente_id" = (SELECT auth.uid())
      OR "medico_id" = (SELECT auth.uid())
      OR (SELECT "public"."tem_papel"("clinica_id", ARRAY['recepcao','admin_clinica']::"public"."papel_vinculo"[]))
    )
  );
--> statement-breakpoint

-- Trocar paciente, medico ou clinica de uma consulta ja marcada nao e
-- "editar": e outra consulta. Essas colunas saem do UPDATE (o RLS decide
-- linhas, nao colunas - por isso o GRANT nomeia uma a uma).
REVOKE UPDATE ON "consultas" FROM anon, authenticated;
--> statement-breakpoint
GRANT UPDATE ("inicio", "fim", "status", "motivo", "cancelado_por", "cancelado_em", "motivo_cancelamento", "atualizado_em")
  ON "consultas" TO authenticated;
--> statement-breakpoint

COMMENT ON TABLE "disponibilidades" IS 'Grade semanal do medico por clinica. Horarios livres sao calculados, nao guardados.';
--> statement-breakpoint
COMMENT ON TABLE "bloqueios" IS 'Periodos em que o medico nao atende (ferias, congresso).';
--> statement-breakpoint
COMMENT ON CONSTRAINT "consultas_sem_sobreposicao_do_medico" ON "consultas" IS 'Impede dupla marcacao mesmo com requisicoes simultaneas.';
