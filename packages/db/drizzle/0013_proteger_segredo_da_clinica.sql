-- =============================================================================
--  0013_proteger_segredo_da_clinica.sql  (ESCRITA A MAO)
--
--  A migracao anterior criou as colunas de credencial de assinatura da
--  clinica. Uma delas guarda um SEGREDO - o client secret do provedor,
--  cifrado. Cifrado ja e bom, mas nao basta: ninguem alem da API precisa
--  sequer VER que ele existe.
--
--  E aqui aparece de novo o limite do RLS: ele decide LINHAS, nao COLUNAS.
--  A politica "clinicas: ver as minhas" deixa o membro da clinica ler a
--  linha inteira - inclusive o segredo. A solucao e privilegio por coluna:
--  tira-se o SELECT da tabela e devolve-se coluna a coluna, sem as quatro
--  de credencial.
--
--  Mesmo raciocinio ja usado em `perfis` e `medicos` (Modulo 6) e em
--  `consultas` (Modulo 7).
-- =============================================================================

REVOKE SELECT ON "clinicas" FROM anon, authenticated;
--> statement-breakpoint

-- As colunas que a equipe da clinica pode ler. As quatro de assinatura
-- ficam de fora de proposito: so a API, com a chave secreta, as enxerga.
GRANT SELECT (
  "id", "slug", "nome_fantasia", "razao_social", "cnpj", "status",
  "responsavel_tecnico_id", "fuso_horario", "criado_em", "atualizado_em"
) ON "clinicas" TO authenticated;
--> statement-breakpoint

COMMENT ON COLUMN "clinicas"."assinatura_client_secret_cifrado" IS
  'Cifrado com AES-256-GCM. A chave vive fora do banco (CHAVE_CRIPTOGRAFIA). Nunca legivel por usuario.';
