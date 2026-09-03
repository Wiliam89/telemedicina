-- =============================================================================
--  0010_prontuario_imutavel_e_rls.sql  (ESCRITA A MAO)
--
--  O Modulo 4 tornou a AUDITORIA imutavel. Este torna o PRONTUARIO imutavel,
--  que e um degrau acima: aqui nem a API, com a chave secreta, consegue
--  alterar. A trava e um gatilho - e gatilho vale para todo mundo, inclusive
--  para o dono do banco.
--
--  Por que tao severo: a Resolucao CFM 1.821/2007 exige que o sistema
--  permita a uma pericia tirar conclusoes sobre a validade do que foi
--  registrado. Um registro que o fornecedor do software pode reescrever nao
--  serve de prova - nem para o medico, nem contra ele.
--
--  Errou depois de finalizar? Escreve-se um ADENDO, apontando para a
--  evolucao original. Nao se rasura prontuario; acrescenta-se.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Evolucao finalizada nao muda e nao some.
--    Enquanto e rascunho, o medico edita a vontade. No instante em que
--    status vira 'finalizada', a linha vira pedra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."proteger_evolucao_finalizada"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'finalizada' THEN
      RAISE EXCEPTION 'Evolucao finalizada nao pode ser apagada (id %). Registre um adendo.', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'finalizada' THEN
    -- Uma unica excecao: marcar que um adendo foi escrito nao muda o texto.
    RAISE EXCEPTION 'Evolucao finalizada nao pode ser alterada (id %). Registre um adendo.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Rascunho virando finalizada: carimba a hora aqui, nao no codigo.
  IF NEW.status = 'finalizada' AND OLD.status = 'rascunho' THEN
    NEW.finalizada_em = now();
  END IF;

  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "evolucoes_imutaveis"
  BEFORE UPDATE OR DELETE ON "evolucoes"
  FOR EACH ROW EXECUTE FUNCTION "public"."proteger_evolucao_finalizada"();
--> statement-breakpoint

-- O adendo aponta para a evolucao original. A chave e criada aqui porque a
-- coluna referencia a propria tabela.
ALTER TABLE "evolucoes" ADD CONSTRAINT "evolucoes_adendo_de_fk"
  FOREIGN KEY ("adendo_de") REFERENCES "evolucoes"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- Adendo de adendo nao: todos apontam para a evolucao original, senao a
-- historia vira corrente e ninguem sabe qual e o texto valido.
CREATE OR REPLACE FUNCTION "public"."validar_adendo"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  origem record;
BEGIN
  IF NEW.adendo_de IS NULL THEN RETURN NEW; END IF;

  SELECT status, adendo_de, paciente_id INTO origem FROM public.evolucoes WHERE id = NEW.adendo_de;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A evolucao que este adendo corrige nao existe.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF origem.adendo_de IS NOT NULL THEN
    RAISE EXCEPTION 'Adendo de adendo nao e permitido: aponte para a evolucao original.' USING ERRCODE = 'check_violation';
  END IF;
  IF origem.status <> 'finalizada' THEN
    RAISE EXCEPTION 'So se faz adendo de evolucao finalizada. Esta ainda e rascunho: edite-a.' USING ERRCODE = 'check_violation';
  END IF;
  IF origem.paciente_id <> NEW.paciente_id THEN
    RAISE EXCEPTION 'O adendo pertence a outro paciente que a evolucao original.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "evolucoes_adendo_valido"
  BEFORE INSERT ON "evolucoes"
  FOR EACH ROW EXECUTE FUNCTION "public"."validar_adendo"();
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2) Documento emitido nao muda. So duas transicoes sao aceitas:
--    emitido -> assinado (Modulo 9) e emitido/assinado -> cancelado.
--    Conteudo, hash, numero e codigo de validacao nunca mudam.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."proteger_documento"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Documento nao se apaga (id %). Cancele com motivo.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.conteudo IS DISTINCT FROM OLD.conteudo
     OR NEW.texto_impresso IS DISTINCT FROM OLD.texto_impresso
     OR NEW.hash IS DISTINCT FROM OLD.hash
     OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.ano IS DISTINCT FROM OLD.ano
     OR NEW.codigo_validacao IS DISTINCT FROM OLD.codigo_validacao
     OR NEW.paciente_id IS DISTINCT FROM OLD.paciente_id
     OR NEW.medico_id IS DISTINCT FROM OLD.medico_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    RAISE EXCEPTION 'Documento emitido e imutavel (id %). Cancele e emita outro.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'cancelado' THEN
    RAISE EXCEPTION 'Documento cancelado nao volta atras (id %).', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "documentos_imutaveis"
  BEFORE UPDATE OR DELETE ON "documentos"
  FOR EACH ROW EXECUTE FUNCTION "public"."proteger_documento"();
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3) Numeracao sequencial por clinica e ano, a prova de corrida.
--    Dois medicos emitindo ao mesmo tempo nao podem receber o mesmo numero.
--    O bloqueio consultivo (advisory lock) serializa por clinica+ano, e o
--    indice unico e a rede de seguranca embaixo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."proximo_numero_documento"(p_clinica uuid, p_ano integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  proximo integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_clinica::text || ':' || p_ano::text));
  SELECT coalesce(max(numero), 0) + 1 INTO proximo
  FROM public.documentos WHERE clinica_id = p_clinica AND ano = p_ano;
  RETURN proximo;
END;
$$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4) RLS das tabelas novas.
--
--    A regra do prontuario e mais estreita que a das outras tabelas:
--    recepcao e administracao NAO leem evolucao clinica. Elas agendam,
--    cobram e organizam - nao precisam saber o que o paciente tem. E o
--    principio da necessidade (LGPD art. 6, III) virando politica.
-- -----------------------------------------------------------------------------
ALTER TABLE "evolucoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plantoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fila_atendimento" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pagamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- evolucoes: o paciente le a propria; o medico le o que escreveu e o
-- historico de quem ele atende naquela clinica. Ninguem mais.
CREATE POLICY "evolucoes: paciente le as proprias" ON "evolucoes"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()) AND "status" = 'finalizada');
--> statement-breakpoint
CREATE POLICY "evolucoes: medico le as do paciente que atende" ON "evolucoes"
  FOR SELECT TO authenticated
  USING (
    (SELECT "public"."tem_papel"("clinica_id", ARRAY['medico']::"public"."papel_vinculo"[]))
    AND (
      "medico_id" = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM "consultas" c
        WHERE c."paciente_id" = "evolucoes"."paciente_id"
          AND c."medico_id" = (SELECT auth.uid())
          AND c."clinica_id" = "evolucoes"."clinica_id"
      )
    )
  );
--> statement-breakpoint
-- Escrever prontuario e pela API (que audita e valida). Nem o medico
-- escreve direto no banco.
REVOKE INSERT, UPDATE, DELETE ON "evolucoes" FROM anon, authenticated;
--> statement-breakpoint

-- documentos: o paciente ve os seus; o medico ve os que emitiu.
CREATE POLICY "documentos: paciente ve os seus" ON "documentos"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "documentos: medico ve os que emitiu" ON "documentos"
  FOR SELECT TO authenticated
  USING ("medico_id" = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "documentos" FROM anon, authenticated;
--> statement-breakpoint

-- plantoes: a equipe da clinica ve a escala.
CREATE POLICY "plantoes: equipe ve a escala" ON "plantoes"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['medico','recepcao','admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "plantoes" FROM anon, authenticated;
--> statement-breakpoint

-- fila: o paciente ve a propria senha; a equipe ve a fila da clinica.
CREATE POLICY "fila: paciente ve a propria" ON "fila_atendimento"
  FOR SELECT TO authenticated
  USING ("paciente_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "fila: equipe ve a fila da clinica" ON "fila_atendimento"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['medico','recepcao','admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "fila_atendimento" FROM anon, authenticated;
--> statement-breakpoint

-- pagamentos: quem pagou ve o proprio; a administracao ve os da clinica.
-- Medico e recepcao nao veem valores - nao e trabalho deles.
CREATE POLICY "pagamentos: pagador ve os seus" ON "pagamentos"
  FOR SELECT TO authenticated
  USING ("pagador_id" = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "pagamentos: administracao ve os da clinica" ON "pagamentos"
  FOR SELECT TO authenticated
  USING ((SELECT "public"."tem_papel"("clinica_id", ARRAY['admin_clinica']::"public"."papel_vinculo"[])));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "pagamentos" FROM anon, authenticated;
--> statement-breakpoint

COMMENT ON TABLE "evolucoes" IS 'Registro clinico (SOAP). Finalizada e imutavel; correcao se faz por adendo.';--> statement-breakpoint
COMMENT ON TABLE "documentos" IS 'Receita, atestado, pedido de exame. Imutavel apos emissao; hash e codigo de validacao publicos.';--> statement-breakpoint
COMMENT ON TABLE "pagamentos" IS 'Valores em centavos. O split e executado pelo provedor (ADR-0010).';
