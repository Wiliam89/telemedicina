/**
 * =====================================================================
 * PLANTAO E FILA DE PRONTO ATENDIMENTO
 * =====================================================================
 *
 * O segundo modo de atendimento da plataforma. No AGENDAMENTO (Modulo 7) o
 * paciente escolhe dia, hora e profissional. Aqui ele nao escolhe nada:
 * paga, entra na fila e e chamado pelo proximo medico de plantao. E o que
 * as plataformas do setor operam 24 horas por dia, para casos de baixa
 * complexidade.
 *
 *   POST /plantoes                 escalar (admin) ou se escalar (medico)
 *   POST /plantoes/:id/abrir       "estou aqui, pode me mandar paciente"
 *   POST /plantoes/:id/encerrar
 *   GET  /plantoes                 a escala da clinica
 *   POST /fila                     paciente entra (exige pagamento + consentimento)
 *   GET  /fila                     a fila da clinica / a minha posicao
 *   POST /fila/proximo             o medico chama o proximo
 *   POST /fila/:id/desistir
 *
 * O FLUXO DO PACIENTE, na ordem que o mercado usa:
 *   queixa -> pagamento -> CONSENTIMENTO -> fila -> chamada -> video
 */
import { and, asc, count, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consultas, filaAtendimento, medicos, pagamentos, perfis, plantoes, precos, vinculos, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

/**
 * A versao vem de @tele/shared, junto com o TEXTO que a tela mostra. Uma
 * fonte so: se houvesse duas, a pessoa poderia consentir com um texto e o
 * sistema registrar outro - e o registro nao provaria nada.
 */
import { VERSAO_DO_CONSENTIMENTO } from "@tele/shared/consentimento";

/** Duracao presumida de um atendimento de plantao, para montar a consulta. */
const MINUTOS_DO_ATENDIMENTO = 20;

/** Fila sem chamada por mais tempo que isto vira desistencia por espera. */
const MINUTOS_ATE_EXPIRAR = 120;

export async function rotasFila(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];
  const equipe = [...dentroDaClinica, exigirPapel("medico", "recepcao", "admin_clinica")];

  // --- plantao --------------------------------------------------------------

  app.post("/plantoes", { preHandler: soMedico }, async (req, reply): Promise<Resposta<{ id: string }>> => {
    const dados = z
      .object({ inicio: z.string().datetime({ offset: true }), fim: z.string().datetime({ offset: true }) })
      .parse(req.body);

    const inicio = new Date(dados.inicio);
    const fim = new Date(dados.fim);
    if (fim <= inicio) throw new ErroHttp(400, "PERIODO_INVALIDO", "O fim do plantao precisa ser depois do inicio.");
    if (fim.getTime() - inicio.getTime() > 24 * 3600 * 1000) {
      throw new ErroHttp(400, "PLANTAO_LONGO_DEMAIS", "Um plantao nao pode passar de 24 horas.");
    }

    const [criado] = await banco
      .insert(plantoes)
      .values({ clinicaId: req.contexto.clinicaId, medicoId: req.usuario.id, inicio, fim })
      .returning({ id: plantoes.id });

    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "plantao.escalado",
      tabela: "plantoes",
      registroId: criado!.id,
      detalhes: { inicio: dados.inicio, fim: dados.fim },
      ip: req.ip,
    });

    void reply.code(201);
    return { ok: true, dados: { id: criado!.id } };
  });

  app.post("/plantoes/:id/abrir", { preHandler: soMedico }, async (req): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);

    const [p] = await banco
      .select({ status: plantoes.status, medicoId: plantoes.medicoId, fim: plantoes.fim })
      .from(plantoes)
      .where(and(eq(plantoes.id, id), eq(plantoes.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!p) throw new ErroHttp(404, "PLANTAO_NAO_ENCONTRADO", "Plantao nao encontrado nesta clinica.");
    if (p.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU", "So quem esta escalado abre o proprio plantao.");
    if (p.status !== "escalado") throw new ErroHttp(409, "JA_ABERTO", `Este plantao ja esta "${p.status}".`);
    if (p.fim < new Date()) throw new ErroHttp(409, "PLANTAO_VENCIDO", "Este plantao ja passou.");

    await banco.update(plantoes).set({ status: "aberto", abertoEm: new Date() }).where(eq(plantoes.id, id));
    await registrarAuditoria(banco, {
      quem: req.usuario.id, clinicaId: req.contexto.clinicaId,
      acao: "plantao.aberto", tabela: "plantoes", registroId: id, ip: req.ip,
    });
    return { ok: true, dados: { status: "aberto" } };
  });

  app.post("/plantoes/:id/encerrar", { preHandler: soMedico }, async (req): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);

    const [p] = await banco
      .select({ status: plantoes.status, medicoId: plantoes.medicoId })
      .from(plantoes)
      .where(and(eq(plantoes.id, id), eq(plantoes.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!p) throw new ErroHttp(404, "PLANTAO_NAO_ENCONTRADO", "Plantao nao encontrado nesta clinica.");
    if (p.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU", "So quem esta escalado encerra o proprio plantao.");

    // Encerrar com paciente em atendimento deixaria alguem no vacuo.
    const [emAtendimento] = await banco
      .select({ n: count() })
      .from(filaAtendimento)
      .where(and(eq(filaAtendimento.plantaoId, id), inArray(filaAtendimento.status, ["chamado", "em_atendimento"])));
    if ((emAtendimento?.n ?? 0) > 0) {
      throw new ErroHttp(409, "ATENDIMENTO_EM_CURSO", "Conclua o atendimento em andamento antes de encerrar o plantao.");
    }

    await banco.update(plantoes).set({ status: "encerrado", encerradoEm: new Date() }).where(eq(plantoes.id, id));
    await registrarAuditoria(banco, {
      quem: req.usuario.id, clinicaId: req.contexto.clinicaId,
      acao: "plantao.encerrado", tabela: "plantoes", registroId: id, ip: req.ip,
    });
    return { ok: true, dados: { status: "encerrado" } };
  });

  app.get("/plantoes", { preHandler: equipe }, async (req) => {
    const linhas = await banco
      .select({
        id: plantoes.id, inicio: plantoes.inicio, fim: plantoes.fim, status: plantoes.status,
        medicoId: plantoes.medicoId, medicoNome: perfis.nomeCompleto, crm: medicos.crm, crmUf: medicos.crmUf,
      })
      .from(plantoes)
      .innerJoin(perfis, eq(perfis.id, plantoes.medicoId))
      .innerJoin(medicos, eq(medicos.perfilId, plantoes.medicoId))
      .where(and(eq(plantoes.clinicaId, req.contexto.clinicaId), gte(plantoes.fim, new Date(Date.now() - 24 * 3600 * 1000))))
      .orderBy(asc(plantoes.inicio));

    return {
      ok: true as const,
      dados: linhas.map((l) => ({ ...l, inicio: l.inicio.toISOString(), fim: l.fim.toISOString() })),
    };
  });

  // --- fila -----------------------------------------------------------------

  app.post("/fila", { preHandler: dentroDaClinica }, async (req, reply) => {
    const dados = z
      .object({
        queixa: z.string().trim().min(5, "descreva o que voce esta sentindo").max(1000),
        pagamentoId: z.string().uuid("pagamentoId invalido"),
        consentimento: z.literal(true, { message: "e preciso aceitar o termo de telemedicina" }),
      })
      .parse(req.body);

    if (req.contexto.papel !== "paciente") {
      throw new ErroHttp(403, "SO_PACIENTE", "So paciente entra na fila de atendimento.");
    }

    // Ja esta na fila? Nao entra duas vezes.
    const [existente] = await banco
      .select({ id: filaAtendimento.id })
      .from(filaAtendimento)
      .where(
        and(
          eq(filaAtendimento.pacienteId, req.usuario.id),
          eq(filaAtendimento.clinicaId, req.contexto.clinicaId),
          inArray(filaAtendimento.status, ["aguardando", "chamado", "em_atendimento"]),
        ),
      )
      .limit(1);
    if (existente) throw new ErroHttp(409, "JA_NA_FILA", "Voce ja esta na fila desta clinica.");

    // O pagamento precisa estar CONFIRMADO, ser desta pessoa, desta clinica,
    // e nao ter sido usado antes. Sem isso, entrar na fila seria de graca.
    const [pagamento] = await banco
      .select({ id: pagamentos.id, status: pagamentos.status, pagadorId: pagamentos.pagadorId, consultaId: pagamentos.consultaId })
      .from(pagamentos)
      .where(and(eq(pagamentos.id, dados.pagamentoId), eq(pagamentos.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!pagamento) throw new ErroHttp(404, "PAGAMENTO_NAO_ENCONTRADO", "Pagamento nao encontrado nesta clinica.");
    if (pagamento.pagadorId !== req.usuario.id) throw new ErroHttp(403, "PAGAMENTO_DE_OUTRO", "Este pagamento nao e seu.");
    if (pagamento.status !== "confirmado") {
      throw new ErroHttp(409, "PAGAMENTO_NAO_CONFIRMADO", "O pagamento ainda nao foi confirmado. Aguarde a confirmacao para entrar na fila.");
    }

    const [jaUsado] = await banco
      .select({ id: filaAtendimento.id })
      .from(filaAtendimento)
      .where(eq(filaAtendimento.pagamentoId, dados.pagamentoId))
      .limit(1);
    if (jaUsado || pagamento.consultaId) {
      throw new ErroHttp(409, "PAGAMENTO_JA_USADO", "Este pagamento ja foi usado em outro atendimento.");
    }

    const [entrada] = await banco
      .insert(filaAtendimento)
      .values({
        clinicaId: req.contexto.clinicaId,
        pacienteId: req.usuario.id,
        pagamentoId: dados.pagamentoId,
        queixa: dados.queixa,
        consentimentoEm: new Date(),
        consentimentoVersao: VERSAO_DO_CONSENTIMENTO,
      })
      .returning({ id: filaAtendimento.id, entrouEm: filaAtendimento.entrouEm });

    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "fila.entrou",
      tabela: "fila_atendimento",
      registroId: entrada!.id,
      // O consentimento entra na auditoria: e o que prova, depois, que ele
      // existiu e sobre qual texto.
      detalhes: { consentimentoVersao: VERSAO_DO_CONSENTIMENTO },
      ip: req.ip,
    });

    void reply.code(201);
    return { ok: true as const, dados: { id: entrada!.id, entrouEm: entrada!.entrouEm.toISOString() } };
  });

  /**
   * A fila. O paciente ve so a propria posicao; a equipe ve todo mundo.
   */
  app.get("/fila", { preHandler: dentroDaClinica }, async (req) => {
    await expirarEsquecidos(banco, req.contexto.clinicaId);

    const aguardando = await banco
      .select({
        id: filaAtendimento.id, pacienteId: filaAtendimento.pacienteId, entrouEm: filaAtendimento.entrouEm,
        prioridade: filaAtendimento.prioridade, queixa: filaAtendimento.queixa, status: filaAtendimento.status,
        nome: perfis.nomeCompleto,
      })
      .from(filaAtendimento)
      .innerJoin(perfis, eq(perfis.id, filaAtendimento.pacienteId))
      .where(and(eq(filaAtendimento.clinicaId, req.contexto.clinicaId), inArray(filaAtendimento.status, ["aguardando", "chamado", "em_atendimento"])))
      .orderBy(asc(filaAtendimento.prioridade), asc(filaAtendimento.entrouEm));

    const [medicosDisponiveis] = await banco
      .select({ n: count() })
      .from(plantoes)
      .where(and(eq(plantoes.clinicaId, req.contexto.clinicaId), eq(plantoes.status, "aberto")));

    const souEquipe = ["medico", "recepcao", "admin_clinica"].includes(req.contexto.papel);
    const minha = aguardando.findIndex((f) => f.pacienteId === req.usuario.id);

    return {
      ok: true as const,
      dados: {
        // Estimativa simples e honesta: quantos estao na frente, dividido
        // pelos medicos de plantao, vezes a duracao presumida.
        totalAguardando: aguardando.filter((f) => f.status === "aguardando").length,
        medicosDePlantao: medicosDisponiveis?.n ?? 0,
        minhaPosicao: minha >= 0 ? minha + 1 : null,
        minhaSituacao: minha >= 0 ? aguardando[minha]!.status : null,
        esperaEstimadaMinutos:
          minha >= 0 && (medicosDisponiveis?.n ?? 0) > 0
            ? Math.max(0, Math.round((minha * MINUTOS_DO_ATENDIMENTO) / (medicosDisponiveis?.n ?? 1)))
            : null,
        // A lista completa e so para quem trabalha na clinica.
        lista: souEquipe
          ? aguardando.map((f, i) => ({
              id: f.id, posicao: i + 1, nome: f.nome, queixa: f.queixa, status: f.status,
              entrouEm: f.entrouEm.toISOString(),
              esperandoMinutos: Math.round((Date.now() - f.entrouEm.getTime()) / 60000),
            }))
          : [],
      },
    };
  });

  /**
   * CHAMAR O PROXIMO - o ponto delicado do modulo.
   *
   * Dois medicos clicando ao mesmo tempo nao podem pegar o mesmo paciente.
   * Conferir "quem e o proximo?" e depois marcar como chamado deixa uma
   * janela entre as duas coisas - e nessa janela cabe o outro medico.
   *
   * A solucao e do Postgres: SELECT ... FOR UPDATE SKIP LOCKED. A primeira
   * transacao tranca a linha do proximo da fila; a segunda, em vez de
   * esperar, PULA a linha trancada e pega a seguinte. Cada medico leva um
   * paciente diferente, sem ninguem esperar.
   */
  app.post("/fila/proximo", { preHandler: soMedico }, async (req) => {
    const [plantao] = await banco
      .select({ id: plantoes.id })
      .from(plantoes)
      .where(and(eq(plantoes.clinicaId, req.contexto.clinicaId), eq(plantoes.medicoId, req.usuario.id), eq(plantoes.status, "aberto")))
      .limit(1);
    if (!plantao) throw new ErroHttp(409, "SEM_PLANTAO_ABERTO", "Abra seu plantao antes de chamar pacientes.");

    const resultado = await banco.transaction(async (tx) => {
      const proximos = await tx.execute<{ id: string; paciente_id: string }>(sql`
        select id, paciente_id from fila_atendimento
        where clinica_id = ${req.contexto.clinicaId} and status = 'aguardando'
        order by prioridade asc, entrou_em asc
        limit 1
        for update skip locked
      `);
      const proximo = (proximos as unknown as { id: string; paciente_id: string }[])[0];
      if (!proximo) return null;

      const agora = new Date();
      const [consulta] = await tx
        .insert(consultas)
        .values({
          clinicaId: req.contexto.clinicaId,
          pacienteId: proximo.paciente_id,
          medicoId: req.usuario.id,
          inicio: agora,
          fim: new Date(agora.getTime() + MINUTOS_DO_ATENDIMENTO * 60000),
          status: "em_andamento",
          motivo: "Pronto atendimento",
          marcadoPor: req.usuario.id,
        })
        .returning({ id: consultas.id });

      await tx
        .update(filaAtendimento)
        .set({ status: "em_atendimento", chamadoEm: agora, plantaoId: plantao.id, consultaId: consulta!.id })
        .where(eq(filaAtendimento.id, proximo.id));

      // O pagamento da fila passa a apontar para a consulta que nasceu.
      await tx
        .update(pagamentos)
        .set({ consultaId: consulta!.id, atualizadoEm: agora })
        .where(eq(pagamentos.id, sql`(select pagamento_id from fila_atendimento where id = ${proximo.id})`));

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "fila.chamou_proximo",
        tabela: "fila_atendimento",
        registroId: proximo.id,
        detalhes: { consultaId: consulta!.id },
        ip: req.ip,
      });

      return { filaId: proximo.id, consultaId: consulta!.id, pacienteId: proximo.paciente_id };
    });

    if (!resultado) return { ok: true as const, dados: { chamou: false as const } };

    const [paciente] = await banco.select({ nome: perfis.nomeCompleto }).from(perfis).where(eq(perfis.id, resultado.pacienteId)).limit(1);
    return { ok: true as const, dados: { chamou: true as const, ...resultado, pacienteNome: paciente?.nome ?? "" } };
  });

  app.post("/fila/:id/desistir", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const motivo = z.object({ motivo: z.string().trim().max(200).optional() }).parse(req.body ?? {});

    const [f] = await banco
      .select({ status: filaAtendimento.status, pacienteId: filaAtendimento.pacienteId })
      .from(filaAtendimento)
      .where(and(eq(filaAtendimento.id, id), eq(filaAtendimento.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!f) throw new ErroHttp(404, "NAO_ENCONTRADO", "Entrada da fila nao encontrada.");

    const souEquipe = ["recepcao", "admin_clinica"].includes(req.contexto.papel);
    if (f.pacienteId !== req.usuario.id && !souEquipe) throw new ErroHttp(403, "NAO_E_SUA", "Esta entrada da fila nao e sua.");
    if (f.status !== "aguardando") throw new ErroHttp(409, "JA_EM_ATENDIMENTO", "O atendimento ja comecou - fale com o profissional.");

    await banco
      .update(filaAtendimento)
      .set({ status: "desistiu", encerradoEm: new Date(), observacao: motivo.motivo ?? null })
      .where(eq(filaAtendimento.id, id));

    await registrarAuditoria(banco, {
      quem: req.usuario.id, clinicaId: req.contexto.clinicaId,
      acao: "fila.desistiu", tabela: "fila_atendimento", registroId: id,
      // O estorno nao e automatico: a clinica decide conforme a politica
      // dela (ADR-0012). O registro fica aqui para ela agir.
      detalhes: { motivo: motivo.motivo ?? null, pendenteDeEstorno: true },
      ip: req.ip,
    });

    return { ok: true, dados: { status: "desistiu" } };
  });

  /** Quem entrou e nunca foi chamado nao pode ficar esperando para sempre. */
  async function expirarEsquecidos(b: Banco, clinicaId: string): Promise<void> {
    const limite = new Date(Date.now() - MINUTOS_ATE_EXPIRAR * 60000);
    await b
      .update(filaAtendimento)
      .set({ status: "expirado", encerradoEm: new Date(), observacao: "tempo de espera excedido" })
      .where(and(eq(filaAtendimento.clinicaId, clinicaId), eq(filaAtendimento.status, "aguardando"), lte(filaAtendimento.entrouEm, limite)));
  }
}
