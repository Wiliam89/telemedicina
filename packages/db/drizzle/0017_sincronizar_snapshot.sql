-- =============================================================================
--  0017_sincronizar_snapshot.sql
--
--  Esta migracao nao muda nada num banco que ja rodou a 0015: ela existe
--  para alinhar o SNAPSHOT do Drizzle.
--
--  Por que isso acontece: migracao escrita a mao (--custom) aplica SQL no
--  banco, mas o Drizzle nao "le" esse SQL - ele so sabe o que gerou. Como
--  a 0015 adicionou colunas a mao, o snapshot ficou atras do schema em
--  TypeScript, e o proximo `pnpm db:gerar` tentaria criar tudo de novo.
--
--  A licao, para as proximas: quando uma migracao manual mexer em coluna
--  que TAMBEM esta no schema TypeScript, gere uma migracao de sincronia
--  logo em seguida - com IF NOT EXISTS, para ser inofensiva nos dois casos
--  (banco que ja tem, e banco novo que aplicou tudo em ordem).
-- =============================================================================

ALTER TABLE "consultas" ADD COLUMN IF NOT EXISTS "expira_reserva_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consultas" ADD COLUMN IF NOT EXISTS "pagamento_id" uuid;
