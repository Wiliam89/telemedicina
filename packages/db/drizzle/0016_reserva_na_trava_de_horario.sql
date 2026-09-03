-- =============================================================================
--  0016_reserva_na_trava_de_horario.sql  (ESCRITA A MAO)
--
--  A trava de sobreposicao do Modulo 7 cobria 'agendada' e 'em_andamento'.
--  Agora precisa cobrir tambem 'aguardando_pagamento': enquanto o paciente
--  paga, o horario e dele.
--
--  A 0015 trocou o tipo inteiro justamente para que este passo seja
--  possivel: o tipo novo ja nasceu com 'aguardando_pagamento' dentro, entao
--  usa-lo aqui nao esbarra na restricao do Postgres.
-- =============================================================================

ALTER TABLE "consultas" DROP CONSTRAINT IF EXISTS "consultas_sem_sobreposicao_do_medico";
--> statement-breakpoint
ALTER TABLE "consultas" DROP CONSTRAINT IF EXISTS "consultas_sem_sobreposicao_do_paciente";
--> statement-breakpoint

ALTER TABLE "consultas" ADD CONSTRAINT "consultas_sem_sobreposicao_do_medico"
  EXCLUDE USING gist (
    "medico_id" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  ) WHERE ("status" IN ('aguardando_pagamento', 'agendada', 'em_andamento'));
--> statement-breakpoint

ALTER TABLE "consultas" ADD CONSTRAINT "consultas_sem_sobreposicao_do_paciente"
  EXCLUDE USING gist (
    "paciente_id" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  ) WHERE ("status" IN ('aguardando_pagamento', 'agendada', 'em_andamento'));
--> statement-breakpoint

-- Reserva so faz sentido com prazo: sem ele, um horario ficaria preso para
-- sempre se o pagamento nunca acontecesse.
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_reserva_tem_prazo"
  CHECK ("status" <> 'aguardando_pagamento' OR "expira_reserva_em" IS NOT NULL);
--> statement-breakpoint

-- RLS: `precos` e visivel a quem tem vinculo (o paciente precisa saber
-- quanto custa antes de marcar); mexer no preco e da administracao, pela API.
ALTER TABLE "precos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "precos: quem tem vinculo ve" ON "precos"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_vinculo"("clinica_id")));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "precos" FROM anon, authenticated;
--> statement-breakpoint

-- As credenciais de recebimento seguem a mesma regra do segredo de
-- assinatura: nem o admin da clinica as ve (migracao 0013 ja revogou o
-- SELECT da tabela; aqui apenas nao as incluimos no GRANT).
COMMENT ON COLUMN "clinicas"."pagamento_token_cifrado" IS
  'Cifrado com AES-256-GCM. Token OAuth da conta da clinica no provedor. Vence: ver pagamento_token_expira_em.';
