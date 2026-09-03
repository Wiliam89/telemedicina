-- =============================================================================
--  0008_fuso_da_clinica.sql
--
--  A grade semanal do medico e escrita em hora local ("segunda, 08:00").
--  Ate aqui, "local" era sempre Brasilia, fixo no codigo. Uma plataforma
--  vendida para o Brasil inteiro nao pode assumir isso: Manaus, Cuiaba,
--  Rio Branco e Fernando de Noronha estao em fusos diferentes.
--
--  Guardamos o NOME IANA ("America/Manaus"), nunca o deslocamento
--  ("-04:00"): o deslocamento muda com horario de verao, e o nome carrega
--  esse historico. Ver ADR-0009.
-- =============================================================================

ALTER TABLE "clinicas" ADD COLUMN "fuso_horario" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
COMMENT ON COLUMN "clinicas"."fuso_horario" IS 'Nome IANA do fuso (ex.: America/Sao_Paulo). Define a hora local da grade.';