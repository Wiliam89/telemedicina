/**
 * pnpm db:verificar-agenda   (tambem e o passo [10/10] do `pnpm verificar`)
 *
 * Confere o que o Modulo 7 promete. Duas coisas aqui sao mais importantes
 * que as outras: as travas de exclusao existem (sem elas, dois pacientes
 * marcam o mesmo horario) e nenhuma consulta cancelada ficou sem autor
 * ou motivo (sem isso, a auditoria nao explica o que aconteceu).
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";

const TRAVAS = [
  { nome: "consultas_sem_sobreposicao_do_medico", explica: "impede o mesmo medico em duas consultas ao mesmo tempo" },
  { nome: "consultas_sem_sobreposicao_do_paciente", explica: "impede o mesmo paciente em duas consultas ao mesmo tempo" },
  { nome: "disponibilidades_sem_sobreposicao", explica: "impede blocos sobrepostos na grade semanal" },
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
  const existentes = await sql<{ conname: string }[]>`
    select conname from pg_constraint where contype = 'x' and connamespace = 'public'::regnamespace
  `;
  const nomes = existentes.map((e) => e.conname);
  const faltando = TRAVAS.filter((t) => !nomes.includes(t.nome));
  if (faltando.length === 0) ok(`${TRAVAS.length} travas de exclusao ativas (nada de dupla marcacao)`);
  else for (const t of faltando) erro(`falta a trava "${t.nome}" - ela ${t.explica}`, "Rode: pnpm db:migrar");

  const [ext] = await sql<{ tem: boolean }[]>`select exists (select 1 from pg_extension where extname = 'btree_gist') as tem`;
  if (ext?.tem) ok("extensao btree_gist instalada");
  else erro("extensao btree_gist ausente", "Rode: pnpm db:migrar (as travas dependem dela)");

  const [tipo] = await sql<{ tem: boolean }[]>`select exists (select 1 from pg_type where typname = 'timerange') as tem`;
  if (tipo?.tem) ok("tipo timerange criado (faixas de hora do dia)");
  else erro("tipo timerange ausente", "Rode: pnpm db:migrar");

  const [fusoRuim] = await sql<{ total: number }[]>`
    select count(*)::int as total from clinicas where fuso_horario !~ '/' and fuso_horario <> 'UTC'
  `;
  if ((fusoRuim?.total ?? 0) === 0) ok("toda clinica tem fuso IANA (nao deslocamento fixo)");
  else erro(`${fusoRuim!.total} clinica(s) com fuso suspeito`, "Use o nome IANA (ex.: America/Manaus): deslocamento fixo erra no horario de verao.");

  const [cancelSemMotivo] = await sql<{ total: number }[]>`
    select count(*)::int as total from consultas
    where status = 'cancelada' and (cancelado_em is null or cancelado_por is null or motivo_cancelamento is null)
  `;
  if ((cancelSemMotivo?.total ?? 0) === 0) ok("todo cancelamento tem autor, data e motivo");
  else erro(`${cancelSemMotivo!.total} cancelamento(s) incompleto(s)`, "Cancelamento so pela API (POST /consultas/:id/cancelar), que exige motivo.");

  const [gradeOrfa] = await sql<{ total: number }[]>`
    select count(*)::int as total from disponibilidades d
    where not exists (
      select 1 from vinculos v where v.perfil_id = d.medico_id and v.clinica_id = d.clinica_id
        and v.papel = 'medico' and v.status = 'ativo'
    )
  `;
  if ((gradeOrfa?.total ?? 0) === 0) ok("toda grade pertence a um medico com vinculo ativo");
  else erro(`${gradeOrfa!.total} bloco(s) de grade de medico sem vinculo ativo`, "O medico saiu da clinica? Remova a grade dele.");

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar a agenda: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
