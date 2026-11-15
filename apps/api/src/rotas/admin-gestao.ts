/**
 * =====================================================================
 * GESTAO DA ADMINISTRACAO (ADR-0027)
 * =====================================================================
 *
 *   GET  /admin/pacientes?busca=&filtro=        cadastro e numeros de cada paciente
 *   POST /admin/pacientes/:id/restringir        impede de marcar e de entrar na fila
 *   POST /admin/pacientes/:id/liberar           encerra a restricao
 *   GET  /admin/indicadores?de&ate              faltas, fila, retornos e satisfacao (NPS)
 *   GET  /admin/financeiro/planilha?de&ate&tipo planilha (CSV) para a contabilidade
 *
 * A administracao ve cadastro e numeros, NUNCA prontuario, queixa ou motivo.
 * O comentario da avaliacao aparece porque o paciente o escreveu para a
 * plataforma (a tela pede para nao colocar dado de saude).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { restricoesPacientes, vinculos, type Banco } from "@tele/db";
import type { IndicadoresDeQualidade, PacienteNaAdministracao, Resposta } from "@tele/shared";
import { calcularNps, centavosParaCsv, montarCsv, taxa } from "@tele/shared/retorno";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

const DIA = 86400000;
const DIAS_MAXIMOS = 400;
/** Acima disso, pede um periodo menor em vez de cortar a planilha sem avisar. */
const LINHAS_MAXIMAS = 20000;
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");

/** "12345678901" -> "***.456.789-**" (o suficiente para conferir com a pessoa). */
export function mascararCpf(cpf: string | null): string | null {
  if (!cpf || cpf.length !== 11) return null;
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

export async function rotasGestao(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const s = banco.$client;
  const soAdmin = [...criarExigirClinica(banco, opcoes.autenticar), exigirPapel("admin_clinica")];

  /** O periodo pedido, em dias do fuso da plataforma ("ate 31/10" inclui o dia 31 inteiro). */
  async function periodo(q: { de?: string | undefined; ate?: string | undefined }, fuso: string, diasPadrao: number) {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date());
    const diaAte = q.ate ?? hoje;
    const diaDe = q.de ?? new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(Date.now() - diasPadrao * DIA));
    if (diaAte < diaDe) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data final precisa ser depois da inicial.");
    const [l] = await s<{ de: Date; ate: Date }[]>`
      select (${diaDe}::date::timestamp at time zone ${fuso}) as de,
             ((${diaAte}::date + 1)::timestamp at time zone ${fuso}) as ate`;
    const de = new Date(l!.de);
    const ate = new Date(l!.ate);
    if (ate.getTime() - de.getTime() > DIAS_MAXIMOS * DIA) throw new ErroHttp(400, "PERIODO_GRANDE_DEMAIS", `Peça no máximo ${DIAS_MAXIMOS} dias por vez.`);
    return { de, ate, diaDe, diaAte };
  }

  // --- pacientes ---------------------------------------------------------------------

  const esquemaBusca = z.object({ busca: z.string().trim().max(80).optional(), filtro: z.enum(["todos", "restritos", "com_faltas", "com_pendencia"]).default("todos") });

  /**
   * A BUSCA vai no corpo (POST /admin/pacientes/buscar), nunca na URL: nome e
   * CPF na URL acabam em log de servidor e historico do navegador (LGPD).
   * O GET aceita so o filtro.
   */
  app.get("/admin/pacientes", { preHandler: soAdmin }, async (req) => listarPacientes(req.contexto.clinicaId, { filtro: esquemaBusca.parse({ filtro: (req.query as { filtro?: string }).filtro }).filtro }));
  app.post("/admin/pacientes/buscar", { preHandler: soAdmin }, async (req) => listarPacientes(req.contexto.clinicaId, esquemaBusca.strict().parse(req.body ?? {})));

  async function listarPacientes(clinicaId: string, q: z.infer<typeof esquemaBusca>): Promise<Resposta<PacienteNaAdministracao[]>> {
    // % e _ digitados sao letras, nao curingas do ILIKE.
    const nome = q.busca ? `%${q.busca.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const digitos = q.busca ? q.busca.replace(/\D/g, "") : "";
    const cpf = digitos.length >= 3 ? `%${digitos}%` : null;

    const linhas = await s<{
      id: string; nome: string; cpf: string | null; telefone: string | null; desde: Date;
      concluidas: number; faltas: number; pendentes: number; motivo: string | null; restrito_em: Date | null;
    }[]>`
      with base as (
        select p.id, p.nome_completo as nome, p.cpf, p.telefone, v.criado_em as desde,
          (select count(*) from consultas c where c.paciente_id = p.id and c.clinica_id = ${clinicaId} and c.status = 'concluida')::int as concluidas,
          (select count(*) from consultas c where c.paciente_id = p.id and c.clinica_id = ${clinicaId} and c.ausencia = 'paciente')::int as faltas,
          (select count(*) from consultas c where c.paciente_id = p.id and c.clinica_id = ${clinicaId} and c.status = 'concluida' and c.forma_de_cobranca = 'cartao_ao_final'
             and exists (select 1 from pagamentos pg where pg.consulta_id = c.id and pg.status = 'recusado')
             and not exists (select 1 from pagamentos pg where pg.consulta_id = c.id and pg.status in ('confirmado', 'autorizado')))::int as pendentes,
          r.motivo, r.criado_em as restrito_em
        from vinculos v
        join perfis p on p.id = v.perfil_id
        left join restricoes_pacientes r on r.paciente_id = p.id and r.clinica_id = ${clinicaId} and r.encerrado_em is null
        where v.clinica_id = ${clinicaId} and v.papel = 'paciente' and v.status = 'ativo'
          and (${nome}::text is null or p.nome_completo ilike ${nome} or (${cpf}::text is not null and p.cpf like ${cpf}))
      )
      select * from base
      where ${q.filtro}::text = 'todos'
         or (${q.filtro}::text = 'restritos' and motivo is not null)
         or (${q.filtro}::text = 'com_faltas' and faltas > 0)
         or (${q.filtro}::text = 'com_pendencia' and pendentes > 0)
      order by nome
      limit 300`;

    return {
      ok: true,
      dados: linhas.map((l) => ({
        id: l.id,
        nomeCompleto: l.nome,
        cpfMascarado: mascararCpf(l.cpf),
        telefone: l.telefone,
        cadastradoEm: new Date(l.desde).toISOString(),
        consultasConcluidas: l.concluidas,
        faltas: l.faltas,
        pagamentosPendentes: l.pendentes,
        restricao: l.motivo ? { motivo: l.motivo, desde: new Date(l.restrito_em!).toISOString() } : null,
      })),
    };
   }

  app.post("/admin/pacientes/:id/restringir", { preHandler: soAdmin }, async (req, reply): Promise<Resposta<{ restrito: true }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().trim().min(5, "explique o motivo (ao menos 5 letras)").max(300) }).strict().parse(req.body);
    const [paciente] = await banco
      .select({ id: vinculos.id })
      .from(vinculos)
      .where(and(eq(vinculos.perfilId, id), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "paciente")))
      .limit(1);
    if (!paciente) throw new ErroHttp(404, "PACIENTE_NAO_ENCONTRADO", "Paciente não encontrado na plataforma.");
    if (id === req.usuario.id) throw new ErroHttp(409, "NAO_A_SI_MESMO", "Você não pode restringir a própria conta.");

    try {
      await banco.transaction(async (tx) => {
        await tx.insert(restricoesPacientes).values({ clinicaId: req.contexto.clinicaId, pacienteId: id, motivo, criadoPor: req.usuario.id });
        await registrarAuditoria(tx, {
          quem: req.usuario.id,
          clinicaId: req.contexto.clinicaId,
          acao: "paciente.restringido",
          tabela: "restricoes_pacientes",
          registroId: id,
          detalhes: { motivo },
          ip: req.ip,
        });
      });
    } catch (erro) {
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      if (codigo === "23505") throw new ErroHttp(409, "JA_RESTRITO", "Este paciente já está impedido de marcar.");
      throw erro;
    }
    void reply.code(201);
    return { ok: true, dados: { restrito: true } };
  });

  app.post("/admin/pacientes/:id/liberar", { preHandler: soAdmin }, async (req): Promise<Resposta<{ restrito: false }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    await banco.transaction(async (tx) => {
      const feitas = await tx
        .update(restricoesPacientes)
        .set({ encerradoEm: new Date(), encerradoPor: req.usuario.id })
        .where(and(eq(restricoesPacientes.clinicaId, req.contexto.clinicaId), eq(restricoesPacientes.pacienteId, id), isNull(restricoesPacientes.encerradoEm)))
        .returning({ id: restricoesPacientes.id });
      if (feitas.length === 0) throw new ErroHttp(404, "SEM_RESTRICAO", "Este paciente não está impedido de marcar.");
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "paciente.restricao_encerrada",
        tabela: "restricoes_pacientes",
        registroId: id,
        ip: req.ip,
      });
    });
    return { ok: true, dados: { restrito: false } };
  });

  // --- indicadores de qualidade ------------------------------------------------------------

  app.get("/admin/indicadores", { preHandler: soAdmin }, async (req): Promise<Resposta<IndicadoresDeQualidade>> => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional() }).parse(req.query);
    const clinicaId = req.contexto.clinicaId;
    const p = await periodo(q, req.contexto.fusoHorario, 30);
    const de = p.de.toISOString();
    const ate = p.ate.toISOString();

    const [[c], [f], [r], notas, porMedico, comentarios] = await Promise.all([
      s<{ realizadas: number; faltas_paciente: number; faltas_medico: number; canceladas: number }[]>`
        select count(*) filter (where status in ('concluida', 'em_andamento'))::int as realizadas,
               count(*) filter (where ausencia = 'paciente')::int as faltas_paciente,
               count(*) filter (where ausencia = 'medico')::int as faltas_medico,
               count(*) filter (where status = 'cancelada' and ausencia is null)::int as canceladas
        from consultas
        where clinica_id = ${clinicaId} and inicio >= ${de}::timestamptz and inicio < ${ate}::timestamptz and inicio < now()`,
      s<{ entradas: number; atendidas: number; desistencias: number }[]>`
        select count(*)::int as entradas,
               count(*) filter (where status in ('atendido', 'em_atendimento'))::int as atendidas,
               count(*) filter (where status in ('desistiu', 'expirado'))::int as desistencias
        from fila_atendimento
        where clinica_id = ${clinicaId} and entrou_em >= ${de}::timestamptz and entrou_em < ${ate}::timestamptz`,
      s<{ liberados: number; marcados: number }[]>`
        select count(*) filter (where retorno_ate is not null)::int as liberados,
               (select count(*) from consultas r where r.clinica_id = ${clinicaId} and r.retorno_de is not null and r.status <> 'cancelada'
                  and r.criado_em >= ${de}::timestamptz and r.criado_em < ${ate}::timestamptz)::int as marcados
        from consultas
        where clinica_id = ${clinicaId} and inicio >= ${de}::timestamptz and inicio < ${ate}::timestamptz`,
      s<{ nota: number }[]>`
        select nota from avaliacoes_consulta
        where clinica_id = ${clinicaId} and criado_em >= ${de}::timestamptz and criado_em < ${ate}::timestamptz`,
      s<{ medico_id: string; nome: string; notas: number[] | null; faltas: number }[]>`
        select m.perfil_id as medico_id, pf.nome_completo as nome,
               (select array_agg(a.nota) from avaliacoes_consulta a where a.medico_id = m.perfil_id and a.clinica_id = ${clinicaId}
                  and a.criado_em >= ${de}::timestamptz and a.criado_em < ${ate}::timestamptz) as notas,
               (select count(*) from consultas c where c.medico_id = m.perfil_id and c.clinica_id = ${clinicaId} and c.ausencia = 'medico'
                  and c.inicio >= ${de}::timestamptz and c.inicio < ${ate}::timestamptz)::int as faltas
        from vinculos v
        join medicos m on m.perfil_id = v.perfil_id
        join perfis pf on pf.id = v.perfil_id
        where v.clinica_id = ${clinicaId} and v.papel = 'medico'
        order by pf.nome_completo`,
      s<{ nota: number; comentario: string; criado_em: Date }[]>`
        select nota, comentario, criado_em from avaliacoes_consulta
        where clinica_id = ${clinicaId} and comentario is not null and criado_em >= ${de}::timestamptz and criado_em < ${ate}::timestamptz
        order by criado_em desc
        limit 50`,
    ]);

    const devidas = c!.realizadas + c!.faltas_paciente + c!.faltas_medico;
    const lista = notas.map((n) => n.nota);
    return {
      ok: true,
      dados: {
        periodo: { de: p.diaDe, ate: p.diaAte },
        consultasQueDeviamAcontecer: devidas,
        faltasDoPaciente: c!.faltas_paciente,
        faltasDoMedico: c!.faltas_medico,
        taxaDeFaltaDoPaciente: taxa(c!.faltas_paciente, devidas),
        taxaDeFaltaDoMedico: taxa(c!.faltas_medico, devidas),
        canceladas: c!.canceladas,
        fila: { entradas: f!.entradas, atendidas: f!.atendidas, desistencias: f!.desistencias, taxaDeDesistencia: taxa(f!.desistencias, f!.entradas) },
        retornos: { liberados: r!.liberados, marcados: r!.marcados },
        satisfacao: {
          respostas: lista.length,
          nps: calcularNps(lista),
          media: lista.length ? Math.round((lista.reduce((a, b) => a + b, 0) / lista.length) * 10) / 10 : null,
          promotores: lista.filter((n) => n >= 9).length,
          neutros: lista.filter((n) => n === 7 || n === 8).length,
          detratores: lista.filter((n) => n <= 6).length,
        },
        porMedico: porMedico
          .map((m) => ({ medicoId: m.medico_id, nome: m.nome, respostas: m.notas?.length ?? 0, nps: calcularNps(m.notas ?? []), faltasDoMedico: m.faltas }))
          .filter((m) => m.respostas > 0 || m.faltasDoMedico > 0),
        comentarios: comentarios.map((x) => ({ nota: x.nota, comentario: x.comentario, criadoEm: new Date(x.criado_em).toISOString() })),
      },
    };
  });

  // --- planilha para a contabilidade ------------------------------------------------------

  /**
   * CSV que o Excel brasileiro abre direto (";" e virgula decimal). Sem dado
   * de paciente: a contabilidade precisa do que entrou e do que saiu, nao de
   * quem foi atendido (LGPD, art. 6, III). Cada download fica na auditoria.
   */
  app.get("/admin/financeiro/planilha", { preHandler: soAdmin, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional(), tipo: z.enum(["consultas", "repasses"]).default("consultas") }).parse(req.query);
    const clinicaId = req.contexto.clinicaId;
    const fuso = req.contexto.fusoHorario;
    const p = await periodo(q, fuso, 30);
    const de = p.de.toISOString();
    const ate = p.ate.toISOString();

    let csv: string;
    if (q.tipo === "consultas") {
      /**
       * Parte do DINHEIRO, nao da consulta: todo pagamento recebido ou
       * devolvido no periodo entra, inclusive de consulta cancelada ou com
       * falta. Assim a receita da planilha bate com a do banco.
       */
      const linhas = await s<{
        pagamento: string; consulta: string | null; recebido_em: Date | null; estornado_em: Date | null; status: string; metodo: string; valor: number; recebido_no_periodo: boolean | null; devolvido_no_periodo: boolean | null;
        situacao: string | null; ausencia: string | null; linha: string | null; especialidade: string | null; medico: string | null; crm: string | null; uf: string | null; bps: number | null;
      }[]>`
        select pg.id as pagamento, pg.consulta_id as consulta, pg.confirmado_em as recebido_em, pg.estornado_em, pg.status, pg.metodo, pg.valor_centavos as valor,
               (pg.confirmado_em >= ${de}::timestamptz and pg.confirmado_em < ${ate}::timestamptz) as recebido_no_periodo,
               (pg.status = 'estornado' and pg.estornado_em >= ${de}::timestamptz and pg.estornado_em < ${ate}::timestamptz) as devolvido_no_periodo,
               c.status as situacao, c.ausencia, c.linha, c.especialidade, pf.nome_completo as medico, m.crm, m.crm_uf as uf,
               coalesce(c.repasse_medico_bps, pm.percentual_bps, cl.repasse_padrao_bps, 0) as bps
        from pagamentos pg
        join clinicas cl on cl.id = pg.clinica_id
        left join consultas c on c.id = pg.consulta_id
        left join medicos m on m.perfil_id = c.medico_id
        left join perfis pf on pf.id = c.medico_id
        left join percentuais_medicos pm on pm.clinica_id = pg.clinica_id and pm.medico_id = c.medico_id
        where pg.clinica_id = ${clinicaId} and pg.status in ('confirmado', 'estornado')
          and ((pg.confirmado_em >= ${de}::timestamptz and pg.confirmado_em < ${ate}::timestamptz)
            or (pg.estornado_em >= ${de}::timestamptz and pg.estornado_em < ${ate}::timestamptz))
        order by coalesce(pg.confirmado_em, pg.estornado_em)
        limit ${LINHAS_MAXIMAS + 1}`;
      if (linhas.length > LINHAS_MAXIMAS) throw new ErroHttp(400, "PLANILHA_GRANDE_DEMAIS", "Período com movimento demais para uma planilha só. Escolha um período menor.");
      const data = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const SITUACAO: Record<string, string> = { concluida: "Concluída", cancelada: "Cancelada", agendada: "Agendada", em_andamento: "Em andamento", aguardando_pagamento: "Aguardando pagamento" };
      csv = montarCsv(
        ["Data do recebimento", "Data da devolução", "Pagamento", "Consulta", "Situação da consulta", "Tipo", "Especialidade", "Médico", "CRM", "Forma", "Valor recebido (R$)", "Valor devolvido (R$)", "% do médico", "Parte do médico (R$)", "Parte da plataforma (R$)"],
        linhas.map((l) => {
          // Cada valor no periodo em que ACONTECEU: devolver em novembro nao reescreve outubro.
          const valor = l.recebido_no_periodo ? Number(l.valor) : 0;
          const devolvido = l.devolvido_no_periodo ? Number(l.valor) : 0;
          const liquido = valor - devolvido;
          // Ganho do medico: so consulta concluida e paga (mesma regra de repasse.ts, arredonda para baixo).
          const medico = l.situacao === "concluida" ? Math.floor((liquido * Number(l.bps ?? 0)) / 10000) : 0;
          return [
            l.recebido_em ? data.format(new Date(l.recebido_em)) : "",
            l.estornado_em ? data.format(new Date(l.estornado_em)) : "",
            l.pagamento.slice(0, 8),
            l.consulta?.slice(0, 8) ?? "",
            l.ausencia === "paciente" ? "Falta do paciente" : l.ausencia === "medico" ? "Falta do médico" : l.situacao ? (SITUACAO[l.situacao] ?? l.situacao) : "Sem consulta",
            l.linha === "pronto_atendimento" ? "Pronto atendimento" : l.linha === "teleconsulta" ? "Teleconsulta" : "",
            l.especialidade ?? "",
            l.medico ?? "",
            l.crm ? `${l.crm}-${l.uf}` : "",
            l.metodo === "pix" ? "Pix" : l.metodo === "cartao_credito" ? "Cartão" : l.metodo,
            centavosParaCsv(valor),
            centavosParaCsv(devolvido),
            l.situacao === "concluida" ? (Number(l.bps ?? 0) / 100).toFixed(2).replace(".", ",") : "",
            centavosParaCsv(medico),
            centavosParaCsv(liquido - medico),
          ];
        }),
      );
    } else {
      const linhas = await s<{ pago_em: Date; medico: string; crm: string; uf: string; valor: number; referencia: string; cancelado_em: Date | null; motivo: string | null }[]>`
        select r.pago_em, pf.nome_completo as medico, m.crm, m.crm_uf as uf, r.valor_centavos as valor, r.referencia, r.cancelado_em, r.motivo_cancelamento as motivo
        from repasses_medicos r
        join medicos m on m.perfil_id = r.medico_id
        join perfis pf on pf.id = r.medico_id
        where r.clinica_id = ${clinicaId} and r.pago_em >= ${de}::timestamptz and r.pago_em < ${ate}::timestamptz
        order by r.pago_em
        limit ${LINHAS_MAXIMAS + 1}`;
      if (linhas.length > LINHAS_MAXIMAS) throw new ErroHttp(400, "PLANILHA_GRANDE_DEMAIS", "Período com movimento demais para uma planilha só. Escolha um período menor.");
      const data = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric" });
      csv = montarCsv(
        ["Data do pagamento", "Médico", "CRM", "Valor (R$)", "Referência", "Situação", "Motivo do cancelamento"],
        linhas.map((l) => [data.format(new Date(l.pago_em)), l.medico, `${l.crm}-${l.uf}`, centavosParaCsv(Number(l.valor)), l.referencia, l.cancelado_em ? "Cancelado" : "Válido", l.motivo ?? ""]),
      );
    }

    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId,
      acao: "financeiro.planilha_exportada",
      tabela: q.tipo === "consultas" ? "consultas" : "repasses_medicos",
      registroId: clinicaId,
      detalhes: { tipo: q.tipo, de: p.diaDe, ate: p.diaAte },
      ip: req.ip,
    });

    void reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${q.tipo}-${p.diaDe}-a-${p.diaAte}.csv"`)
      .header("cache-control", "no-store");
    return csv;
  });
}
