/**
 * pnpm db:verificar-video   (passo [15/15] do `pnpm verificar`)
 *
 * Confere a integridade das salas de video. O que este passo procura nao e
 * "esta funcionando", e sim coisas que NAO deveriam existir no banco:
 *
 *   - sala de consulta cancelada (sala que nao devia ter nascido)
 *   - duas salas para a mesma consulta (os dois em lugares diferentes)
 *   - sala vencida e nao encerrada (porta que ficou aberta)
 *   - token guardado em coluna (nunca deve haver)
 *
 * Alguns desses casos o proprio banco impede. Conferir de novo aqui nao e
 * desconfianca do banco: e que se um dia a trava sair numa migracao mal
 * feita, este passo avisa antes de virar problema de verdade.
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
  const [total] = await sql<{ n: number; abertas: number }[]>`
    select count(*)::int as n,
           count(*) filter (where encerrada_em is null)::int as abertas
    from salas_de_video
  `;
  ok(`${total?.n ?? 0} sala(s) de video registrada(s), ${total?.abertas ?? 0} ainda aberta(s)`);

  // Uma consulta, uma sala. O indice unico garante - conferimos de novo.
  const [duplicadas] = await sql<{ n: number }[]>`
    select count(*)::int as n from (
      select consulta_id from salas_de_video group by consulta_id having count(*) > 1
    ) d
  `;
  if ((duplicadas?.n ?? 0) === 0) ok("nenhuma consulta com duas salas (os dois sempre caem no mesmo lugar)");
  else
    erro(
      `${duplicadas!.n} consulta(s) com mais de uma sala`,
      "O indice unico salas_de_video_consulta impede isso. Se apareceu, ele foi removido - investigue a migracao.",
    );

  // Sala de consulta cancelada nao devia existir: a API recusa antes de criar.
  const [canceladas] = await sql<{ n: number }[]>`
    select count(*)::int as n
    from salas_de_video s join consultas c on c.id = s.consulta_id
    where c.status = 'cancelada'
  `;
  if ((canceladas?.n ?? 0) === 0) ok("nenhuma sala em consulta cancelada");
  else
    aviso(
      `${canceladas!.n} sala(s) em consulta que foi cancelada`,
      "Provavelmente a consulta foi cancelada DEPOIS de a sala abrir. Confira se ela foi encerrada.",
    );

  /**
   * Sala vencida e nao encerrada. Nao e erro grave: o provedor apaga a sala
   * sozinho na hora da expiracao, e por isso ela nao abre mais nada. Mas
   * muitas assim indicam que o medico nao esta clicando em "encerrar
   * atendimento" - e e o encerramento que conclui a consulta e tira o
   * paciente da fila.
   */
  const [vencidas] = await sql<{ n: number }[]>`
    select count(*)::int as n from salas_de_video
    where encerrada_em is null and expira_em < now()
  `;
  if ((vencidas?.n ?? 0) === 0) ok("nenhuma sala vencida esperando encerramento");
  else
    aviso(
      `${vencidas!.n} sala(s) venceram sem o medico encerrar`,
      "A sala expira sozinha no provedor, mas a consulta fica como 'em andamento'. Vale lembrar a equipe de encerrar.",
    );

  /**
   * NUNCA deve haver coluna de token nem de gravacao nesta tabela. Token
   * guardado e credencial parada esperando vazamento; coluna de gravacao
   * contradiria o termo que o paciente leu ("a videochamada nao e gravada").
   */
  const colunas = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_name = 'salas_de_video'
      and (column_name like '%token%' or column_name like '%gravac%' or column_name like '%recording%')
  `;
  if (colunas.length === 0) ok("a tabela nao guarda token nem gravacao - como tem que ser");
  else
    erro(
      `a tabela salas_de_video ganhou coluna(s) que nao deveria ter: ${colunas.map((c) => c.column_name).join(", ")}`,
      "Token nao se guarda, e nao ha gravacao (ADR-0014). Remova a coluna.",
    );

  // O RLS desta tabela e o mais estreito do banco: so os dois da consulta.
  const [politicas] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_policies where tablename = 'salas_de_video'
  `;
  if ((politicas?.n ?? 0) >= 1) ok("RLS da sala de video no lugar (so o paciente e o medico da consulta)");
  else erro("salas_de_video esta sem politica de RLS", "Rode  pnpm db:migrar  - a migracao 0019 cria a politica.");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar as salas de video: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
} finally {
  await sql.end({ timeout: 2 });
}

process.exit(falhas === 0 ? 0 : 1);
