/**
 * pnpm db:verificar-fila   (passo [14/14] do `pnpm verificar`)
 *
 * Confere a integridade do pronto atendimento. Dois itens aqui protegem
 * pessoas: ninguem esperando sem consentimento registrado, e ninguem
 * esquecido na fila.
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
  const [fila] = await sql<{ n: number }[]>`select count(*)::int as n from fila_atendimento where status = 'aguardando'`;
  const [plantao] = await sql<{ n: number }[]>`select count(*)::int as n from plantoes where status = 'aberto'`;
  ok(`${fila?.n ?? 0} paciente(s) aguardando, ${plantao?.n ?? 0} plantao(oes) aberto(s)`);

  const [semConsentimento] = await sql<{ n: number }[]>`
    select count(*)::int as n from fila_atendimento
    where status = 'aguardando' and (consentimento_em is null or consentimento_versao is null)
  `;
  if ((semConsentimento?.n ?? 0) === 0) ok("todo mundo na fila consentiu com o termo (e a versao esta registrada)");
  else erro(`${semConsentimento!.n} pessoa(s) aguardando sem consentimento registrado`, "O CHECK do banco impede isso. Se apareceu, investigue.");

  const [semPagamento] = await sql<{ n: number }[]>`
    select count(*)::int as n from fila_atendimento f
    join pagamentos p on p.id = f.pagamento_id
    where f.status in ('aguardando','chamado','em_atendimento') and p.status <> 'confirmado'
  `;
  if ((semPagamento?.n ?? 0) === 0) ok("toda entrada ativa na fila tem pagamento confirmado");
  else erro(`${semPagamento!.n} entrada(s) na fila com pagamento nao confirmado`, "Alguem entrou sem pagar. Investigue a rota POST /fila.");

  // O mesmo pagamento nao pode valer por dois atendimentos.
  const [pagamentoRepetido] = await sql<{ n: number }[]>`
    select count(*)::int as n from (
      select pagamento_id from fila_atendimento group by pagamento_id having count(*) > 1
    ) x
  `;
  if ((pagamentoRepetido?.n ?? 0) === 0) ok("nenhum pagamento usado em mais de um atendimento");
  else erro(`${pagamentoRepetido!.n} pagamento(s) usados mais de uma vez`);

  const [esquecidos] = await sql<{ n: number }[]>`
    select count(*)::int as n from fila_atendimento
    where status = 'aguardando' and entrou_em < now() - interval '2 hours'
  `;
  if ((esquecidos?.n ?? 0) === 0) ok("ninguem esquecido na fila ha mais de 2 horas");
  else aviso(`${esquecidos!.n} pessoa(s) na fila ha mais de 2 horas`, "A rotina de expiracao roda quando alguem consulta a fila. Se ninguem consulta, elas ficam. Vale uma tarefa agendada.");

  // Fila esperando sem ninguem de plantao: o paciente espera sem saber.
  const [orfas] = await sql<{ n: number }[]>`
    select count(distinct f.clinica_id)::int as n from fila_atendimento f
    where f.status = 'aguardando'
      and not exists (select 1 from plantoes p where p.clinica_id = f.clinica_id and p.status = 'aberto')
  `;
  if ((orfas?.n ?? 0) === 0) ok("toda fila com gente tem plantao aberto");
  else aviso(`${orfas!.n} clinica(s) com fila e nenhum plantao aberto`, "A tela avisa o paciente, mas alguem precisa abrir plantao.");

  const [desistenciasPendentes] = await sql<{ n: number }[]>`
    select count(*)::int as n from auditoria
    where acao = 'fila.desistiu' and (detalhes->>'pendenteDeEstorno') = 'true'
      and quando > now() - interval '30 days'
  `;
  if ((desistenciasPendentes?.n ?? 0) === 0) ok("nenhuma desistencia recente aguardando estorno");
  else aviso(`${desistenciasPendentes!.n} desistencia(s) nos ultimos 30 dias pendentes de estorno`, "O estorno depende da politica da clinica e hoje e manual (ADR-0012).");

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar a fila: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
