/**
 * GET /indicadores?dias=30 - o painel da administracao (ADR-0019).
 *
 * Tudo agregado no banco, numa ida so por bloco, e SO numeros: quantas
 * consultas, quanto entrou, quanto se esperou na fila. Nenhum nome de
 * paciente, nenhum dado clinico - a administracao gere a clinica, nao le
 * prontuario.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Banco } from "@tele/db";
import type { Indicadores, Resposta } from "@tele/shared";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";

export async function rotasIndicadores(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const soAdmin = [...criarExigirClinica(banco, opcoes.autenticar), exigirPapel("admin_clinica")];

  app.get("/indicadores", { preHandler: soAdmin }, async (req): Promise<Resposta<Indicadores>> => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
    const sql = banco.$client;
    const clinica = req.contexto.clinicaId;
    const fuso = req.contexto.fusoHorario;
    const ate = new Date();
    const de = new Date(ate.getTime() - dias * 86400000);
    const [deIso, ateIso] = [de.toISOString(), ate.toISOString()];

    const [consultas, porDia, porMedico, receita, fila, pacientes, documentos] = await Promise.all([
      sql<{ status: string; n: number }[]>`
        select status, count(*)::int as n from consultas
        where clinica_id = ${clinica} and inicio between ${deIso}::timestamptz and ${ateIso}::timestamptz
        group by status`,
      sql<{ dia: string; total: number; concluidas: number }[]>`
        select to_char(inicio at time zone ${fuso}, 'YYYY-MM-DD') as dia,
               count(*) filter (where status <> 'cancelada')::int as total,
               count(*) filter (where status = 'concluida')::int as concluidas
        from consultas
        where clinica_id = ${clinica} and inicio between ${deIso}::timestamptz and ${ateIso}::timestamptz
        group by 1 order by 1`,
      sql<{ medico: string; total: number; concluidas: number; canceladas: number }[]>`
        select p.nome_completo as medico, count(*)::int as total,
               count(*) filter (where c.status = 'concluida')::int as concluidas,
               count(*) filter (where c.status = 'cancelada')::int as canceladas
        from consultas c join perfis p on p.id = c.medico_id
        where c.clinica_id = ${clinica} and c.inicio between ${deIso}::timestamptz and ${ateIso}::timestamptz
        group by p.nome_completo order by total desc limit 20`,
      sql<{ bruta: number; clinica: number; n: number }[]>`
        select coalesce(sum(valor_centavos), 0)::int as bruta, coalesce(sum(valor_clinica_centavos), 0)::int as clinica, count(*)::int as n
        from pagamentos
        where clinica_id = ${clinica} and status = 'confirmado' and confirmado_em between ${deIso}::timestamptz and ${ateIso}::timestamptz`,
      sql<{ atendidos: number; desistencias: number; espera: number | null }[]>`
        select count(*) filter (where status = 'atendido')::int as atendidos,
               count(*) filter (where status in ('desistiu', 'expirado'))::int as desistencias,
               round(avg(extract(epoch from (chamado_em - entrou_em)) / 60) filter (where chamado_em is not null))::int as espera
        from fila_atendimento
        where clinica_id = ${clinica} and entrou_em between ${deIso}::timestamptz and ${ateIso}::timestamptz`,
      sql<{ novos: number; atendidos: number }[]>`
        select
          (select count(*)::int from vinculos where clinica_id = ${clinica} and papel = 'paciente' and criado_em between ${deIso}::timestamptz and ${ateIso}::timestamptz) as novos,
          (select count(distinct paciente_id)::int from consultas where clinica_id = ${clinica} and status = 'concluida' and inicio between ${deIso}::timestamptz and ${ateIso}::timestamptz) as atendidos`,
      sql<{ emitidos: number; assinados: number }[]>`
        select count(*) filter (where status <> 'cancelado')::int as emitidos, count(*) filter (where status = 'assinado')::int as assinados
        from documentos
        where clinica_id = ${clinica} and criado_em between ${deIso}::timestamptz and ${ateIso}::timestamptz`,
    ]);

    // Todos os dias do periodo, com zero onde nao houve consulta: a serie
    // mostra o ritmo da clinica, nao so os dias com movimento.
    const diaLocal = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(t));
    const contados = new Map(porDia.map((d) => [d.dia, d]));
    const serie: { dia: string; total: number; concluidas: number }[] = [];
    for (let t = de.getTime(); diaLocal(t) <= diaLocal(ate.getTime()); t += 86400000) {
      const dia = diaLocal(t);
      if (serie.at(-1)?.dia !== dia) serie.push(contados.get(dia) ?? { dia, total: 0, concluidas: 0 });
    }

    const por = (s: string) => consultas.find((c) => c.status === s)?.n ?? 0;
    const total = consultas.reduce((a, c) => a + c.n, 0);
    const semReserva = total - por("aguardando_pagamento");
    const r = receita[0]!;
    const f = fila[0]!;
    const d = documentos[0]!;

    return {
      ok: true,
      dados: {
        periodo: { de: deIso, ate: ateIso, dias },
        consultas: {
          total,
          concluidas: por("concluida"),
          canceladas: por("cancelada"),
          agendadas: por("agendada") + por("em_andamento"),
          aguardandoPagamento: por("aguardando_pagamento"),
          taxaCancelamento: semReserva > 0 ? por("cancelada") / semReserva : 0,
          porDia: serie,
          porMedico,
        },
        receita: { brutaCentavos: r.bruta, clinicaCentavos: r.clinica, pagamentos: r.n, ticketMedioCentavos: r.n > 0 ? Math.round(r.bruta / r.n) : 0 },
        prontoAtendimento: { atendidos: f.atendidos, desistencias: f.desistencias, esperaMediaMinutos: f.espera },
        pacientes: pacientes[0]!,
        documentos: { emitidos: d.emitidos, assinados: d.assinados, taxaAssinatura: d.emitidos > 0 ? d.assinados / d.emitidos : 0 },
      },
    };
  });
}
