/**
 * pnpm db:verificar-tabelas   (tambem roda dentro de `pnpm verificar`, passo [6/6])
 *
 * Confere se o banco esta no estado que o Modulo 3 espera. Cada linha diz
 * o que faltou e qual comando resolve.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";
import { inspecionarBanco, TABELAS_ESPERADAS } from "./estado-banco.js";

let falhas = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const erro = (m: string, dica?: string) => {
  falhas++;
  console.log(`  ERRO ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};

const sql = postgres(lerDatabaseUrl(), { prepare: false, connect_timeout: 10, max: 1 });

try {
  const e = await inspecionarBanco(sql);

  if (e.tabelasFaltando.length === 0) ok(`${TABELAS_ESPERADAS.length} tabelas presentes: ${TABELAS_ESPERADAS.join(", ")}`);
  else erro(`faltam tabelas: ${e.tabelasFaltando.join(", ")}`, "Rode: pnpm db:migrar");

  if (e.migracoesAplicadas === e.migracoesEsperadas) ok(`${e.migracoesAplicadas} migracao(oes) aplicada(s) - igual a pasta drizzle/`);
  else if (e.migracoesAplicadas < e.migracoesEsperadas)
    erro(`${e.migracoesAplicadas} de ${e.migracoesEsperadas} migracoes aplicadas`, "Rode: pnpm db:migrar");
  else
    erro(`o banco tem ${e.migracoesAplicadas} migracoes, a pasta so ${e.migracoesEsperadas}`, "Faltam arquivos em packages/db/drizzle/. Reextraia o zip do modulo ou faca git pull.");

  if (e.chaveParaAuth) ok("perfis.id aponta para auth.users.id");
  else erro("perfis.id NAO aponta para auth.users.id", "A migracao 0001 nao foi aplicada. Rode: pnpm db:migrar");

  if (e.gatilhos.length === 2) ok("gatilhos de atualizado_em em perfis e consultas");
  else erro(`gatilhos de atualizado_em: ${e.gatilhos.length} de 2`, "A migracao 0001 nao foi aplicada. Rode: pnpm db:migrar");

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar o banco: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
