/**
 * pnpm db:verificar-assinatura   (passo [12/12] do `pnpm verificar`)
 *
 * Confere a coerencia dos documentos assinados. O item mais importante e o
 * ultimo: em producao, documento assinado pelo provedor local NAO tem
 * valor legal - e melhor descobrir isso aqui do que na farmacia.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";

let falhas = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const aviso = (m: string, dica?: string) => {
  console.log(`  !    ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};
const erro = (m: string, dica?: string) => {
  falhas++;
  console.log(`  ERRO ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};

const sql = postgres(lerDatabaseUrl(), { prepare: false, connect_timeout: 10, max: 1 });

try {
  const [total] = await sql<{ n: number }[]>`select count(*)::int as n from documentos where status = 'assinado'`;
  ok(`${total?.n ?? 0} documento(s) assinado(s)`);

  const [semArquivo] = await sql<{ n: number }[]>`
    select count(*)::int as n from documentos
    where status = 'assinado' and (arquivo_url is null or arquivo_hash is null or assinatura_provedor is null)
  `;
  if ((semArquivo?.n ?? 0) === 0) ok("todo assinado tem arquivo, hash do arquivo e provedor");
  else erro(`${semArquivo!.n} documento(s) marcados como assinados sem arquivo`, "A regra do banco impede isso: rode pnpm db:migrar.");

  const [hashRuim] = await sql<{ n: number }[]>`
    select count(*)::int as n from documentos where arquivo_hash is not null and arquivo_hash !~ '^[0-9a-f]{64}$'
  `;
  if ((hashRuim?.n ?? 0) === 0) ok("hash do arquivo sempre em SHA-256");
  else erro(`${hashRuim!.n} arquivo(s) com hash fora do formato`);

  // O CPF do certificado tem de ser o do medico. Divergencia significa que
  // alguem assinou com certificado de outra pessoa.
  const [divergentes] = await sql<{ n: number }[]>`
    select count(*)::int as n from documentos d
    join perfis p on p.id = d.medico_id
    where d.assinante_cpf is not null and p.cpf is not null and d.assinante_cpf <> p.cpf
  `;
  if ((divergentes?.n ?? 0) === 0) ok("o CPF do certificado bate com o do medico em todos");
  else erro(`${divergentes!.n} documento(s) assinados com certificado de outro CPF`, "Investigue: assinatura deve ser sempre do proprio medico.");

  const [local] = await sql<{ n: number }[]>`
    select count(*)::int as n from documentos where assinatura_provedor = 'local_teste'
  `;
  if ((local?.n ?? 0) === 0) ok("nenhum documento assinado com o provedor de teste");
  else if (process.env.NODE_ENV === "production") {
    erro(`${local!.n} documento(s) assinados com o provedor LOCAL DE TESTE`, "Esses documentos NAO tem valor legal. Reemita com certificado ICP-Brasil.");
  } else {
    aviso(`${local!.n} documento(s) assinados com o provedor de teste (sem valor legal)`, "Normal em desenvolvimento. Em producao isso vira erro.");
  }

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar as assinaturas: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
