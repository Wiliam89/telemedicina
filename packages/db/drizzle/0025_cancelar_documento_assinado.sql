ALTER TABLE "documentos" DROP CONSTRAINT "documentos_assinatura_coerente";--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_assinatura_coerente" CHECK (("documentos"."status" = 'emitido' and "documentos"."assinado_em" is null)
          or "documentos"."status" = 'cancelado'
          or ("documentos"."status" = 'assinado' and "documentos"."assinado_em" is not null and "documentos"."assinatura_provedor" is not null
              and "documentos"."arquivo_url" is not null and "documentos"."arquivo_hash" is not null));