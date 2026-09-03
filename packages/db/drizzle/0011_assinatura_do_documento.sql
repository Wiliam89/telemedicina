-- =============================================================================
--  0011 - Assinatura do documento (Modulo 9)
--
--  O Modulo 8 deixou as colunas de assinatura preparadas. Faltavam quatro,
--  que so ficaram claras ao construir o fluxo de verdade:
--
--    arquivo_hash    - SHA-256 do PDF assinado. Sem ele, trocar o arquivo no
--                      armazenamento passaria despercebido.
--    carimbo_em      - o instante do carimbo do tempo da autoridade, que e
--                      diferente de "quando nosso servidor gravou".
--    assinante_nome  - o titular como consta NO CERTIFICADO, nao como esta
--    assinante_cpf     no nosso cadastro. Sao coisas diferentes, e a
--                      divergencia entre elas e justamente o que precisa
--                      ser detectavel.
--
--  A regra de coerencia tambem ficou mais estrita: documento "assinado" so
--  existe com arquivo e hash do arquivo.
-- =============================================================================

ALTER TABLE "documentos" DROP CONSTRAINT "documentos_assinatura_coerente";--> statement-breakpoint
ALTER TABLE "documentos" ADD COLUMN "arquivo_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "documentos" ADD COLUMN "carimbo_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documentos" ADD COLUMN "assinante_nome" text;--> statement-breakpoint
ALTER TABLE "documentos" ADD COLUMN "assinante_cpf" varchar(11);--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_arquivo_hash_formato" CHECK ("documentos"."arquivo_hash" is null or "documentos"."arquivo_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
-- [dados] Documento marcado como "assinado" sem arquivo nunca esteve
-- assinado de verdade - a coluna existia desde o Modulo 8, mas o fluxo que
-- a preenche nasce agora. Esses registros voltam a "emitido", que e o que
-- eles sempre foram de fato. Sem isto, a nova regra de coerencia nao entra.
UPDATE "documentos"
   SET "status" = 'emitido', "assinado_em" = NULL, "assinatura_provedor" = NULL, "assinatura_id" = NULL
 WHERE "status" = 'assinado' AND ("arquivo_url" IS NULL OR "arquivo_hash" IS NULL);--> statement-breakpoint

ALTER TABLE "documentos" ADD CONSTRAINT "documentos_assinatura_coerente" CHECK (("documentos"."status" <> 'assinado' and "documentos"."assinado_em" is null)
          or ("documentos"."status" = 'assinado' and "documentos"."assinado_em" is not null and "documentos"."assinatura_provedor" is not null
              and "documentos"."arquivo_url" is not null and "documentos"."arquivo_hash" is not null));