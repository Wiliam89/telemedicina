/**
 * =====================================================================
 * pnpm configurar
 * =====================================================================
 *
 * O que este script faz, em ordem:
 *   1. cria apps/api/.env  a partir de apps/api/.env.example (se nao existir)
 *   2. cria apps/web/.env.local a partir de apps/web/.env.example (se nao existir)
 *   3. cria a pasta docs/ se nao existir
 *   4. chama o verificador, que aponta o que ainda falta preencher
 *
 * Ele NUNCA sobrescreve um .env que ja existe: seus segredos ficam intactos.
 *
 * Roda com Node puro (sem dependencias) para funcionar antes do pnpm install.
 */
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ARQUIVOS = [
  { exemplo: "apps/api/.env.example", destino: "apps/api/.env" },
  { exemplo: "apps/web/.env.example", destino: "apps/web/.env.local" },
];

console.log("\n== Configurando o ambiente ==\n");

for (const { exemplo, destino } of ARQUIVOS) {
  const origem = resolve(raiz, exemplo);
  const alvo = resolve(raiz, destino);

  if (!existsSync(origem)) {
    console.log(`  x  ${exemplo} nao encontrado. O projeto esta incompleto.`);
    process.exit(1);
  }

  if (existsSync(alvo)) {
    console.log(`  =  ${destino} ja existe (mantido como esta)`);
    continue;
  }

  mkdirSync(dirname(alvo), { recursive: true });
  copyFileSync(origem, alvo);
  console.log(`  +  ${destino} criado a partir de ${exemplo}`);
}

const docs = resolve(raiz, "docs");
if (!existsSync(docs)) {
  mkdirSync(docs, { recursive: true });
  console.log("  +  docs/ criada");
}

console.log("\nAgora abra os dois arquivos criados e preencha os valores.");
console.log("Cada linha diz exatamente onde clicar no painel do Supabase.\n");

// Roda o verificador em seguida para mostrar o que falta.
const resultado = spawnSync(
  process.execPath,
  [resolve(raiz, "scripts/verificar-ambiente.mjs")],
  { stdio: "inherit" },
);
process.exit(resultado.status ?? 0);
