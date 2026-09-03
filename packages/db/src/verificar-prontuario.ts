/**
 * pnpm db:verificar-prontuario   (passo [11/11] do `pnpm verificar`)
 *
 * Confere o que sustenta o valor legal do prontuario. Se qualquer item
 * aqui falhar, o registro clinico deixa de servir como prova - e e melhor
 * descobrir isso no terminal do que numa pericia.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";

const GATILHOS = [
  { nome: "evolucoes_imutaveis", explica: "impede alterar ou apagar evolucao finalizada" },
  { nome: "evolucoes_adendo_valido", explica: "impede adendo de adendo e adendo de rascunho" },
  { nome: "documentos_imutaveis", explica: "impede alterar conteudo, hash ou numero de documento emitido" },
];

let falhas = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const erro = (m: string, dica?: string) => {
  falhas++;
  console.log(`  ERRO ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};

const sql = postgres(lerDatabaseUrl(), { prepare: false, connect_timeout: 10, max: 1 });

try {
  const presentes = await sql<{ tgname: string }[]>`
    select tgname from pg_trigger where not tgisinternal
  `;
  const nomes = presentes.map((t) => t.tgname);
  const faltando = GATILHOS.filter((g) => !nomes.includes(g.nome));
  if (faltando.length === 0) ok(`${GATILHOS.length} gatilhos de imutabilidade ativos`);
  else for (const g of faltando) erro(`falta o gatilho "${g.nome}" - ele ${g.explica}`, "Rode: pnpm db:migrar");

  const [numeracao] = await sql<{ tem: boolean }[]>`
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'proximo_numero_documento'
    ) as tem
  `;
  if (numeracao?.tem) ok("numeracao de documentos a prova de emissao simultanea");
  else erro("funcao proximo_numero_documento ausente", "Rode: pnpm db:migrar");

  // Escrita de prontuario e documento so pela API, que audita.
  const [escrita] = await sql<{ pode: boolean }[]>`
    select bool_or(privilege_type in ('INSERT','UPDATE','DELETE')) as pode
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('evolucoes','documentos') and grantee = 'authenticated'
  `;
  if (!(escrita?.pode ?? false)) ok("evolucoes e documentos: escrita so pela API");
  else erro("o papel authenticated escreve direto em evolucoes ou documentos", "Rode: REVOKE INSERT, UPDATE, DELETE ON evolucoes, documentos FROM authenticated;");

  const [hashRuim] = await sql<{ total: number }[]>`
    select count(*)::int as total from documentos where hash !~ '^[0-9a-f]{64}$'
  `;
  if ((hashRuim?.total ?? 0) === 0) ok("todo documento tem hash SHA-256 valido");
  else erro(`${hashRuim!.total} documento(s) com hash fora do formato`);

  // Numero repetido na mesma clinica e ano quebraria a numeracao sequencial.
  const [repetidos] = await sql<{ total: number }[]>`
    select count(*)::int as total from (
      select clinica_id, ano, numero from documentos group by 1,2,3 having count(*) > 1
    ) x
  `;
  if ((repetidos?.total ?? 0) === 0) ok("numeracao sem repeticao por clinica e ano");
  else erro(`${repetidos!.total} numero(s) repetido(s)`, "Isso nao deveria ser possivel: confira o indice documentos_numero_por_clinica_ano.");

  const [orfas] = await sql<{ total: number }[]>`
    select count(*)::int as total from evolucoes e
    where e.adendo_de is not null and not exists (select 1 from evolucoes o where o.id = e.adendo_de)
  `;
  if ((orfas?.total ?? 0) === 0) ok("todo adendo aponta para uma evolucao existente");
  else erro(`${orfas!.total} adendo(s) orfao(s)`);

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar o prontuario: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
