/**
 * pnpm db:testar-conexao
 *
 * Le DATABASE_URL de apps/api/.env, conecta no Supabase e roda um SELECT
 * simples. Se isto funciona, a URL e a senha estao certas.
 * Se nao funciona, a mensagem diz o motivo mais provavel.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";

const url = lerDatabaseUrl();

const sql = postgres(url, { prepare: false, connect_timeout: 10 });

try {
  const [linha] = await sql`select now() as agora, current_setting('server_version') as versao`;
  console.log("Conectado ao Postgres do Supabase.");
  console.log(`  versao do servidor: ${linha?.versao}`);
  console.log(`  hora no servidor:   ${linha?.agora}`);
  await sql.end();
  process.exit(0);
} catch (erro) {
  const msg = erro instanceof Error ? erro.message : String(erro);
  console.error("Falha ao conectar:", msg);
  const dica = explicarErroDeConexao(erro);
  if (dica) console.error("  ->", dica);
  await sql.end({ timeout: 1 });
  process.exit(1);
}
