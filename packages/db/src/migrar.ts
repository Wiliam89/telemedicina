/**
 * pnpm db:migrar
 *
 * Aplica no banco, em ordem, cada arquivo .sql de drizzle/ que ainda nao foi
 * aplicado. O Drizzle guarda o que ja rodou na tabela
 * drizzle.__drizzle_migrations, entao rodar duas vezes nao faz nada de novo.
 *
 * Nunca crie tabela clicando no painel do Supabase: o que nao esta em
 * drizzle/ nao existe para o projeto (ADR-0004).
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { criarBanco } from "./conexao.js";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";
import { inspecionarBanco, PASTA_MIGRACOES } from "./estado-banco.js";

const url = lerDatabaseUrl();
const db = criarBanco(url);

try {
  const antes = await inspecionarBanco(db.$client).catch(() => null);
  console.log(`Aplicando migracoes de packages/db/drizzle ...`);

  await migrate(db, { migrationsFolder: PASTA_MIGRACOES });

  const depois = await inspecionarBanco(db.$client);
  const novas = depois.migracoesAplicadas - (antes?.migracoesAplicadas ?? 0);

  if (novas === 0) console.log("Nada novo para aplicar: o banco ja estava atualizado.");
  else console.log(`${novas} migracao(oes) aplicada(s).`);
  console.log(`  migracoes no banco: ${depois.migracoesAplicadas} de ${depois.migracoesEsperadas}`);
  console.log(`  tabelas em public:  ${depois.tabelasEncontradas.join(", ") || "(nenhuma)"}`);
  await db.$client.end();
  process.exit(0);
} catch (erro) {
  // O Drizzle embrulha o erro do Postgres (com o SQL inteiro) em `cause`;
  // mostramos so a causa, que e a linha util.
  const causa = erro instanceof Error && erro.cause instanceof Error ? erro.cause : erro;
  const msg = causa instanceof Error ? causa.message : String(causa);
  console.error("Falha ao migrar:", msg);
  const dica = explicarErroDeConexao(erro);
  if (dica) console.error("  ->", dica);
  else if (/relation "auth.users" does not exist/i.test(msg))
    console.error("  -> O banco nao e um projeto Supabase (nao tem o schema auth). Confira a DATABASE_URL.");
  else if (/already exists/i.test(msg))
    console.error("  -> Ja existe algo com esse nome no banco (criado por clique no painel?). Apague-o e rode de novo.");
  await db.$client.end({ timeout: 1 });
  process.exit(1);
}
