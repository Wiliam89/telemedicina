CREATE INDEX "pagamentos_consulta" ON "pagamentos" USING btree ("consulta_id");
-- =============================================================================
--  PARTE ESCRITA A MAO (ADR-0026): a observacao do repasse tambem nao muda.
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."repasse_so_cancela"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Repasse registrado nao se apaga: cancele com motivo.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.cancelado_em IS NOT NULL
     OR NEW.valor_centavos <> OLD.valor_centavos OR NEW.medico_id <> OLD.medico_id OR NEW.clinica_id <> OLD.clinica_id
     OR NEW.pago_em <> OLD.pago_em OR NEW.referencia <> OLD.referencia OR NEW.registrado_por <> OLD.registrado_por
     OR NEW.observacao IS DISTINCT FROM OLD.observacao OR NEW.criado_em <> OLD.criado_em THEN
    RAISE EXCEPTION 'Repasse registrado so pode ser cancelado, uma vez.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
