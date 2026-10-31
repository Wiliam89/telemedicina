#!/usr/bin/env node
/**
 * pnpm test:banco
 *
 * Roda os testes da API contra um Postgres DESCARTAVEL. O banco vem de
 * DATABASE_URL_TESTE (do terminal ou de apps/api/.env) e nunca de
 * DATABASE_URL, que pode ser o da producao: os testes criam e apagam dados.
 *
 * Banco de teste novo? Rode nele, nesta ordem:
 *   scripts/preparar-banco-de-teste.sql
 *   DATABASE_URL=<banco de teste> pnpm db:migrar
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pastaApi = resolve(raiz, "apps/api");

function lerDoEnv() {
  const arquivo = resolve(pastaApi, ".env");
  if (!existsSync(arquivo)) return undefined;
  const linha = readFileSync(arquivo, "utf8").split(/\r?\n/).find((l) => /^\s*DATABASE_URL_TESTE\s*=/.test(l));
  return linha?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") || undefined;
}

const url = process.env.DATABASE_URL_TESTE || lerDoEnv();
if (!url) {
  console.error("\nDATABASE_URL_TESTE nao definida. Os testes de banco precisam de um Postgres descartavel.");
  console.error("Veja a secao 11 do manual (docs/manual) ou scripts/preparar-banco-de-teste.sql.\n");
  process.exit(1);
}

const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--no-file-parallelism", ...process.argv.slice(2)], {
  cwd: pastaApi,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(r.status ?? 1);
