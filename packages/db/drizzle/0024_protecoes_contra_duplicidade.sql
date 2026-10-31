-- =============================================================================
--  0024_protecoes_contra_duplicidade.sql
--
--  A API ja impede cobranca duplicada e entrada dupla na fila; estes indices sao
--  a ultima trava, para valer mesmo com varias copias da API.
--
--  Antes de criar os indices, resolve duplicatas que ja existam. So mexe em
--  cobranca ainda EM ABERTO e em entrada ativa da fila: nada que ja foi pago ou
--  atendido muda. Na cobranca fica a autorizada e, no empate, a mais recente, que
--  e a que a tela mostrou por ultimo. Na fila fica a mais avancada e a mais antiga.
--  E seguro aplicar antes ou depois de publicar o codigo novo.
-- =============================================================================

UPDATE "pagamentos" SET "status" = 'expirado', "atualizado_em" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "consulta_id" ORDER BY ("status" = 'autorizado') DESC, "criado_em" DESC) AS n
    FROM "pagamentos"
    WHERE "consulta_id" IS NOT NULL AND "status" IN ('pendente', 'autorizado')
  ) d WHERE d.n > 1
);
--> statement-breakpoint

UPDATE "pagamentos" SET "status" = 'expirado', "atualizado_em" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "pagador_id", "clinica_id" ORDER BY "criado_em" DESC) AS n
    FROM "pagamentos"
    WHERE "consulta_id" IS NULL AND "status" = 'pendente'
  ) d WHERE d.n > 1
);
--> statement-breakpoint

UPDATE "fila_atendimento" SET "status" = 'desistiu', "encerrado_em" = now(), "observacao" = 'entrada duplicada encerrada por migracao'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "paciente_id", "clinica_id" ORDER BY ("status" <> 'aguardando') DESC, "entrou_em" ASC) AS n
    FROM "fila_atendimento"
    WHERE "status" IN ('aguardando', 'chamado', 'em_atendimento')
  ) d WHERE d.n > 1
);
--> statement-breakpoint

UPDATE "fila_atendimento" SET "status" = 'desistiu', "encerrado_em" = now(), "observacao" = 'pagamento reutilizado encerrado por migracao'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "pagamento_id" ORDER BY ("status" <> 'aguardando') DESC, "entrou_em" ASC) AS n
    FROM "fila_atendimento"
    WHERE "status" IN ('aguardando', 'chamado', 'em_atendimento')
  ) d WHERE d.n > 1
);
--> statement-breakpoint

CREATE UNIQUE INDEX "pagamentos_um_em_aberto_por_consulta" ON "pagamentos" USING btree ("consulta_id") WHERE "pagamentos"."consulta_id" is not null and "pagamentos"."status" in ('pendente', 'autorizado');--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_um_pendente_pronto_atendimento" ON "pagamentos" USING btree ("pagador_id","clinica_id") WHERE "pagamentos"."consulta_id" is null and "pagamentos"."status" = 'pendente';--> statement-breakpoint
CREATE UNIQUE INDEX "fila_uma_entrada_ativa_por_paciente" ON "fila_atendimento" USING btree ("paciente_id","clinica_id") WHERE "fila_atendimento"."status" in ('aguardando', 'chamado', 'em_atendimento');--> statement-breakpoint
CREATE UNIQUE INDEX "fila_um_uso_ativo_por_pagamento" ON "fila_atendimento" USING btree ("pagamento_id") WHERE "fila_atendimento"."status" in ('aguardando', 'chamado', 'em_atendimento');