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
 *   (retorno, falta e avaliacao: rotas/retorno.ts - ADR-0027)
 *
 * Tudo dentro de uma clinica: exige login + cabecalho X-Clinica.
 */
import { randomUUID } from "node:crypto";
import { and, asc, between, eq, gte, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bloqueios, consultas, disponibilidades, filaAtendimento, medicos, pagamentos, perfis, precos, vinculos, type Banco } from "@tele/db";
import {
  type BlocoDaGrade,
  type ConsultaResumo,
  type DisponibilidadeResumo,
  type HorarioLivre,
  type Resposta,
} from "@tele/shared";
import { calcularHorariosLivres } from "@tele/shared/agenda";
import { especialidadeExiste, medicoAtende } from "@tele/shared/atendimento";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { exigirCrmVerificado } from "../crm.js";
import { fusoDaClinica, notificar, quandoNaClinica } from "../notificacoes/index.js";
import { ErroHttp } from "../erros.js";
import { cartaoAtivo, exigirSemPendencia, precoPara } from "../cobranca.js";
import { percentualDoMedico } from "../repasse.js";
import { exigirSemRestricao } from "../restricoes.js";
import type { ResolvedorDePagamento } from "../pagamento/index.js";
import { liberarReservasVencidas, registrarPendenciaDeEstorno } from "../reservas.js";
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
    .max(40, "grade demais para um só médico"),
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
  /** ADR-0024: pronto atendimento (clinico geral) ou teleconsulta (especialista). */
  linha: z.enum(["pronto_atendimento", "teleconsulta"]).default("teleconsulta"),
  especialidade: z.string().refine(especialidadeExiste, "especialidade desconhecida").optional(),
  /** ADR-0023: "pix" para pagar antes mesmo tendo cartao; "cartao" para exigir o cartao cadastrado. */
  cobranca: z.enum(["cartao", "pix"]).optional(),
  /** ADR-0027: marcar o RETORNO SEM CUSTO desta consulta (mesmo medico, dentro do prazo). */
  retornoDe: z.string().uuid("retornoDe invalido").optional(),
});

export const esquemaCancelar = z.object({ motivo: z.string().trim().min(3, "diga o motivo do cancelamento").max(300) });

export async function rotasAgenda(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; producao: boolean; resolvedor: ResolvedorDePagamento; /** ADR-0023: dispara a cobranca no cartao cadastrado. */ aoConcluir?: (consultaId: string) => void },
): Promise<void> {
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
      if (b.horaFim <= b.horaInicio) throw new ErroHttp(400, "BLOCO_INVALIDO", `No dia ${b.diaSemana}, o fim (${b.horaFim}) precisa ser depois do início (${b.horaInicio}).`);
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
      if (codigo === "23P01") throw new ErroHttp(409, "BLOCOS_SE_SOBREPOEM", "Dois blocos do mesmo dia se sobrepoem. Ajuste os horários.");
      if (codigo === "23505") throw new ErroHttp(409, "BLOCO_REPETIDO", "Ha dois blocos comecando no mesmo horário, no mesmo dia.");
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
    if (fim <= inicio) throw new ErroHttp(400, "PERIODO_INVALIDO", "O fim do bloqueio precisa ser depois do início.");

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
      throw new ErroHttp(409, "CONSULTAS_NO_PERIODO", `Ha ${conflitos.length} consulta(s) marcada(s) nesse período. Cancele ou remarque antes de bloquear.`, {
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
      .object({ medicoId: z.string().uuid("medicoId inválido"), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD") })
      .parse(req.query);

    // O medico precisa atender NESTA clinica - senao a agenda de outra vazaria.
    const [atende] = await banco
      .select({ id: vinculos.id })
      .from(vinculos)
      .where(and(eq(vinculos.perfilId, medicoId), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico"), eq(vinculos.status, "ativo")))
      .limit(1);
    if (!atende) throw new ErroHttp(404, "MEDICO_NAO_ATENDE_AQUI", "Este médico não atende nesta clínica.");
    // ADR-0016: medico com CRM nao conferido nao recebe marcacao.
    await exigirCrmVerificado(banco, req.contexto.clinicaId, medicoId, "terceiro");

    return { ok: true, dados: await horariosLivres(req.contexto.clinicaId, req.contexto.fusoHorario, medicoId, data) };
  });

  /** Os horarios livres de um medico num dia, ja descontado o que esta ocupado. */
  async function horariosLivres(clinicaId: string, fuso: string, medicoId: string, data: string): Promise<HorarioLivre[]> {
    const grade = await banco
      .select({
        diaSemana: disponibilidades.diaSemana,
        horaInicio: disponibilidades.horaInicio,
        horaFim: disponibilidades.horaFim,
        duracaoMinutos: disponibilidades.duracaoMinutos,
      })
      .from(disponibilidades)
      .where(and(eq(disponibilidades.medicoId, medicoId), eq(disponibilidades.clinicaId, clinicaId)));

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

    return calcularHorariosLivres({
      data,
      fuso,
      grade: grade.map((g) => ({ ...g, horaInicio: g.horaInicio, horaFim: g.horaFim })) as BlocoDaGrade[],
      ocupado: [...marcadas, ...fora].map((p) => ({ inicio: p.inicio.toISOString(), fim: p.fim.toISOString() })),
      antecedenciaMinutos: ANTECEDENCIA_MINUTOS,
    });
  }

  /**
   * O motivo da consulta e informacao de saude: so o medico e o paciente daquela
   * consulta o veem (LGPD, art. 6, III). Compara com a PESSOA, e nao com o papel:
   * a medica dona do consultorio tambem e administracao, e continua vendo os
   * motivos das proprias consultas, mas nao os dos colegas.
   */
  function paraQuemPede(c: ConsultaResumo, usuarioId: string): ConsultaResumo {
    // ADR-0027: a nota individual e so do paciente (evita retaliacao); o medico ve o agregado.
    const comNota = c.paciente.id === usuarioId ? c : { ...c, notaDaAvaliacao: null };
    return c.paciente.id === usuarioId || c.medico.id === usuarioId ? comNota : { ...comNota, motivo: null };
  }

  // --- consultas ------------------------------------------------------------

  app.post("/consultas", { preHandler: dentroDaClinica }, async (req, reply): Promise<Resposta<ConsultaResumo>> => {
    const dados = esquemaMarcar.parse(req.body);
    await exigirCrmVerificado(banco, req.contexto.clinicaId, dados.medicoId, "terceiro");
    const souEquipe = ["recepcao", "admin_clinica"].includes(req.contexto.papel);
    const pacienteId = dados.pacienteId ?? req.usuario.id;

    if (pacienteId !== req.usuario.id && !souEquipe) {
      throw new ErroHttp(403, "SO_PARA_SI", "Você só pode marcar consulta para você. A recepção marca em nome de outros.");
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
    if (!envolvidos.some((v) => v.perfilId === pacienteId)) throw new ErroHttp(400, "PACIENTE_SEM_VINCULO", "Este paciente não está cadastrado nesta clínica.");
    if (!envolvidos.some((v) => v.perfilId === dados.medicoId)) throw new ErroHttp(400, "MEDICO_NAO_ATENDE_AQUI", "Este médico não atende nesta clínica.");
    // ADR-0027: paciente impedido pela administracao nao marca (nem o retorno).
    await exigirSemRestricao(banco, req.contexto.clinicaId, pacienteId);

    /**
     * ADR-0027 - RETORNO SEM CUSTO (Resolucao CFM 1.958/2010). E a continuacao
     * da consulta original: mesmo paciente, mesmo medico, mesma linha, dentro
     * do prazo que o medico liberou. Nao e cobrado e nao gera repasse.
     */
    let retorno: { id: string; ate: Date } | null = null;
    if (dados.retornoDe) {
      const [original] = await banco
        .select({ id: consultas.id, pacienteId: consultas.pacienteId, medicoId: consultas.medicoId, status: consultas.status, retornoAte: consultas.retornoAte, retornoDe: consultas.retornoDe, linha: consultas.linha, especialidade: consultas.especialidade })
        .from(consultas)
        .where(and(eq(consultas.id, dados.retornoDe), eq(consultas.clinicaId, req.contexto.clinicaId)))
        .limit(1);
      if (!original || original.pacienteId !== pacienteId) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta original não encontrada.");
      if (original.status !== "concluida" || original.retornoDe || !original.retornoAte) throw new ErroHttp(409, "SEM_RETORNO", "Esta consulta não tem retorno sem custo liberado pelo médico.");
      if (original.medicoId !== dados.medicoId) throw new ErroHttp(409, "RETORNO_E_COM_O_MESMO_MEDICO", "O retorno é com o mesmo médico da consulta.");
      if (new Date(dados.inicio) > original.retornoAte) throw new ErroHttp(409, "RETORNO_FORA_DO_PRAZO", "Este horário passa do prazo do retorno sem custo. Escolha uma data até o fim do prazo.");
      retorno = { id: original.id, ate: original.retornoAte };
      dados.linha = original.linha;
      dados.especialidade = original.especialidade ?? undefined;
    }

    // ADR-0024: o medico precisa atender esta linha. Pronto atendimento e do
    // clinico geral; teleconsulta de uma especialidade, so de quem a tem conferida.
    if (dados.linha === "pronto_atendimento" && dados.especialidade) throw new ErroHttp(400, "LINHA_INVALIDA", "O pronto atendimento não tem especialidade.");
    const especialidade = dados.linha === "teleconsulta" ? dados.especialidade ?? null : null;
    // No retorno, o medico continua o proprio atendimento: a aptidao ja foi conferida na original.
    if (!retorno && (dados.linha === "pronto_atendimento" || especialidade)) {
      const [aptidao] = await banco.select({ especialidades: medicos.especialidades, atendeProntoAtendimento: medicos.atendeProntoAtendimento }).from(medicos).where(eq(medicos.perfilId, dados.medicoId)).limit(1);
      if (!aptidao || !medicoAtende(aptidao, dados.linha, especialidade)) {
        throw new ErroHttp(409, "MEDICO_NAO_ATENDE_ESTA_LINHA", dados.linha === "pronto_atendimento" ? "Este médico não atende o pronto atendimento." : "Este médico não atende esta especialidade.");
      }
    }

    // O horario pedido tem de ser um dos que a agenda oferece: assim ninguem
    // marca "09:07" mandando JSON na mao, nem fura a grade do medico.
    const inicio = new Date(dados.inicio);
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: req.contexto.fusoHorario }).format(inicio);
    const livres = await horariosLivres(req.contexto.clinicaId, req.contexto.fusoHorario, dados.medicoId, dia);
    const escolhido = livres.find((h) => new Date(h.inicio).getTime() === inicio.getTime());
    if (!escolhido) throw new ErroHttp(409, "HORARIO_INDISPONIVEL", "Este horário não está mais disponível. Recarregue a agenda e escolha outro.");

    // A trava do banco ainda conta reservas vencidas: sem liberar antes, este
    // horario pareceria livre e a gravacao falharia para sempre.
    await liberarReservasVencidas(banco, { medicoId: dados.medicoId, pacienteId });

    // A clinica cobra por consulta? Entao o horario nasce RESERVADO, nao
    // agendado: ele fica preso enquanto o paciente paga, e o pagamento e
    // que confirma (Modulo 10). Clinica sem preco definido continua
    // agendando direto - e o caso de quem cobra fora da plataforma. O mesmo
    // vale para quem tem preco, mas nao conectou conta de recebimento: em
    // producao ninguem conseguiria pagar, e o paciente ficaria preso na tela.
    const preco = await precoPara(banco, req.contexto.clinicaId, dados.linha, "agendado", { medicoId: dados.medicoId, especialidade });
    const cobraNaPlataforma = !retorno && Boolean(preco) && (await opcoes.resolvedor.temRecebimento(req.contexto.clinicaId));

    /**
     * ADR-0023 - COMO ESTA CONSULTA SERA COBRADA.
     *
     *   Paciente com cartao cadastrado: nada e pago agora. A consulta nasce
     *   AGENDADA, com o valor combinado, e o cartao e debitado quando o
     *   medico a encerra.
     *
     *   Paciente sem cartao (ou que preferiu Pix): o horario nasce RESERVADO e
     *   o Pix aparece em seguida, antes de a consulta existir de fato.
     *
     * So o proprio paciente compromete o cartao dele: a recepcao, marcando em
     * nome de alguem, segue sempre pelo Pix.
     */
    const paraMim = pacienteId === req.usuario.id;
    let cartaoId: string | null = null;
    if (cobraNaPlataforma && paraMim) {
      // Quem deve uma consulta anterior regulariza antes de marcar outra.
      await exigirSemPendencia(banco, pacienteId, req.contexto.clinicaId);
      if (dados.cobranca !== "pix") cartaoId = (await cartaoAtivo(banco, pacienteId, req.contexto.clinicaId))?.id ?? null;
    }
    if (dados.cobranca === "cartao" && !cartaoId) {
      throw new ErroHttp(409, "SEM_CARTAO", "Você não tem cartão válido cadastrado. Cadastre um ou pague por Pix.");
    }

    // ADR-0026: a porcentagem do medico do dia em que a consulta foi marcada.
    const repasseMedicoBps = await percentualDoMedico(banco, req.contexto.clinicaId, dados.medicoId);
    const id = randomUUID();
    try {
      await banco.transaction(async (tx) => {
        await tx.insert(consultas).values({
          repasseMedicoBps,
          id,
          clinicaId: req.contexto.clinicaId,
          pacienteId,
          medicoId: dados.medicoId,
          inicio,
          fim: new Date(escolhido.fim),
          motivo: dados.motivo ?? null,
          marcadoPor: req.usuario.id,
          linha: dados.linha,
          especialidade,
          retornoDe: retorno?.id ?? null,
          ...(cobraNaPlataforma ? { valorCombinadoCentavos: preco!.valorCentavos } : {}),
          ...(cobraNaPlataforma && cartaoId
            ? { formaDeCobranca: "cartao_ao_final" as const, cartaoId }
            : cobraNaPlataforma
              ? { status: "aguardando_pagamento" as const, expiraReservaEm: new Date(Date.now() + MINUTOS_DE_RESERVA * 60000) }
              : {}),
        });
        await registrarAuditoria(tx, {
          quem: req.usuario.id,
          clinicaId: req.contexto.clinicaId,
          acao: "consulta.marcada",
          tabela: "consultas",
          registroId: id,
          detalhes: { medicoId: dados.medicoId, pacienteId, inicio: dados.inicio, porEquipe: pacienteId !== req.usuario.id, linha: dados.linha, especialidade, cobranca: retorno ? "retorno_sem_custo" : cartaoId ? "cartao_ao_final" : cobraNaPlataforma ? "pix" : "fora_da_plataforma", retornoDe: retorno?.id ?? null },
          ip: req.ip,
        });
      });
    } catch (erro) {
      // A trava do banco: alguem marcou o mesmo horario no intervalo entre
      // a conferencia acima e esta gravacao.
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      const causa = (erro as { cause?: { constraint?: string; constraint_name?: string } }).cause;
      const detalhe = String(causa?.constraint_name ?? causa?.constraint ?? "");
      if (codigo === "23505" && (detalhe.includes("um_retorno") || retorno)) throw new ErroHttp(409, "RETORNO_JA_MARCADO", "Este retorno já foi marcado. Veja em Minhas consultas.");
      if (codigo === "23P01") {
        if (detalhe.includes("paciente")) throw new ErroHttp(409, "PACIENTE_JA_TEM_CONSULTA", "Você já tem outra consulta neste horário.");
        throw new ErroHttp(409, "HORARIO_INDISPONIVEL", "Este horário acabou de ser ocupado. Escolha outro.");
      }
      throw erro;
    }

    const [criada] = await consultasPorId(banco, [id]);
    // ADR-0019: avisa os dois. Sem dado clinico no texto (vai por e-mail).
    const local = await fusoDaClinica(banco, req.contexto.clinicaId);
    const quando = quandoNaClinica(new Date(criada!.inicio), local.fuso);
    const pagar = criada!.status === "aguardando_pagamento";
    await notificar(banco, [
      {
        perfilId: criada!.paciente.id,
        clinicaId: req.contexto.clinicaId,
        tipo: "consulta_marcada",
        titulo: pagar ? "Consulta reservada: conclua o pagamento" : retorno ? "Retorno marcado (sem custo)" : "Consulta marcada",
        corpo: `Teleconsulta com Dr(a). ${criada!.medico.nomeCompleto} ${quando}, em ${local.nome}.${pagar ? " O horário fica reservado por pouco tempo até o pagamento." : ""}`,
        link: pagar ? `/c/${local.slug}/pagamento/${id}` : `/c/${local.slug}/agenda`,
        chave: `consulta_marcada:${id}`,
      },
      {
        perfilId: criada!.medico.id,
        clinicaId: req.contexto.clinicaId,
        tipo: "consulta_marcada",
        titulo: "Nova consulta na sua agenda",
        corpo: `${criada!.paciente.nomeCompleto} ${quando}.`,
        link: `/c/${local.slug}/agenda`,
        chave: `consulta_marcada:${id}`,
      },
    ]);
    void reply.code(201);
    return { ok: true, dados: paraQuemPede(criada!, req.usuario.id) };
  });

  app.get("/consultas",{ preHandler: dentroDaClinica }, async (req): Promise<Resposta<ConsultaResumo[]>> => {
    const { de, ate } = z
      .object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(req.query);

    const inicio = de ? new Date(`${de}T00:00:00Z`) : new Date(Date.now() - 24 * 3600 * 1000);
    const fim = ate ? new Date(`${ate}T23:59:59Z`) : new Date(inicio.getTime() + 30 * 24 * 3600 * 1000);
    if (fim.getTime() - inicio.getTime() > JANELA_MAXIMA_DIAS * 24 * 3600 * 1000) {
      throw new ErroHttp(400, "JANELA_GRANDE_DEMAIS", `Peça no máximo ${JANELA_MAXIMA_DIAS} dias por vez.`);
    }

    /**
     * =================================================================
     * QUEM VE O QUE - E POR QUE ESTE FILTRO TEM QUE ESTAR AQUI
     * =================================================================
     *
     * Havia um comentario nesta linha dizendo "o RLS ja limita ao que a
     * pessoa pode ver". ESTAVA ERRADO, e o erro era grave: um paciente
     * logado recebia a agenda inteira da clinica - nome, horario e motivo
     * da consulta de todos os outros pacientes. Dado de saude de terceiro.
     *
     * A confusao vale ser entendida, porque ela se repete em todo projeto
     * que usa Supabase:
     *
     *   O RLS protege o acesso DIRETO ao banco - o navegador falando com o
     *   Postgres com a chave publicavel. Ali o Postgres sabe quem e a
     *   pessoa (auth.uid()) e aplica as politicas.
     *
     *   A API nao entra por essa porta. Ela conecta com a credencial dona
     *   do banco, exatamente para poder fazer o que o paciente nao pode:
     *   criar consulta, mexer em pagamento, gravar auditoria. Para o
     *   Postgres, ela e o dono - e dono nao e limitado por RLS.
     *
     * Ou seja: RLS e a segunda tranca, nao a primeira. Toda consulta feita
     * pela API precisa filtrar por quem esta pedindo. E o que este bloco
     * faz, e e por isso que ele nao e um detalhe de otimizacao.
     */
    const souEquipe = req.contexto.papel === "recepcao" || req.contexto.papel === "admin_clinica";
    const soMinhas = souEquipe
      ? undefined
      : req.contexto.papel === "medico"
        ? // O medico ve o que ele atende. O `or` cobre o caso de ele tambem
          // ser paciente nesta clinica: o papel mais forte manda no acesso,
          // mas as consultas dele como paciente continuam sendo dele.
          or(eq(consultas.medicoId, req.usuario.id), eq(consultas.pacienteId, req.usuario.id))
        : eq(consultas.pacienteId, req.usuario.id);

    const linhas = await banco
      .select(colunasDaConsulta())
      .from(consultas)
      .innerJoin(perfis, eq(perfis.id, consultas.pacienteId))
      .innerJoin(medicos, eq(medicos.perfilId, consultas.medicoId))
      .innerJoin(perfilDoMedico, eq(perfilDoMedico.id, consultas.medicoId))
      .where(and(eq(consultas.clinicaId, req.contexto.clinicaId), between(consultas.inicio, inicio, fim), soMinhas))
      .orderBy(asc(consultas.inicio));

    return { ok: true, dados: linhas.map(formatarConsulta).map((c) => paraQuemPede(c, req.usuario.id)) };
  });

  /** Uma consulta so, para quem pode ve-la (o paciente, o medico ou a equipe). */
  app.get("/consultas/:id", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<ConsultaResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const [c] = await consultasPorId(banco, [id]);
    const souEquipe = req.contexto.papeis.some((p) => p === "recepcao" || p === "admin_clinica");
    const [daClinica] = await banco.select({ id: consultas.id }).from(consultas).where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId))).limit(1);
    if (!c || !daClinica || (c.paciente.id !== req.usuario.id && c.medico.id !== req.usuario.id && !souEquipe)) {
      throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta não encontrada.");
    }
    return { ok: true, dados: paraQuemPede(c, req.usuario.id) };
  });

  app.post("/consultas/:id/cancelar", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<ConsultaResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const { motivo } = esquemaCancelar.parse(req.body);

    const [consulta] = await banco.select({ status: consultas.status, inicio: consultas.inicio, pacienteId: consultas.pacienteId, medicoId: consultas.medicoId }).from(consultas).where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId))).limit(1);
    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta não encontrada nesta clínica.");
    if (consulta.status === "cancelada") throw new ErroHttp(409, "JA_CANCELADA", "Esta consulta já estava cancelada.");
    if (consulta.status === "concluida") throw new ErroHttp(409, "JA_CONCLUIDA", "Consulta concluída não se cancela - ela aconteceu.");

    const envolvido = consulta.pacienteId === req.usuario.id || consulta.medicoId === req.usuario.id;
    if (!envolvido && !["recepcao", "admin_clinica"].includes(req.contexto.papel)) {
      throw new ErroHttp(403, "NAO_ENVOLVIDO", "Só o paciente, o médico ou a recepção cancelam esta consulta.");
    }

    await banco.transaction(async (tx) => {
      // A condicao de estado evita cancelar o que acabou de ser concluido.
      const canceladas = await tx
        .update(consultas)
        .set({ status: "cancelada", canceladoEm: new Date(), canceladoPor: req.usuario.id, motivoCancelamento: motivo, expiraReservaEm: null, atualizadoEm: new Date() })
        .where(and(eq(consultas.id, id), notInArray(consultas.status, ["cancelada", "concluida"])))
        .returning({ id: consultas.id });
      if (canceladas.length === 0) throw new ErroHttp(409, "ESTADO_MUDOU", "Esta consulta acabou de mudar. Recarregue a página.");

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "consulta.cancelada",
        tabela: "consultas",
        registroId: id,
        detalhes: { motivo, horasDeAntecedencia: Math.round((consulta.inicio.getTime() - Date.now()) / 3600000) },
        ip: req.ip,
      });

      // Consulta ja paga: o estorno e decisao da clinica, mas nao pode ficar esquecido.
      // A busca e pelo pagamento, porque a consulta nascida da fila nao aponta para ele.
      const pagos = await tx.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.consultaId, id), inArray(pagamentos.status, ["confirmado", "autorizado"])));
      for (const pago of pagos) {
        await registrarPendenciaDeEstorno(tx, { clinicaId: req.contexto.clinicaId, pagamentoId: pago.id, pacienteId: consulta.pacienteId, consultaId: id, motivo: "consulta paga foi cancelada", ip: req.ip });
      }
      // Quem veio da fila nao foi atendido: a entrada se encerra como tal.
      await tx
        .update(filaAtendimento)
        .set({ status: "desistiu", encerradoEm: new Date(), observacao: "consulta cancelada" })
        .where(and(eq(filaAtendimento.consultaId, id), eq(filaAtendimento.status, "em_atendimento")));
    });

    const [atualizada] = await consultasPorId(banco, [id]);
    // ADR-0019: avisa quem NAO cancelou.
    const local = await fusoDaClinica(banco, req.contexto.clinicaId);
    const quando = quandoNaClinica(new Date(atualizada!.inicio), local.fuso);
    await notificar(
      banco,
      [atualizada!.paciente.id, atualizada!.medico.id]
        .filter((p) => p !== req.usuario.id)
        .map((perfilId) => ({
          perfilId,
          clinicaId: req.contexto.clinicaId,
          tipo: "consulta_cancelada" as const,
          titulo: "Consulta cancelada",
          corpo: `A consulta de ${quando} em ${local.nome} foi cancelada.`,
          link: `/c/${local.slug}/agenda`,
          chave: `consulta_cancelada:${id}`,
        })),
    );
    return { ok: true, dados: paraQuemPede(atualizada!, req.usuario.id) };
  });

  app.post("/consultas/:id/status",{ preHandler: soMedico }, async (req): Promise<Resposta<ConsultaResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const { status } = z.object({ status: z.enum(["em_andamento", "concluida"], { message: "status deve ser em_andamento ou concluida" }) }).parse(req.body);

    const [consulta] = await banco.select({ status: consultas.status, medicoId: consultas.medicoId }).from(consultas).where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId))).limit(1);
    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta não encontrada nesta clínica.");
    if (consulta.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU_ATENDIMENTO", "Só o médico da consulta muda o andamento dela.");

    // agendada -> em_andamento -> concluida. Sem pular etapa e sem voltar.
    const permitido: Record<string, string[]> = { agendada: ["em_andamento"], em_andamento: ["concluida"], concluida: [], cancelada: [] };
    if (!permitido[consulta.status]?.includes(status)) {
      throw new ErroHttp(409, "TRANSICAO_INVALIDA", `Não dá para ir de "${consulta.status}" para "${status}".`);
    }

    await banco.transaction(async (tx) => {
      // So muda se ninguem mudou antes (cancelamento ou falta no mesmo instante).
      const feitas = await tx
        .update(consultas)
        .set({ status, atualizadoEm: new Date() })
        .where(and(eq(consultas.id, id), eq(consultas.status, consulta.status)))
        .returning({ id: consultas.id });
      if (feitas.length === 0) throw new ErroHttp(409, "ESTADO_MUDOU", "Esta consulta acabou de mudar. Recarregue a página.");
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: status === "concluida" ? "consulta.concluida" : "consulta.iniciada",
        tabela: "consultas",
        registroId: id,
        ip: req.ip,
      });
    });
    // Consulta concluida: quem deixou cartao cadastrado e debitado agora (ADR-0023).
    if (status === "concluida") opcoes.aoConcluir?.(id);

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
      medicoNome: perfilDoMedico.nomeCompleto,
      especialidade: medicos.especialidade,
      crm: medicos.crm,
      crmUf: medicos.crmUf,
      motivoCancelamento: consultas.motivoCancelamento,
      linha: consultas.linha,
      especialidadeDaConsulta: consultas.especialidade,
      formaDeCobranca: consultas.formaDeCobranca,
      valorCombinadoCentavos: consultas.valorCombinadoCentavos,
      retornoAte: consultas.retornoAte,
      retornoDe: consultas.retornoDe,
      ausencia: consultas.ausencia,
      retornoMarcado: sql<boolean>`exists (select 1 from consultas r where r.retorno_de = ${consultas.id} and r.status <> 'cancelada')`,
      notaDaAvaliacao: sql<number | null>`(select a.nota from avaliacoes_consulta a where a.consulta_id = ${consultas.id})`,
    };
  }

  async function consultasPorId(b: Banco, ids: string[]) {
    const linhas = await b.select(colunasDaConsulta()).from(consultas).innerJoin(perfis, eq(perfis.id, consultas.pacienteId)).innerJoin(medicos, eq(medicos.perfilId, consultas.medicoId)).innerJoin(perfilDoMedico, eq(perfilDoMedico.id, consultas.medicoId)).where(inArray(consultas.id, ids));
    return linhas.map(formatarConsulta);
  }
}

function formatarConsulta(l: {
  id: string; inicio: Date; fim: Date; status: string; motivo: string | null;
  pacienteId: string; pacienteNome: string; medicoId: string; medicoNome: string; especialidade: string | null;
  crm: string; crmUf: string; motivoCancelamento: string | null;
  linha: "pronto_atendimento" | "teleconsulta"; especialidadeDaConsulta: string | null; formaDeCobranca: "antecipada" | "cartao_ao_final"; valorCombinadoCentavos: number | null;
  retornoAte: Date | null; retornoDe: string | null; ausencia: string | null; retornoMarcado: boolean; notaDaAvaliacao: number | null;
}): ConsultaResumo {
  return {
    id: l.id,
    inicio: l.inicio.toISOString(),
    fim: l.fim.toISOString(),
    status: l.status as ConsultaResumo["status"],
    motivo: l.motivo,
    paciente: { id: l.pacienteId, nomeCompleto: l.pacienteNome },
    medico: { id: l.medicoId, nomeCompleto: l.medicoNome, especialidade: l.especialidade, crm: l.crm, crmUf: l.crmUf },
    motivoCancelamento: l.motivoCancelamento,
    linha: l.linha,
    especialidadeDaConsulta: l.especialidadeDaConsulta,
    formaDeCobranca: l.formaDeCobranca,
    valorCombinadoCentavos: l.valorCombinadoCentavos,
    retornoAte: l.retornoAte ? new Date(l.retornoAte).toISOString() : null,
    retornoDe: l.retornoDe,
    retornoMarcado: Boolean(l.retornoMarcado),
    ausencia: (l.ausencia as ConsultaResumo["ausencia"]) ?? null,
    notaDaAvaliacao: l.notaDaAvaliacao === null || l.notaDaAvaliacao === undefined ? null : Number(l.notaDaAvaliacao),
  };
}

// O perfil aparece duas vezes na consulta (paciente e medico): o segundo
// join precisa de outro nome.
const perfilDoMedico = alias(perfis, "perfil_do_medico");


