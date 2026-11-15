/**
 * =====================================================================
 * REPASSE AOS MEDICOS (ADR-0026)
 * =====================================================================
 *
 * Quanto de cada consulta e do medico. A regra de calculo fica num lugar so,
 * em SQL, para o painel da administracao e a tela do medico nunca darem
 * numeros diferentes.
 *
 *   ganho do medico numa consulta =
 *     piso( valor pago e nao estornado  x  porcentagem / 10000 )
 *
 *   porcentagem = a congelada na consulta; se a consulta for anterior a
 *                 regra, a do medico; senao a padrao; senao zero.
 *
 * Arredonda PARA BAIXO, como a comissao (pagamento/precificacao.ts): na
 * duvida sobre um centavo, ele fica com quem paga o repasse. A soma das
 * partes nunca passa do total.
 *
 * So entra consulta CONCLUIDA e pagamento CONFIRMADO: consulta cancelada,
 * estornada ou ainda nao cobrada nao gera ganho.
 */
import { and, eq, sql } from "drizzle-orm";
import { clinicas, percentuaisMedicos, type Banco } from "@tele/db";

type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

/** A porcentagem que vale para este medico AGORA (a de quem marca a consulta hoje). */
export async function percentualDoMedico(b: Executor, clinicaId: string, medicoId: string): Promise<number | null> {
  const [proprio] = await b
    .select({ bps: percentuaisMedicos.percentualBps })
    .from(percentuaisMedicos)
    .where(and(eq(percentuaisMedicos.clinicaId, clinicaId), eq(percentuaisMedicos.medicoId, medicoId)))
    .limit(1);
  if (proprio) return proprio.bps;
  const [c] = await b.select({ bps: clinicas.repassePadraoBps }).from(clinicas).where(eq(clinicas.id, clinicaId)).limit(1);
  return c?.bps ?? null;
}

export function repasseEmCentavos(valorCentavos: number, bps: number): number {
  return Math.floor((valorCentavos * bps) / 10000);
}

export interface GanhoDoMedico {
  medicoId: string;
  consultas: number;
  faturadoCentavos: number;
  repasseCentavos: number;
}

/**
 * Ganhos por medico num periodo (pela data da consulta). Sem periodo: desde
 * sempre - e o que entra no saldo.
 */
export async function ganhosPorMedico(b: Banco, clinicaId: string, periodo?: { de: Date; ate: Date }, medicoId?: string): Promise<GanhoDoMedico[]> {
  const linhas = await b.execute<{ medico_id: string; consultas: number; faturado: number; repasse: number }>(sql`
    with pagas as (
      select c.id, c.medico_id,
             coalesce(c.repasse_medico_bps, pm.percentual_bps, cl.repasse_padrao_bps, 0) as bps,
             (select coalesce(sum(p.valor_centavos), 0) from pagamentos p where p.consulta_id = c.id and p.status = 'confirmado')::bigint as valor
      from consultas c
      join clinicas cl on cl.id = c.clinica_id
      left join percentuais_medicos pm on pm.clinica_id = c.clinica_id and pm.medico_id = c.medico_id
      where c.clinica_id = ${clinicaId} and c.status = 'concluida'
        ${periodo ? sql`and c.inicio >= ${periodo.de.toISOString()}::timestamptz and c.inicio < ${periodo.ate.toISOString()}::timestamptz` : sql``}
        ${medicoId ? sql`and c.medico_id = ${medicoId}` : sql``}
    )
    select medico_id,
           count(*) filter (where valor > 0)::int as consultas,
           coalesce(sum(valor), 0)::bigint as faturado,
           coalesce(sum(floor(valor * bps / 10000.0)), 0)::bigint as repasse
    from pagas
    group by medico_id
  `);
  return (linhas as unknown as { medico_id: string; consultas: number; faturado: number | string; repasse: number | string }[]).map((l) => ({
    medicoId: l.medico_id,
    consultas: Number(l.consultas),
    faturadoCentavos: Number(l.faturado),
    repasseCentavos: Number(l.repasse),
  }));
}

/** O que ja foi registrado como pago a cada medico (sem os cancelados). */
export async function pagoPorMedico(b: Executor, clinicaId: string, medicoId?: string): Promise<Map<string, number>> {
  const linhas = (await b.execute<{ medico_id: string; total: number }>(sql`
    select medico_id, coalesce(sum(valor_centavos), 0)::bigint as total
    from repasses_medicos
    where clinica_id = ${clinicaId} and cancelado_em is null
      ${medicoId ? sql`and medico_id = ${medicoId}` : sql``}
    group by medico_id
  `)) as unknown as { medico_id: string; total: number | string }[];
  return new Map(linhas.map((l) => [l.medico_id, Number(l.total)]));
}

/** Saldo a receber de um medico: tudo o que ganhou menos tudo o que ja foi pago. */
export async function saldoDoMedico(b: Banco, clinicaId: string, medicoId: string): Promise<{ ganhoCentavos: number; pagoCentavos: number; saldoCentavos: number }> {
  const [ganho] = await ganhosPorMedico(b, clinicaId, undefined, medicoId);
  const pago = (await pagoPorMedico(b, clinicaId, medicoId)).get(medicoId) ?? 0;
  const ganhoCentavos = ganho?.repasseCentavos ?? 0;
  return { ganhoCentavos, pagoCentavos: pago, saldoCentavos: ganhoCentavos - pago };
}
