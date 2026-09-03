/**
 * pnpm db:verificar-clinicas   (tambem e o passo [9/9] do `pnpm verificar`)
 *
 * Confere o que o Modulo 6 promete sobre isolamento:
 *   - toda consulta e toda linha de vinculo pertencem a uma clinica;
 *   - nenhuma clinica esta sem administracao (clinica orfa nao se gerencia);
 *   - nenhum vinculo de medico aponta para alguem sem CRM cadastrado;
 *   - convites guardam hash, nunca codigo em claro.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";

let falhas = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const erro = (m: string, dica?: string) => {
  falhas++;
  console.log(`  ERRO ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};

const sql = postgres(lerDatabaseUrl(), { prepare: false, connect_timeout: 10, max: 1 });

try {
  const [c] = await sql<{ total: number }[]>`select count(*)::int as total from clinicas`;
  const [semAdmin] = await sql<{ total: number }[]>`
    select count(*)::int as total from clinicas c
    where not exists (
      select 1 from vinculos v where v.clinica_id = c.id and v.papel = 'admin_clinica' and v.status = 'ativo'
    )
  `;
  const [consultasSemClinica] = await sql<{ total: number }[]>`
    select count(*)::int as total from consultas where clinica_id is null
  `;
  const [medicosSemCrm] = await sql<{ total: number }[]>`
    select count(*)::int as total from vinculos v
    where v.papel = 'medico' and not exists (select 1 from medicos m where m.perfil_id = v.perfil_id)
  `;
  const [hashRuim] = await sql<{ total: number }[]>`
    select count(*)::int as total from convites where codigo_hash !~ '^[0-9a-f]{64}$'
  `;

  ok(`${c?.total ?? 0} clinica(s) cadastrada(s)`);

  if ((semAdmin?.total ?? 0) === 0) ok("toda clinica tem ao menos uma administracao ativa");
  else erro(`${semAdmin!.total} clinica(s) sem admin_clinica ativo`, "Uma clinica sem administracao nao consegue convidar nem se gerir. Promova alguem pela API.");

  if ((consultasSemClinica?.total ?? 0) === 0) ok("toda consulta pertence a uma clinica");
  else erro(`${consultasSemClinica!.total} consulta(s) sem clinica`, "A migracao 0003 deveria ter preenchido. Rode: pnpm db:migrar");

  if ((medicosSemCrm?.total ?? 0) === 0) ok("todo vinculo de medico tem CRM cadastrado");
  else erro(`${medicosSemCrm!.total} vinculo(s) de medico sem CRM`, "CFM 2.314/2022 exige registro ativo. Complete o cadastro do profissional.");

  if ((hashRuim?.total ?? 0) === 0) ok("convites guardam apenas o hash do codigo");
  else erro(`${hashRuim!.total} convite(s) com codigo_hash fora do formato SHA-256`, "Revogue esses convites e gere outros.");

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar as clinicas: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
