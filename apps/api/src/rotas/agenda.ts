/**
 * =====================================================================
 * ROTAS DA AGENDA
 * =====================================================================
 *
 *   GET  /disponibilidades?medicoId=  grade semanal (a minha, ou a de um medico)
 *   PUT  /disponibilidades            o medico redefine a propria grade
 *   POST /bloqueios                   "nao atendo neste periodo"
 *   GET  /bloqueios
 *   GET  /horarios?medicoId=&data=    os horarios livres daquele dia
 *   POST /consultas                   marcar (paciente para si, ou equipe)
 *   GET  /consultas?de=&ate=          minha agenda no periodo
 *   POST /consultas/:id/cancelar
 *   POST /consultas/:id/status        iniciar / concluir (medico)
 *
 * Tudo dentro de uma clinica: exige login + cabecalho X-Clinica.
 */
import { randomUUID } from "node:crypto";
import { and, asc, between, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bloqueios, consultas, disponibilidades, medicos, perfis, precos, vinculos, type Banco } from "@tele/db";
import {
  type BlocoDaGrade,
  type ConsultaResumo,
  type DisponibilidadeResumo,
  type HorarioLivre,
  type Resposta,
} from "@tele/shared";
import { calcularHorariosLivres } from "@tele/shared/agenda";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";
import { MINUTOS_DE_RESERVA } from "./pagamentos.js";

/** Quanto tempo antes do horario ainda da para marcar. */
const ANTECEDENCIA_MINUTOS = 30;
/** Ate quantos dias no futuro a agenda pode ser consultada de uma vez. */
const JANELA_MAXIMA_DIAS = 90;

/** Exportados para os testes: validam a entrada sem precisar de banco. */
export const esquemaGrade = z.object({
  blocos: z
    .array(
      z.object({
        diaSemana: z.number().int().min(0, "diaSemana vai de 0 (domingo) a 6").max(6, "diaSemana vai de 0 (domingo) a 6"),
        horaInicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horaInicio no formato HH:MM"),
        horaFim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horaFim no formato HH:MM"),
        duracaoMinutos: z.number().int().min(10, "consulta minima de 10 minutos").max(120, "consulta maxima de 120 minutos"),
      }),
    )
    .max(40, "grade demais para um so medico"),
});

export const esquemaBloqueio = z.object({
  inicio: z.string().datetime({ offset: true }),
  fim: z.string().datetime({ offset: true }),
  motivo: z.string().trim().max(120).optional(),
});

export const esquemaMarcar = z.object({
  medicoId: z.string().uuid("medicoId invalido"),
  /** Quando a recepcao marca por alguem. Ausente = para mim mesmo. */
  pacienteId: z.string().uuid("pacienteId invalido").optional(),
  inicio: z.string().datetime({ offset: true }),
  motivo: z.string().trim().max(500).optional(),
});

export const esquemaCancelar = z.object({ motivo: z.string().trim().min(3, "diga o motivo do cancelamento").max(300) });

export async function rotasAgenda(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];

  // --- grade semanal --------------------------------------------------------

  app.get("/disponibilidades", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<DisponibilidadeResumo[]>> => {
    const { medicoId } = z.object({ medicoId: z.string().uuid().optional() }).parse(req.query);
    const alvo = medicoId ?? req.usuario.id;

    const linhas = await banco
      .select({
        id: disponibilidades.id,
        diaSemana: disponibilidades.diaSemana,
        horaInicio: disponibilidades.horaInicio,
        horaFim: disponibilidades.horaFim,
        duracaoMinutos: disponibilidades.duracaoMinutos,
      })
      .from(disponibilidades)
      .where(and(eq(disponibilidades.clinicaId, req.contexto.clinicaId), eq(disponibilidades.medicoId, alvo)))
      .orderBy(asc(disponibilidades.diaSemana), asc(disponibilidades.horaInicio));

    return { ok: true, dados: linhas.map((l) => ({ ...l, horaInicio: l.horaInicio.slice(0, 5), horaFim: l.horaFim.slice(0, 5) })) };
  });

  /**
   * A grade e substituida por inteiro, nao remendada: e mais simples de
   * entender ("esta e a minha semana") e evita o estado intermediario em
   * que dois blocos se sobrepoem no meio de uma edicao.
   */
  app.put("/disponibilidades", { preHandler: soMedico }, async (req): Promise<Resposta<{ blocos: number }>> => {
    const { blocos } = esquemaGrade.parse(req.body);

    for (const b of blocos) {
      if (b.horaFim <= b.horaInicio) throw new ErroHttp(400, "BLOCO_INVALIDO", `No dia ${b.diaSemana}, o fim (${b.horaFim}) precisa ser depois do inicio (${b.horaInicio}).`);
    }

    try {
      await banco.transaction(async (tx) => {
        await tx.delete(disponibilidades).where(and(eq(disponibilidades.clinicaId, req.contexto.clinicaId), eq(disponibilidades.medicoId, req.usuario.id)));
        if (blocos.length > 0) {
          await tx.insert(disponibilidades).values(
            blocos.map((b) => ({
              medicoId: req.usuario.id,
              clinicaId: req.contexto.clinicaId,
              diaSemana: b.diaSemana,
              horaInicio: `${b.horaInicio}:00`,
              horaFim: `${b.horaFim}:00`,
              duracaoMinutos: b.duracaoMinutos,
            })),
          );
        }
        await registrarAuditoria(tx, {
          quem: req.usuario.id,
          clinicaId: req.contexto.clinicaId,
          acao: "agenda.grade_alterada",
          tabela: "disponibilidades",
          registroId: req.usuario.id,
          detalhes: { blocos: blocos.length },
          ip: req.ip,
        });
      });
    } catch (erro) {
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      if (codigo === "23P01") throw new ErroHttp(409, "BLOCOS_SE_SOBREPOEM", "Dois blocos do mesmo dia se sobrepoem. Ajuste os horarios.");
      if (codigo === "23505") throw new ErroHttp(409, "BLOCO_REPETIDO", "Ha dois blocos comecando no mesmo horario, no mesmo dia.");
      throw erro;
    }

    return { ok: true, dados: { blocos: blocos.length } };
  });

  // --- bloqueios ------------------------------------------------------------

  app.get("/bloqueios", { preHandler: [...dentroDaClinica, exigirPapel("medico", "recepcao", "admin_clinica")] }, async (req): Promise<Resposta<{ id: string; inicio: string; fim: string; motivo: string | null; medicoId: string }[]>> => {
    const linhas = await banco
      .select({ id: bloqueios.id, inicio: bloqueios.inicio, fim: bloqueios.fim, motivo: bloqueios.motivo, medicoId: bloqueios.medicoId })
      .from(bloqueios)
      .where(and(eq(bloqueios.clinicaId, req.contexto.clinicaId), gte(bloqueios.fim, new Date())))
      .orderBy(asc(bloqueios.inicio));
    return { ok: true, dados: linhas.map((l) => ({ ...l, inicio: l.inicio.toISOString(), fim: l.fim.toISOString() })) };
  });

  app.post("/bloqueios", { preHandler: soMedico }, async (req, reply): Promise<Resposta<{ id: string }>> => {
    const dados = esquemaBloqueio.parse(req.body);
    const inicio = new Date(dados.inicio);
    const fim = new Date(dados.fim);
    if (fim <= inicio) throw new ErroHttp(400, "PERIODO_INVALIDO", "O fim do bloqueio precisa ser depois do inicio.");

    // Bloquear por cima de consulta ja marcada seria dar um problema por
    // resolvido: avisamos quais precisam ser remarcadas antes.
    const conflitos = await banco
      .select({ id: consultas.id, inicio: consultas.inicio })
      .from(consultas)
      .where(
        and(
          eq(consultas.medicoId, req.usuario.id),
          eq(consultas.clinicaId, req.contexto.clinicaId),
          inArray(consultas.status, ["agendada", "em_andamento"]),
          lte(consultas.inicio, fim),
          gte(consultas.fim, inicio),
        ),
      );
    if (conflitos.length > 0) {
      throw new ErroHttp(409, "CONSULTAS_NO_PERIODO", `Ha ${conflitos.length} consulta(s) marcada(s) nesse periodo. Cancele ou remarque antes de bloquear.`, {
        consultas: conflitos.map((c) => ({ id: c.id, inicio: c.inicio.toISOString() })),
      });
    }

    const id = randomUUID();
    await banco.transaction(async (tx) => {
      await tx.insert(bloqueios).values({ id, medicoId: req.usuario.id, clinicaId: req.contexto.clinicaId, inicio, fim, motivo: dados.motivo ?? null });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "agenda.bloqueio_criado",
        tabela: "bloqueios",
        registroId: id,
        detalhes: { inicio: dados.inicio, fim: dados.fim },
        ip: req.ip,
      });
    });

    void reply.code(201);
    return { ok: true, dados: { id } };
  });

  // --- horarios livres ------------------------------------------------------

  app.get("/horarios", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<HorarioLivre[]>> => {
    const { medicoId, data } = z
      .object({ medicoId: z.string().uuid("medicoId invalido"), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD") })
      .parse(req.query);

    // O medico precisa atender NESTA clinica - senao a agenda de outra vazaria.
    const [atende] = await banco
      .select({ id: vinculos.id })
      .from(vinculos)
      .where(and(eq(vinculos.perfilId, medicoId), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico"), eq(vinculos.status, "ativo")))
      .limit(1);
    if (!atende) throw new ErroHttp(404, "MEDICO_NAO_ATENDE_AQUI", "Este medico nao atende nesta clinica.");

    const grade = await banco
      .select({
        diaSemana: disponibilidades.diaSemana,
        horaInicio: disponibilidades.horaInicio,
        horaFim: disponibilidades.horaFim,
        duracaoMinutos: disponibilidades.duracaoMinutos,
      })
      .from(disponibilidades)
      .where(and(eq(disponibilidades.medicoId, medicoId), eq(disponibilidades.clinicaId, req.contexto.clinicaId)));

    // Janela generosa: pega tudo do dia pedido, com folga para os dois lados.
    const de = new Date(`${data}T00:00:00Z`);
    const ate = new Date(de.getTime() + 48 * 3600 * 1000);
    const antes = new Date(de.getTime() - 24 * 3600 * 1000);

    // Ocupado = consultas do medico em QUALQUER clinica (ele e um so) +
    // bloqueios dele nesta.
    const marcadas = await banco
      .select({ inicio: consultas.inicio, fim: consultas.fim })
      .from(consultas)
      .where(
        and(
          eq(consultas.medicoId, medicoId),
          // Reserva vencida nao ocupa horario: o paciente nao pagou a tempo.
          or(
            inArray(consultas.status, ["agendada", "em_andamento"]),
            and(eq(consultas.status, "aguardando_pagamento"), gte(consultas.expiraReservaEm, new Date())),
          ),
          between(consultas.inicio, antes, ate),
        ),
      );

    const fora = await banco
      .select({ inicio: bloqueios.inicio, fim: bloqueios.fim })
      .from(bloqueios)
      .where(and(eq(bloqueios.medicoId, medicoId), lte(bloqueios.inicio, ate), gte(bloqueios.fim, antes)));

    const livres = calcularHorariosLivres({
      data,
      fuso: req.contexto.fusoHorario,
      grade: grade.map((g) => ({ ...g, horaInicio: g.horaInicio, horaFim: g.horaFim })) as BlocoDaGrade[],
      ocupado: [...marcadas, ...fora].map((p) => ({ inicio: p.inicio.toISOString(), fim: p.fim.toISOString() })),
      antecedenciaMinutos: ANTECEDENCIA_MINUTOS,
    });

    return { ok: true, dados: livres };
  });

  // --- consultas ------------------------------------------------------------

  app.post("/consultas", { preHandler: dentroDaClinica }, async (req, reply): Promise<Resposta<ConsultaResumo>> => {
    const dados = esquemaMarcar.parse(req.body);
    const souEquipe = ["recepcao", "admin_clinica"].includes(req.contexto.papel);
    const pacienteId = dados.pacienteId ?? req.usuario.id;

    if (pacienteId !== req.usuario.id && !souEquipe) {
      throw new ErroHttp(403, "SO_PARA_SI", "Voce so pode marcar consulta para voce. A recepcao marca em nome de outros.");
    }

    // Os dois lados precisam ter vinculo ativo aqui (o RLS repetiria a
    // conferencia; fazemos antes para responder com mensagem util).
    const envolvidos = await banco
      .select({ perfilId: vinculos.perfilId, papel: vinculos.papel })
      .from(vinculos)
      .where(
        and(
          eq(vinculos.clinicaId, req.contexto.clinicaId),
          eq(vinculos.status, "ativo"),
          or(and(eq(vinculos.perfilId, pacienteId), eq(vinculos.papel, "paciente")), and(eq(vinculos.perfilId, dados.medicoId), eq(vinculos.papel, "medico"))),
        ),
      );
    if (!envolvidos.some((v) => v.perfilId === pacienteId)) throw new ErroHttp(400, "PACIENTE_SEM_VINCULO", "Este paciente nao esta cadastrado nesta clinica.");
    if (!envolvidos.some((v) => v.perfilId === dados.medicoId)) throw new ErroHttp(400, "MEDICO_NAO_ATENDE_AQUI", "Este medico nao atende nesta clinica.");

    // O horario pedido tem de ser um dos que a agenda oferece: assim ninguem
    // marca "09:07" mandando JSON na mao, nem fura a grade do medico.
    const inicio = new Date(dados.inicio);
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: req.contexto.fusoHorario }).format(inicio);
    const resposta = await app.inject({
      method: "GET",
      url: `/horarios?medicoId=${dados.medicoId}&data=${dia}`,
      headers: { authorization: req.headers.authorization ?? "", "x-clinica": req.contexto.slug },
    });
    const livres = (resposta.json() as Resposta<HorarioLivre[]>).ok ? (resposta.json() as { dados: HorarioLivre[] }).dados : [];
    const escolhido = livres.find((h) => new Date(h.inicio).getTime() === inicio.getTime());
    if (!escolhido) throw new ErroHttp(409, "HORARIO_INDISPONIVEL", "Este horario nao esta mais disponivel. Recarregue a agenda e escolha outro.");

    // A clinica cobra por consulta? Entao o horario nasce RESERVADO, nao
    // agendado: ele fica preso enquanto o paciente paga, e o pagamento e
    // que confirma (Modulo 10). Clinica sem preco definido continua
    // agendando direto - e o caso de quem cobra fora da plataforma.
    const [temPreco] = await banco
      .select({ id: precos.id })
      .from(precos)
      .where(and(eq(precos.clinicaId, req.contexto.clinicaId), eq(precos.tipo, "agendada")))
      .limit(1);

    const id = randomUUID();
    try {
      await banco.transaction(async (tx) => {
        await tx.insert(consultas).values({
          id,
          clinicaId: req.contexto.clinicaId,
          pacienteId,
          medicoId: dados.medicoId,
          inicio,
          fim: new Date(escolhido.fim),
          motivo: dados.motivo ?? null,
          marcadoPor: req.usuario.id,
          ...(temPreco
            ? { status: "aguardando_pagamento" as const, expiraReservaEm: new Date(Date.now() + MINUTOS_DE_RESERVA * 60000) }
            : {}),
        });
        await registrarAuditoria(tx, {
          quem: req.usuario.id,
          clinicaId: req.contexto.clinicaId,
          acao: "consulta.marcada",
          tabela: "consultas",
          registroId: id,
          detalhes: { medicoId: dados.medicoId, pacienteId, inicio: dados.inicio, porEquipe: pacienteId !== req.usuario.id },
          ip: req.ip,
        });
      });
    } catch (erro) {
      // A trava do banco: alguem marcou o mesmo horario no intervalo entre
      // a conferencia acima e esta gravacao.
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      const detalhe = String((erro as { cause?: { constraint?: string } }).cause?.constraint ?? "");
      if (codigo === "23P01") {
        if (detalhe.includes("paciente")) throw new ErroHttp(409, "PACIENTE_JA_TEM_CONSULTA", "Voce ja tem outra consulta neste horario.");
        throw new ErroHttp(409, "HORARIO_INDISPONIVEL", "Este horario acabou de ser ocupado. Escolha outro.");
      }
      throw erro;
    }

    const [criada] = await consultasPorId(banco, [id]);
    void reply.code(201);
    return { ok: true, dados: criada! };
  });

  app.get("/consultas", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<ConsultaResumo[]>> => {
    const { de, ate } = z
      .object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(req.query);

    const inicio = de ? new Date(`${de}T00:00:00Z`) : new Date(Date.now() - 24 * 3600 * 1000);
    const fim = ate ? new Date(`${ate}T23:59:59Z`) : new Date(inicio.getTime() + 30 * 24 * 3600 * 1000);
    if (fim.getTime() - inicio.getTime() > JANELA_MAXIMA_DIAS * 24 * 3600 * 1000) {
      throw new ErroHttp(400, "JANELA_GRANDE_DEMAIS", `Peca no maximo ${JANELA_MAXIMA_DIAS} dias por vez.`);
    }

    // O RLS ja limita ao que a pessoa pode ver; o filtro por clinica aqui
    // e o que permite ao Postgres usar o indice.
    const linhas = await banco
      .select(colunasDaConsulta())
      .from(consultas)
      .innerJoin(perfis, eq(perfis.id, consultas.pacienteId))
      .innerJoin(medicos, eq(medicos.perfilId, consultas.medicoId))
      .where(and(eq(consultas.clinicaId, req.contexto.clinicaId), between(consultas.inicio, inicio, fim)))
      .orderBy(asc(consultas.inicio));

    return { ok: true, dados: linhas.map(formatarConsulta) };
  });

  app.post("/consultas/:id/cancelar", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<ConsultaResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const { motivo } = esquemaCancelar.parse(req.body);

    const [consulta] = await banco.select({ status: consultas.status, inicio: consultas.inicio, pacienteId: consultas.pacienteId, medicoId: consultas.medicoId }).from(consultas).where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId))).limit(1);
    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta nao encontrada nesta clinica.");
    if (consulta.status === "cancelada") throw new ErroHttp(409, "JA_CANCELADA", "Esta consulta ja estava cancelada.");
    if (consulta.status === "concluida") throw new ErroHttp(409, "JA_CONCLUIDA", "Consulta concluida nao se cancela - ela aconteceu.");

    const envolvido = consulta.pacienteId === req.usuario.id || consulta.medicoId === req.usuario.id;
    if (!envolvido && !["recepcao", "admin_clinica"].includes(req.contexto.papel)) {
      throw new ErroHttp(403, "NAO_ENVOLVIDO", "So o paciente, o medico ou a recepcao cancelam esta consulta.");
    }

    await banco.transaction(async (tx) => {
      await tx.update(consultas).set({ status: "cancelada", canceladoEm: new Date(), canceladoPor: req.usuario.id, motivoCancelamento: motivo, atualizadoEm: new Date() }).where(eq(consultas.id, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "consulta.cancelada",
        tabela: "consultas",
        registroId: id,
        detalhes: { motivo, horasDeAntecedencia: Math.round((consulta.inicio.getTime() - Date.now()) / 3600000) },
        ip: req.ip,
      });
    });

    const [atualizada] = await consultasPorId(banco, [id]);
    return { ok: true, dados: atualizada! };
  });

  app.post("/consultas/:id/status", { preHandler: soMedico }, async (req): Promise<Resposta<ConsultaResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const { status } = z.object({ status: z.enum(["em_andamento", "concluida"], { message: "status deve ser em_andamento ou concluida" }) }).parse(req.body);

    const [consulta] = await banco.select({ status: consultas.status, medicoId: consultas.medicoId }).from(consultas).where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId))).limit(1);
    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta nao encontrada nesta clinica.");
    if (consulta.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU_ATENDIMENTO", "So o medico da consulta muda o andamento dela.");

    // agendada -> em_andamento -> concluida. Sem pular etapa e sem voltar.
    const permitido: Record<string, string[]> = { agendada: ["em_andamento"], em_andamento: ["concluida"], concluida: [], cancelada: [] };
    if (!permitido[consulta.status]?.includes(status)) {
      throw new ErroHttp(409, "TRANSICAO_INVALIDA", `Nao da para ir de "${consulta.status}" para "${status}".`);
    }

    await banco.transaction(async (tx) => {
      await tx.update(consultas).set({ status, atualizadoEm: new Date() }).where(eq(consultas.id, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: status === "concluida" ? "consulta.concluida" : "consulta.iniciada",
        tabela: "consultas",
        registroId: id,
        ip: req.ip,
      });
    });

    const [atualizada] = await consultasPorId(banco, [id]);
    return { ok: true, dados: atualizada! };
  });

  // --- apoio ----------------------------------------------------------------

  function colunasDaConsulta() {
    return {
      id: consultas.id,
      inicio: consultas.inicio,
      fim: consultas.fim,
      status: consultas.status,
      motivo: consultas.motivo,
      pacienteId: consultas.pacienteId,
      pacienteNome: perfis.nomeCompleto,
      medicoId: consultas.medicoId,
      crm: medicos.crm,
      crmUf: medicos.crmUf,
      motivoCancelamento: consultas.motivoCancelamento,
    };
  }

  async function consultasPorId(b: Banco, ids: string[]) {
    const linhas = await b.select(colunasDaConsulta()).from(consultas).innerJoin(perfis, eq(perfis.id, consultas.pacienteId)).innerJoin(medicos, eq(medicos.perfilId, consultas.medicoId)).where(inArray(consultas.id, ids));
    return linhas.map(formatarConsulta);
  }
}

function formatarConsulta(l: {
  id: string; inicio: Date; fim: Date; status: string; motivo: string | null;
  pacienteId: string; pacienteNome: string; medicoId: string; crm: string; crmUf: string; motivoCancelamento: string | null;
}): ConsultaResumo {
  return {
    id: l.id,
    inicio: l.inicio.toISOString(),
    fim: l.fim.toISOString(),
    status: l.status as ConsultaResumo["status"],
    motivo: l.motivo,
    paciente: { id: l.pacienteId, nomeCompleto: l.pacienteNome },
    medico: { id: l.medicoId, crm: l.crm, crmUf: l.crmUf },
    motivoCancelamento: l.motivoCancelamento,
  };
}

// `sql` fica importado para uso futuro em filtros mais complexos da agenda.
void sql;
