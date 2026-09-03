/**
 * @tele/db - tudo que fala com o PostgreSQL do Supabase.
 *
 *   conexao.ts       -> abre a conexao (criarBanco)
 *   schema/          -> as tabelas, em TypeScript (fonte da verdade)
 *   drizzle/         -> as migracoes .sql geradas a partir do schema
 *   estado-banco.ts  -> "o banco esta como o codigo espera?"
 *
 * Nao crie tabela clicando no painel do Supabase: tabela criada por clique
 * nao tem historico nem e reproduzivel (ADR-0004).
 */
export { criarBanco, type Banco } from "./conexao.js";
export * from "./schema/index.js";
export {
  inspecionarBanco,
  resumirEstado,
  rlsCompleto,
  contarMigracoesNaPasta,
  TABELAS_ESPERADAS,
  POLITICAS_ESPERADAS,
  type EstadoBanco,
} from "./estado-banco.js";
