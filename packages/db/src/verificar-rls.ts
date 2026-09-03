/**
 * pnpm db:verificar-rls   (tambem roda dentro de `pnpm verificar`, passo [7/7])
 *
 * Prova que a seguranca por linha do Modulo 4 esta ligada: RLS ativo nas
 * cinco tabelas, as politicas da migracao 0002 presentes, a funcao
 * papel_atual() existente e a auditoria sem UPDATE/DELETE para usuarios.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";
import { inspecionarBanco, POLITICAS_ESPERADAS, TABELAS_ESPERADAS } from "./estado-banco.js";

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

  if (e.tabelasFaltando.length > 0) {
    erro(`faltam tabelas: ${e.tabelasFaltando.join(", ")}`, "Rode: pnpm db:migrar");
  } else if (e.tabelasSemRls.length === 0) {
    ok(`RLS ligado nas ${TABELAS_ESPERADAS.length} tabelas`);
  } else {
    erro(`RLS DESLIGADO em: ${e.tabelasSemRls.join(", ")}`, "A migracao 0002 nao foi aplicada (ou alguem desligou no painel). Rode: pnpm db:migrar");
  }

  if (e.politicas >= POLITICAS_ESPERADAS) ok(`${e.politicas} politicas no schema public (esperadas: ${POLITICAS_ESPERADAS})`);
  else erro(`${e.politicas} politicas no schema public; esperadas ${POLITICAS_ESPERADAS}`, "Rode: pnpm db:migrar. Se ja rodou, alguem apagou politica no painel: refaca pelo SQL da 0002.");

  if (e.funcoesDeContexto === 5) ok("as 5 funcoes de contexto multi-clinica existem");
  else erro(`${e.funcoesDeContexto} de 5 funcoes de contexto (papel_na_clinica, tem_vinculo, tem_papel, minhas_clinicas, compartilha_clinica)`, "Rode: pnpm db:migrar");

  if (e.vinculosProtegidos) ok("vinculos: papel so muda pela API");
  else erro("o papel authenticated pode escrever em vinculos", "Rode no SQL Editor: REVOKE INSERT, UPDATE, DELETE ON vinculos FROM anon, authenticated;");

  if (e.auditoriaProtegida) ok("auditoria: usuarios nao podem alterar nem apagar");
  else erro("auditoria: o papel authenticated ainda tem UPDATE ou DELETE", "Rode no SQL Editor: REVOKE UPDATE, DELETE ON auditoria FROM anon, authenticated;");

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar o banco: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
