/**
 * =====================================================================
 * AREA DA ADMINISTRACAO (ADR-0026)
 * =====================================================================
 *
 *   GET   /admin/resumo                      o painel: hoje, 30 dias e pendencias
 *   GET   /admin/configuracoes               os dados da plataforma
 *   PATCH /admin/configuracoes               nome, razao social, fuso, RT, % padrao, prazo de retorno
 *   (pacientes, indicadores e planilha: admin-gestao.ts - ADR-0027)
 *   GET   /admin/medicos                     cada medico: aptidao, %, ganhos, saldo
 *   PUT   /admin/medicos/:id/percentual      a porcentagem propria do medico (ou volta a padrao)
 *   GET   /admin/financeiro?de&ate           receita, repasse por medico, reembolsos
 *   POST  /admin/repasses                    registra uma transferencia feita ao medico
 *   POST  /admin/repasses/:id/cancelar       registro feito por engano
 *   GET   /admin/auditoria                   quem fez o que (sem dado clinico)
 *   GET   /meus-ganhos                       o medico ve o proprio repasse
 *
 * Tudo dentro da clinica (que, no modo plataforma unica, E a plataforma) e
 * tudo da administracao, menos /meus-ganhos. A administracao gere: ela ve
 * numeros e cadastro, nunca prontuario, queixa ou motivo de consulta.
 */
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditoria, clinicas, medicos, percentuaisMedicos, perfis, repassesMedicos, vinculos, type Banco } from "@tele/db";
import type { EventoDeAuditoria, Financeiro, MedicoNaAdministracao, MeusGanhos, Resposta, ResumoDaAdministracao } from "@tele/shared";
import { NOME_DA_ACAO } from "@tele/shared/admin";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { situacoesCrm } from "../crm.js";
import { ErroHttp } from "../erros.js";
import type { ResolvedorDePagamento } from "../pagamento/index.js";
import { ganhosPorMedico, pagoPorMedico, percentualDoMedico, saldoDoMedico } from "../repasse.js";
import { fusoValido } from "./clinicas.js";

const DIA = 86400000;
/** Maior periodo de uma consulta financeira de uma vez. */
const DIAS_MAXIMOS_DO_RELATORIO = 400;

const bps = z.number().int("use no máximo duas casas decimais").min(0, "mínimo 0%").max(10000, "máximo 100%");

export async function rotasAdmin(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador; resolvedor: ResolvedorDePagamento }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soAdmin = [...dentroDaClinica, exigirPapel("admin_clinica")];

  /** Os medicos da clinica (ativos e suspensos), com o que o painel precisa. */
  async function equipeMedica(clinicaId: string) {
    return banco
      .select({
        id: medicos.perfilId,
        nomeCompleto: perfis.nomeCompleto,
        crm: medicos.crm,
        crmUf: medicos.crmUf,
        especialidades: medicos.especialidades,
        atendeProntoAtendimento: medicos.atendeProntoAtendimento,
        status: vinculos.status,
        proprio: percentuaisMedicos.percentualBps,
        online: sql<boolean>`exists (select 1 from plantoes p where p.medico_id = ${medicos.perfilId} and p.clinica_id = ${clinicaId} and p.status = 'aberto' and p.fim >= now())`,
      })
      .from(vinculos)
      .innerJoin(medicos, eq(medicos.perfilId, vinculos.perfilId))
      .innerJoin(perfis, eq(perfis.id, vinculos.perfilId))
      .leftJoin(percentuaisMedicos, and(eq(percentuaisMedicos.medicoId, medicos.perfilId), eq(percentuaisMedicos.clinicaId, clinicaId)))
      .where(and(eq(vinculos.clinicaId, clinicaId), eq(vinculos.papel, "medico")))
      .orderBy(asc(perfis.nomeCompleto));
  }

  async function saldos(clinicaId: string): Promise<Map<string, number>> {
    const [ganhos, pagos] = await Promise.all([ganhosPorMedico(banco, clinicaId), pagoPorMedico(banco, clinicaId)]);
    const mapa = new Map<string, number>();
    for (const g of ganhos) mapa.set(g.medicoId, g.repasseCentavos);
    for (const [id, pago] of pagos) mapa.set(id, (mapa.get(id) ?? 0) - pago);
    return mapa;
  }

  // --- resumo -------------------------------------------------------------------

  app.get("/admin/resumo", { preHandler: soAdmin }, async (req): Promise<Resposta<ResumoDaAdministracao>> => {
    const clinicaId = req.contexto.clinicaId;
    const fuso = req.contexto.fusoHorario;
    const s = banco.$client;
    const agora = new Date();
    const de30 = new Date(agora.getTime() - 30 * DIA);

    const [[c], [hoje], [fila], [online], [receita], [pacientesNovos], [pend], equipe] = await Promise.all([
      banco.select({ nome: clinicas.nomeFantasia, repasse: clinicas.repassePadraoBps }).from(clinicas).where(eq(clinicas.id, clinicaId)).limit(1),
      s<{ total: number; concluidas: number }[]>`
        select count(*) filter (where status <> 'cancelada')::int as total, count(*) filter (where status = 'concluida')::int as concluidas
        from consultas where clinica_id = ${clinicaId}
          and (inicio at time zone ${fuso})::date = (now() at time zone ${fuso})::date`,
      s<{ n: number }[]>`select count(*)::int as n from fila_atendimento where clinica_id = ${clinicaId} and status = 'aguardando'`,
      s<{ n: number }[]>`select count(distinct medico_id)::int as n from plantoes where clinica_id = ${clinicaId} and status = 'aberto' and fim >= now()`,
      s<{ bruta: number; concluidas: number }[]>`
        select coalesce((select sum(valor_centavos) from pagamentos where clinica_id = ${clinicaId} and status = 'confirmado' and confirmado_em >= ${de30.toISOString()}::timestamptz), 0)::bigint as bruta,
               (select count(*) from consultas where clinica_id = ${clinicaId} and status = 'concluida' and inicio >= ${de30.toISOString()}::timestamptz)::int as concluidas`,
      s<{ n: number }[]>`select count(*)::int as n from vinculos where clinica_id = ${clinicaId} and papel = 'paciente' and criado_em >= ${de30.toISOString()}::timestamptz`,
      s<{ credenciamentos: number; reembolsos: number; pacientes: number; lgpd: number }[]>`
        select
          (select count(*) from credenciamentos_medicos where clinica_id = ${clinicaId} and status = 'em_analise')::int as credenciamentos,
          (select count(distinct a.registro_id) from auditoria a join pagamentos p on p.id::text = a.registro_id
             where a.clinica_id = ${clinicaId} and a.acao = 'pagamento.pendente_de_estorno' and p.status = 'confirmado')::int as reembolsos,
          (select count(*) from consultas c where c.clinica_id = ${clinicaId} and c.status = 'concluida' and c.forma_de_cobranca = 'cartao_ao_final'
             and exists (select 1 from pagamentos p where p.consulta_id = c.id and p.status = 'recusado')
             and not exists (select 1 from pagamentos p where p.consulta_id = c.id and p.status in ('confirmado', 'autorizado')))::int as pacientes,
          (select count(*) from solicitacoes_titular where clinica_id = ${clinicaId} and status in ('aberta', 'em_andamento'))::int as lgpd`,
      equipeMedica(clinicaId),
    ]);

    const ativos = equipe.filter((m) => m.status === "ativo");
    const [ganhos30, saldoPorMedico, crm] = await Promise.all([
      ganhosPorMedico(banco, clinicaId, { de: de30, ate: agora }),
      saldos(clinicaId),
      banco.$client<{ n: number }[]>`
        select count(*)::int as n from (
          select distinct on (medico_id) medico_id, resultado, valido_ate from verificacoes_crm
          where clinica_id = ${clinicaId} order by medico_id, criado_em desc
        ) v where v.resultado = 'verificado' and v.valido_ate < now() + interval '30 days'`,
    ]);

    return {
      ok: true,
      dados: {
        plataforma: { nome: c!.nome, repassePadraoBps: c!.repasse, recebimentoConfigurado: await opcoes.resolvedor.temRecebimento(clinicaId) },
        hoje: { consultas: hoje!.total, concluidas: hoje!.concluidas, naFila: fila!.n, medicosOnline: online!.n },
        ultimos30dias: {
          receitaCentavos: Number(receita!.bruta),
          repasseCentavos: ganhos30.reduce((a, g) => a + g.repasseCentavos, 0),
          consultasConcluidas: receita!.concluidas,
          pacientesNovos: pacientesNovos!.n,
        },
        pendencias: {
          credenciamentos: pend!.credenciamentos,
          reembolsos: pend!.reembolsos,
          pagamentosDePacientes: pend!.pacientes,
          pedidosLgpd: pend!.lgpd,
          medicosSemPercentual: c!.repasse === null ? ativos.filter((m) => m.proprio === null).length : 0,
          crmVencendo: crm[0]?.n ?? 0,
        },
        saldoTotalARepassarCentavos: [...saldoPorMedico.values()].reduce((a, v) => a + Math.max(0, v), 0),
      },
    };
  });

  // --- configuracoes -------------------------------------------------------------

  app.get("/admin/configuracoes", { preHandler: soAdmin }, async (req) => {
    const [c] = await banco
      .select({
        nomeFantasia: clinicas.nomeFantasia, razaoSocial: clinicas.razaoSocial, cnpj: clinicas.cnpj, slug: clinicas.slug, status: clinicas.status,
        fusoHorario: clinicas.fusoHorario, responsavelTecnicoId: clinicas.responsavelTecnicoId, repassePadraoBps: clinicas.repassePadraoBps,
        retornoPrazoMaximoDias: clinicas.retornoPrazoMaximoDias,
      })
      .from(clinicas)
      .where(eq(clinicas.id, req.contexto.clinicaId))
      .limit(1);
    return { ok: true as const, dados: { ...c!, recebimentoConfigurado: await opcoes.resolvedor.temRecebimento(req.contexto.clinicaId) } };
  });

  /**
   * Mudar a porcentagem padrao NAO muda consulta ja marcada: cada uma guardou
   * a porcentagem do dia em que nasceu.
   */
  app.patch("/admin/configuracoes", { preHandler: soAdmin }, async (req) => {
    const dados = z
      .object({
        nomeFantasia: z.string().trim().min(3, "nome com ao menos 3 letras").max(80).optional(),
        razaoSocial: z.string().trim().min(3, "razão social com ao menos 3 letras").max(120).optional(),
        fusoHorario: z.string().trim().refine(fusoValido, "fuso horário desconhecido (use o nome IANA, ex.: America/Manaus)").optional(),
        /** Medico responsavel tecnico (Resolucao CFM 2.314/2022). */
        /** Troca-se por outro; nao se deixa a plataforma sem (Resolucao CFM 2.314/2022). */
        responsavelTecnicoId: z.string().uuid("responsável técnico inválido").optional(),
        repassePadraoBps: bps.nullable().optional(),
        /** ADR-0027: prazo de retorno SUGERIDO ao medico (quem decide e o medico, CFM 1.958/2010). */
        retornoPrazoMaximoDias: z.number().int("prazo em dias inteiros").min(1, "mínimo 1 dia").max(90, "máximo 90 dias").optional(),
      })
      .strict()
      .refine((d) => Object.keys(d).length > 0, "nada para alterar")
      .parse(req.body);

    if (dados.responsavelTecnicoId) {
      const [rt] = await banco
        .select({ id: vinculos.id })
        .from(vinculos)
        .where(and(eq(vinculos.perfilId, dados.responsavelTecnicoId), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico"), eq(vinculos.status, "ativo")))
        .limit(1);
      if (!rt) throw new ErroHttp(400, "RT_INVALIDO", "O responsável técnico precisa ser um médico ativo da plataforma.");
      const situacao = (await situacoesCrm(banco, req.contexto.clinicaId, [dados.responsavelTecnicoId])).get(dados.responsavelTecnicoId);
      if (situacao !== "verificado") throw new ErroHttp(400, "RT_SEM_CRM", "O CRM do responsável técnico precisa estar verificado.");
    }

    await banco.transaction(async (tx) => {
      const [antes] = await tx.select().from(clinicas).where(eq(clinicas.id, req.contexto.clinicaId)).for("update");
      await tx.update(clinicas).set({ ...dados, atualizadoEm: new Date() }).where(eq(clinicas.id, req.contexto.clinicaId));
      const de: Record<string, unknown> = {};
      for (const k of Object.keys(dados)) de[k] = (antes as Record<string, unknown>)[k];
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao:
          dados.repassePadraoBps !== undefined && Object.keys(dados).length === 1
            ? "repasse.percentual_padrao_alterado"
            : dados.retornoPrazoMaximoDias !== undefined && Object.keys(dados).length === 1
              ? "clinica.regras_de_retorno_alteradas"
              : "clinica.configuracoes_alteradas",
        tabela: "clinicas",
        registroId: req.contexto.clinicaId,
        detalhes: { de, para: dados },
        ip: req.ip,
      });
    });
    return { ok: true as const, dados: { salvo: true } };
  });

  // --- medicos ----------------------------------------------------------------

  app.get("/admin/medicos", { preHandler: soAdmin }, async (req): Promise<Resposta<MedicoNaAdministracao[]>> => {
    const clinicaId = req.contexto.clinicaId;
    const agora = new Date();
    const [equipe, [c], ganhos30, saldoPorMedico] = await Promise.all([
      equipeMedica(clinicaId),
      banco.select({ padrao: clinicas.repassePadraoBps }).from(clinicas).where(eq(clinicas.id, clinicaId)).limit(1),
      ganhosPorMedico(banco, clinicaId, { de: new Date(agora.getTime() - 30 * DIA), ate: agora }),
      saldos(clinicaId),
    ]);
    const situacoes = await situacoesCrm(banco, clinicaId, equipe.map((m) => m.id));
    return {
      ok: true,
      dados: equipe.map((m) => {
        const g = ganhos30.find((x) => x.medicoId === m.id);
        return {
          id: m.id,
          nomeCompleto: m.nomeCompleto,
          crm: m.crm,
          crmUf: m.crmUf,
          situacaoCrm: situacoes.get(m.id)!,
          especialidades: m.especialidades,
          atendeProntoAtendimento: m.atendeProntoAtendimento,
          online: m.online,
          status: m.status,
          percentualProprioBps: m.proprio,
          percentualEmVigorBps: m.proprio ?? c?.padrao ?? null,
          ultimos30dias: { consultas: g?.consultas ?? 0, faturadoCentavos: g?.faturadoCentavos ?? 0, repasseCentavos: g?.repasseCentavos ?? 0 },
          saldoCentavos: saldoPorMedico.get(m.id) ?? 0,
        };
      }),
    };
  });

  app.put("/admin/medicos/:id/percentual", { preHandler: soAdmin }, async (req): Promise<Resposta<{ percentualBps: number | null }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const { percentualBps } = z.object({ percentualBps: bps.nullable() }).strict().parse(req.body);

    const [m] = await banco
      .select({ id: vinculos.id })
      .from(vinculos)
      .where(and(eq(vinculos.perfilId, id), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico")))
      .limit(1);
    if (!m) throw new ErroHttp(404, "MEDICO_NAO_ENCONTRADO", "Médico não encontrado na plataforma.");

    await banco.transaction(async (tx) => {
      const [antes] = await tx
        .select({ bps: percentuaisMedicos.percentualBps })
        .from(percentuaisMedicos)
        .where(and(eq(percentuaisMedicos.clinicaId, req.contexto.clinicaId), eq(percentuaisMedicos.medicoId, id)))
        .for("update");
      if (percentualBps === null) {
        await tx.delete(percentuaisMedicos).where(and(eq(percentuaisMedicos.clinicaId, req.contexto.clinicaId), eq(percentuaisMedicos.medicoId, id)));
      } else {
        await tx
          .insert(percentuaisMedicos)
          .values({ clinicaId: req.contexto.clinicaId, medicoId: id, percentualBps, definidoPor: req.usuario.id })
          .onConflictDoUpdate({ target: [percentuaisMedicos.clinicaId, percentuaisMedicos.medicoId], set: { percentualBps, definidoPor: req.usuario.id, atualizadoEm: new Date() } });
      }
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "repasse.percentual_alterado",
        tabela: "percentuais_medicos",
        registroId: id,
        detalhes: { medico: id, de: antes?.bps ?? null, para: percentualBps },
        ip: req.ip,
      });
    });
    return { ok: true, dados: { percentualBps } };
  });

  // --- financeiro -------------------------------------------------------------

  app.get("/admin/financeiro", { preHandler: soAdmin }, async (req): Promise<Resposta<Financeiro>> => {
    const q = z
      .object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "de no formato AAAA-MM-DD").optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ate no formato AAAA-MM-DD").optional() })
      .parse(req.query);
    const clinicaId = req.contexto.clinicaId;
    // O periodo e em dias do FUSO da plataforma: "ate 31/10" inclui o dia 31 inteiro.
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: req.contexto.fusoHorario }).format(new Date());
    const diaDe = q.de ?? `${hoje.slice(0, 8)}01`;
    const diaAte = q.ate ?? hoje;
    if (diaAte < diaDe) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data final precisa ser depois da inicial.");
    const [limites] = await banco.$client<{ de: Date; ate: Date }[]>`
      select (${diaDe}::date::timestamp at time zone ${req.contexto.fusoHorario}) as de,
             ((${diaAte}::date + 1)::timestamp at time zone ${req.contexto.fusoHorario}) as ate`;
    const periodo = { de: new Date(limites!.de), ate: new Date(limites!.ate) };
    const ate = periodo.ate;
    if (ate.getTime() - periodo.de.getTime() > DIAS_MAXIMOS_DO_RELATORIO * DIA) {
      throw new ErroHttp(400, "PERIODO_GRANDE_DEMAIS", `Consulte no máximo ${DIAS_MAXIMOS_DO_RELATORIO} dias por vez.`);
    }

    const quem = alias(perfis, "quem_registrou");
    const quemCancelou = alias(perfis, "quem_cancelou");
    const nomeMedico = alias(perfis, "nome_medico");
    const [[totais], ganhos, saldoPorMedico, equipe, repasses, reembolsos, recusadas] = await Promise.all([
      banco.$client<{ bruta: number; estornado: number }[]>`
        select coalesce(sum(valor_centavos) filter (where status = 'confirmado' and confirmado_em >= ${periodo.de.toISOString()}::timestamptz and confirmado_em < ${ate.toISOString()}::timestamptz), 0)::bigint as bruta,
               coalesce(sum(valor_centavos) filter (where status = 'estornado' and estornado_em >= ${periodo.de.toISOString()}::timestamptz and estornado_em < ${ate.toISOString()}::timestamptz), 0)::bigint as estornado
        from pagamentos where clinica_id = ${clinicaId}`,
      ganhosPorMedico(banco, clinicaId, periodo),
      saldos(clinicaId),
      equipeMedica(clinicaId),
      banco
        .select({ r: repassesMedicos, medicoNome: nomeMedico.nomeCompleto, por: quem.nomeCompleto, cancelouNome: quemCancelou.nomeCompleto })
        .from(repassesMedicos)
        .innerJoin(nomeMedico, eq(nomeMedico.id, repassesMedicos.medicoId))
        .innerJoin(quem, eq(quem.id, repassesMedicos.registradoPor))
        .leftJoin(quemCancelou, eq(quemCancelou.id, repassesMedicos.canceladoPor))
        .where(and(eq(repassesMedicos.clinicaId, clinicaId), gte(repassesMedicos.pagoEm, periodo.de), lt(repassesMedicos.pagoEm, ate)))
        .orderBy(desc(repassesMedicos.pagoEm))
        .limit(300),
      banco.$client<{ pagamento_id: string; valor: number; metodo: string; motivo: string; paciente: string; desde: Date }[]>`
        select distinct on (p.id) p.id as pagamento_id, p.valor_centavos as valor, p.metodo, coalesce(a.detalhes->>'motivo', '') as motivo, pf.nome_completo as paciente, a.quando as desde
        from auditoria a
        join pagamentos p on p.id::text = a.registro_id
        join perfis pf on pf.id = p.pagador_id
        where a.clinica_id = ${clinicaId} and a.acao = 'pagamento.pendente_de_estorno' and p.status = 'confirmado'
        order by p.id, a.quando asc
        limit 200`,
      banco.$client<{ consulta_id: string; paciente: string; valor: number; inicio: Date }[]>`
        select c.id as consulta_id, pf.nome_completo as paciente, coalesce(c.valor_combinado_centavos, 0) as valor, c.inicio
        from consultas c join perfis pf on pf.id = c.paciente_id
        where c.clinica_id = ${clinicaId} and c.status = 'concluida' and c.forma_de_cobranca = 'cartao_ao_final'
          and exists (select 1 from pagamentos p where p.consulta_id = c.id and p.status = 'recusado')
          and not exists (select 1 from pagamentos p where p.consulta_id = c.id and p.status in ('confirmado', 'autorizado'))
        order by c.inicio desc
        limit 200`,
    ]);

    const nomes = new Map(equipe.map((m) => [m.id, m.nomeCompleto]));
    // Medicos com saldo aparecem mesmo sem consulta no periodo: e o que a administracao precisa pagar.
    const ids = new Set([...ganhos.map((g) => g.medicoId), ...[...saldoPorMedico].filter(([, v]) => v !== 0).map(([id]) => id)]);
    const porMedico = [...ids]
      .map((id) => {
        const g = ganhos.find((x) => x.medicoId === id);
        return { medicoId: id, medicoNome: nomes.get(id) ?? "Médico", consultas: g?.consultas ?? 0, faturadoCentavos: g?.faturadoCentavos ?? 0, repasseCentavos: g?.repasseCentavos ?? 0, saldoCentavos: saldoPorMedico.get(id) ?? 0 };
      })
      .sort((a, b) => b.saldoCentavos - a.saldoCentavos || a.medicoNome.localeCompare(b.medicoNome));

    const repasseDoPeriodo = ganhos.reduce((a, g) => a + g.repasseCentavos, 0);
    const bruta = Number(totais!.bruta);
    return {
      ok: true,
      dados: {
        periodo: { de: diaDe, ate: diaAte },
        receitaBrutaCentavos: bruta,
        estornadoCentavos: Number(totais!.estornado),
        repasseDoPeriodoCentavos: repasseDoPeriodo,
        margemCentavos: bruta - repasseDoPeriodo,
        porMedico,
        repasses: repasses.map(({ r, medicoNome, por, cancelouNome }) => ({
          id: r.id,
          medicoId: r.medicoId,
          medicoNome,
          valorCentavos: r.valorCentavos,
          pagoEm: r.pagoEm.toISOString(),
          referencia: r.referencia,
          observacao: r.observacao,
          registradoPor: por,
          cancelado: r.canceladoEm ? { em: r.canceladoEm.toISOString(), por: cancelouNome ?? "", motivo: r.motivoCancelamento ?? "" } : null,
        })),
        cobrancasRecusadas: recusadas.map((x) => ({ consultaId: x.consulta_id, pacienteNome: x.paciente, valorCentavos: Number(x.valor), realizadaEm: new Date(x.inicio).toISOString() })),
        reembolsosPendentes: reembolsos.map((x) => ({ pagamentoId: x.pagamento_id, valorCentavos: Number(x.valor), metodo: x.metodo, motivo: x.motivo, pacienteNome: x.paciente, desde: new Date(x.desde).toISOString() })),
      },
    };
  });

  /**
   * REGISTRAR UM REPASSE. O dinheiro sai por fora (Pix, TED) - aqui fica a
   * prova de que saiu. Nao se registra mais do que o saldo: um zero a mais
   * digitado por engano viraria "o medico deve a plataforma".
   */
  app.post("/admin/repasses", { preHandler: soAdmin }, async (req, reply) => {
    const dados = z
      .object({
        medicoId: z.string().uuid("médico inválido"),
        valorCentavos: z.number().int().min(1, "valor mínimo R$ 0,01").max(100_000_000),
        pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD"),
        referencia: z.string().trim().min(2, "diga como o valor foi enviado (ex.: Pix, TED)").max(120),
        observacao: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(req.body);

    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: req.contexto.fusoHorario }).format(new Date());
    if (dados.pagoEm > hoje) throw new ErroHttp(400, "DATA_FUTURA", "A data do pagamento não pode ser no futuro.");

    const criado = await banco.transaction(async (tx) => {
      // Dois registros ao mesmo tempo para o mesmo medico nao passam juntos do saldo.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`repasse:${req.contexto.clinicaId}:${dados.medicoId}`}))`);
      const [m] = await tx
        .select({ id: vinculos.id })
        .from(vinculos)
        .where(and(eq(vinculos.perfilId, dados.medicoId), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico")))
        .limit(1);
      if (!m) throw new ErroHttp(404, "MEDICO_NAO_ENCONTRADO", "Médico não encontrado na plataforma.");

      const [ganho] = await ganhosPorMedico(tx, req.contexto.clinicaId, undefined, dados.medicoId);
      const pago = (await pagoPorMedico(tx, req.contexto.clinicaId, dados.medicoId)).get(dados.medicoId) ?? 0;
      const saldo = (ganho?.repasseCentavos ?? 0) - pago;
      if (dados.valorCentavos > saldo) {
        throw new ErroHttp(409, "ACIMA_DO_SALDO", `O valor passa do saldo a repassar deste médico (${(Math.max(0, saldo) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Confira o valor.`);
      }

      const pagoEm = (await tx.execute<{ t: Date }>(sql`select (${dados.pagoEm}::date::timestamp + interval '12 hours') at time zone ${req.contexto.fusoHorario} as t`)) as unknown as { t: Date }[];
      const [r] = await tx
        .insert(repassesMedicos)
        .values({ clinicaId: req.contexto.clinicaId, medicoId: dados.medicoId, valorCentavos: dados.valorCentavos, pagoEm: new Date(pagoEm[0]!.t), referencia: dados.referencia, observacao: dados.observacao ?? null, registradoPor: req.usuario.id })
        .returning({ id: repassesMedicos.id });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "repasse.registrado",
        tabela: "repasses_medicos",
        registroId: r!.id,
        detalhes: { medico: dados.medicoId, valorCentavos: dados.valorCentavos, pagoEm: dados.pagoEm, saldoAntes: saldo },
        ip: req.ip,
      });
      return r!;
    });
    void reply.code(201);
    return { ok: true as const, dados: { id: criado.id } };
  });

  app.post("/admin/repasses/:id/cancelar", { preHandler: soAdmin }, async (req) => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().trim().min(5, "explique o motivo do cancelamento").max(300) }).strict().parse(req.body);
    const cancelados = await banco.transaction(async (tx) => {
      const linhas = await tx
        .update(repassesMedicos)
        .set({ canceladoEm: new Date(), canceladoPor: req.usuario.id, motivoCancelamento: motivo })
        .where(and(eq(repassesMedicos.id, id), eq(repassesMedicos.clinicaId, req.contexto.clinicaId), isNull(repassesMedicos.canceladoEm)))
        .returning({ id: repassesMedicos.id, medicoId: repassesMedicos.medicoId, valor: repassesMedicos.valorCentavos });
      if (linhas.length > 0) {
        await registrarAuditoria(tx, { quem: req.usuario.id, clinicaId: req.contexto.clinicaId, acao: "repasse.cancelado", tabela: "repasses_medicos", registroId: id, detalhes: { medico: linhas[0]!.medicoId, valorCentavos: linhas[0]!.valor, motivo }, ip: req.ip });
      }
      return linhas;
    });
    if (cancelados.length === 0) throw new ErroHttp(404, "REPASSE_NAO_ENCONTRADO", "Repasse não encontrado, ou já cancelado.");
    return { ok: true as const, dados: { cancelado: true } };
  });

  // --- auditoria ----------------------------------------------------------------

  /**
   * A trilha de quem fez o que. A administracao responde pela plataforma e
   * precisa ver as acoes - mas o `detalhes` NAO sai daqui: em alguns registros
   * ele cita o paciente de uma leitura de prontuario.
   */
  app.get("/admin/auditoria", { preHandler: soAdmin }, async (req): Promise<Resposta<{ eventos: EventoDeAuditoria[]; temMais: boolean }>> => {
    const q = z
      .object({
        grupo: z.enum(["todos", "financeiro", "medicos", "equipe", "configuracoes", "prontuario", "lgpd"]).default("todos"),
        antesDe: z.string().datetime({ offset: true }).optional(),
      })
      .parse(req.query);
    const prefixos: Record<string, string[]> = {
      financeiro: ["pagamento.", "repasse.", "precos.", "cartao."],
      medicos: ["credenciamento.", "identidade.", "crm.", "medico.", "plantao."],
      equipe: ["membro.", "convite."],
      configuracoes: ["clinica."],
      prontuario: ["prontuario.", "documento.", "evolucao."],
      lgpd: ["lgpd.", "perfil."],
    };
    const filtro = q.grupo === "todos" ? undefined : sql`(${sql.join(prefixos[q.grupo]!.map((p) => sql`${auditoria.acao} like ${`${p}%`}`), sql` or `)})`;
    const quem = alias(perfis, "autor");
    const POR_PAGINA = 100;
    const linhas = await banco
      .select({ id: auditoria.id, quando: auditoria.quando, acao: auditoria.acao, tabela: auditoria.tabela, registroId: auditoria.registroId, quem: quem.nomeCompleto })
      .from(auditoria)
      .leftJoin(quem, eq(quem.id, auditoria.quem))
      .where(and(eq(auditoria.clinicaId, req.contexto.clinicaId), filtro, q.antesDe ? lt(auditoria.quando, new Date(q.antesDe)) : undefined))
      .orderBy(desc(auditoria.quando))
      .limit(POR_PAGINA + 1);
    return {
      ok: true,
      dados: {
        temMais: linhas.length > POR_PAGINA,
        eventos: linhas.slice(0, POR_PAGINA).map((l) => ({
          id: String(l.id),
          quando: l.quando.toISOString(),
          acao: l.acao,
          descricao: NOME_DA_ACAO[l.acao] ?? l.acao,
          quem: l.quem ?? (l.acao.startsWith("pagamento.") || l.acao.startsWith("identidade.") ? "Sistema" : null),
          tabela: l.tabela,
          registroId: l.registroId,
        })),
      },
    };
  });

  // --- o medico ---------------------------------------------------------------

  app.get("/meus-ganhos", { preHandler: [...dentroDaClinica, exigirPapel("medico")] }, async (req): Promise<Resposta<MeusGanhos>> => {
    const clinicaId = req.contexto.clinicaId;
    const eu = req.usuario.id;
    const inicioDoMes = (await banco.$client<{ t: Date }[]>`select date_trunc('month', now() at time zone ${req.contexto.fusoHorario}) at time zone ${req.contexto.fusoHorario} as t`)[0]!.t;
    const [percentual, [doMes], saldo, repasses] = await Promise.all([
      percentualDoMedico(banco, clinicaId, eu),
      ganhosPorMedico(banco, clinicaId, { de: new Date(inicioDoMes), ate: new Date(Date.now() + DIA) }, eu),
      saldoDoMedico(banco, clinicaId, eu),
      banco
        .select()
        .from(repassesMedicos)
        .where(and(eq(repassesMedicos.clinicaId, clinicaId), eq(repassesMedicos.medicoId, eu)))
        .orderBy(desc(repassesMedicos.pagoEm))
        .limit(50),
    ]);
    return {
      ok: true,
      dados: {
        percentualEmVigorBps: percentual,
        doMes: { consultas: doMes?.consultas ?? 0, faturadoCentavos: doMes?.faturadoCentavos ?? 0, repasseCentavos: doMes?.repasseCentavos ?? 0 },
        ganhoTotalCentavos: saldo.ganhoCentavos,
        pagoCentavos: saldo.pagoCentavos,
        saldoCentavos: saldo.saldoCentavos,
        repasses: repasses.map((r) => ({
          id: r.id,
          valorCentavos: r.valorCentavos,
          pagoEm: r.pagoEm.toISOString(),
          referencia: r.referencia,
          observacao: r.observacao,
          cancelado: r.canceladoEm ? { em: r.canceladoEm.toISOString(), por: "administração", motivo: r.motivoCancelamento ?? "" } : null,
        })),
      },
    };
  });
}
