-- =============================================================================
--  0015_consulta_aguardando_pagamento.sql  (ESCRITA A MAO)
--
--  Ate aqui, marcar consulta criava uma consulta "agendada" na hora. Com
--  pagamento, aparece um estado no meio: o paciente escolheu o horario,
--  mas ainda nao pagou.
--
--  Esse estado precisa EXISTIR no banco, e nao so na cabeca do codigo:
--  enquanto o paciente paga, o horario tem de ficar RESERVADO. Se nao
--  ficasse, ele pagaria e descobriria que perdeu o horario - o pior erro
--  possivel numa agenda, e irreparavel, porque o dinheiro ja saiu.
--
--  --------------------------------------------------------------------------
--  POR QUE TROCAMOS O TIPO INTEIRO EM VEZ DE SO ACRESCENTAR UM VALOR
--
--  O caminho obvio seria:
--      ALTER TYPE status_consulta ADD VALUE 'aguardando_pagamento';
--
--  Ele funciona - mas o Postgres proibe USAR um valor de enum na mesma
--  transacao em que ele foi criado ("unsafe use of new value"). E o
--  migrador aplica todas as migracoes pendentes numa transacao so. Ou
--  seja: num banco que ja esta em dia, funciona; numa instalacao NOVA, que
--  roda esta migracao junto com a proxima, quebra.
--
--  A saida e criar um tipo NOVO ja com todos os valores e trocar a coluna
--  para ele. O tipo novo nasce completo, entao usa-lo em seguida nao tem
--  restricao nenhuma.
--  --------------------------------------------------------------------------
-- =============================================================================

-- A coluna tem um valor padrao que aponta para o tipo antigo: ele sai
-- primeiro e volta no fim, ja apontando para o tipo novo.
ALTER TABLE "consultas" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint

CREATE TYPE "public"."status_consulta_novo" AS ENUM (
  'aguardando_pagamento', 'agendada', 'em_andamento', 'concluida', 'cancelada'
);
--> statement-breakpoint

-- As travas de exclusao e o CHECK mencionam a coluna: eles saem, a coluna
-- muda de tipo, e a migracao 0016 os recria ja com o estado novo incluido.
ALTER TABLE "consultas" DROP CONSTRAINT IF EXISTS "consultas_sem_sobreposicao_do_medico";
--> statement-breakpoint
ALTER TABLE "consultas" DROP CONSTRAINT IF EXISTS "consultas_sem_sobreposicao_do_paciente";
--> statement-breakpoint
ALTER TABLE "consultas" DROP CONSTRAINT IF EXISTS "consultas_cancelamento_completo";
--> statement-breakpoint

ALTER TABLE "consultas"
  ALTER COLUMN "status" TYPE "public"."status_consulta_novo"
  USING "status"::text::"public"."status_consulta_novo";
--> statement-breakpoint

DROP TYPE "public"."status_consulta";
--> statement-breakpoint
ALTER TYPE "public"."status_consulta_novo" RENAME TO "status_consulta";
--> statement-breakpoint

ALTER TABLE "consultas" ALTER COLUMN "status" SET DEFAULT 'agendada';
--> statement-breakpoint

-- O CHECK do cancelamento volta como estava (Modulo 7).
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_cancelamento_completo" CHECK (
  ("status" <> 'cancelada' AND "cancelado_em" IS NULL AND "cancelado_por" IS NULL)
  OR ("status" = 'cancelada' AND "cancelado_em" IS NOT NULL)
);
--> statement-breakpoint

-- Ate quando o horario fica reservado esperando o pagamento.
ALTER TABLE "consultas" ADD COLUMN IF NOT EXISTS "expira_reserva_em" timestamp with time zone;
--> statement-breakpoint

-- O pagamento que confirma esta consulta.
ALTER TABLE "consultas" ADD COLUMN IF NOT EXISTS "pagamento_id" uuid REFERENCES "pagamentos"("id") ON DELETE SET NULL;
--> statement-breakpoint

COMMENT ON COLUMN "consultas"."expira_reserva_em" IS 'Ate quando o horario fica preso esperando o pagamento. Vencido, volta a ficar livre.';
