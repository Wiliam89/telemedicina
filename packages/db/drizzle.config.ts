/**
 * Configuracao do drizzle-kit (a ferramenta de linha de comando do Drizzle).
 *
 *   pnpm db:gerar   -> compara src/schema/ com a ultima migracao em drizzle/
 *                      e escreve um novo arquivo .sql com a diferenca
 *   pnpm db:studio  -> abre um painel local para olhar as tabelas
 *
 * A URL do banco vem de apps/api/.env - o mesmo arquivo da API. Nao existe
 * um segundo lugar para colar a senha.
 */
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

// process.cwd() e packages/db, porque o comando roda via `pnpm --filter @tele/db`.
config({ path: resolve(process.cwd(), "../../apps/api/.env"), quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // So o schema public e nosso. auth, storage etc. sao do Supabase.
  schemaFilter: ["public"],
  // Nomes dos arquivos: 0000_nome.sql (sem palavras aleatorias).
  migrations: { prefix: "index" },
  verbose: true,
  strict: true,
});
