/**
 * =====================================================================
 * ATENDIMENTO IMEDIATO: PLANTAO, FILA E DESPACHO
 * =====================================================================
 *
 * O modo imediato das duas linhas de atendimento (ADR-0024):
 *   - pronto atendimento: clinico geral;
 *   - teleconsulta: o paciente escolhe a especialidade.
 *
 * O paciente nao escolhe o medico: descreve o que sente, garante o pagamento
 * (cartao cadastrado ou Pix) e entra na fila. A partir dai o pedido e
 * OFERECIDO A TODOS os medicos online que podem atende-lo, e o primeiro que
 * aceita fica com ele (ADR-0025) - como numa corrida de aplicativo.
 *
 *   POST /plantoes                 escalar-se
 *   POST /plantoes/:id/abrir       "estou online, pode me mandar paciente"
 *   POST /plantoes/:id/encerrar
 *   GET  /plantoes                 a escala
 *   POST /fila                     paciente entra (garantia de pagamento + consentimento)
 *   GET  /fila                     a minha posicao / a fila inteira (equipe)
 *   GET  /fila/chamados            medico online: os pedidos que ele pode aceitar
 *   POST /fila/:id/aceitar         medico aceita ESTE pedido (so um consegue)
 *   POST /fila/proximo             medico aceita o mais antigo que ele pode atender
 *   POST /fila/:id/desistir
 *
 * O FLUXO DO PACIENTE:
 *   queixa -> pagamento garantido -> CONSENTIMENTO -> fila -> aceite -> video
 */
import { and, asc, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consultas, filaAtendimento, medicos, pagamentos, perfis, plantoes, vinculos, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { especialidadeExiste, medicoAtende, rotuloDoPedido, type ChamadoNaFila, type LinhaDeAtendimento, type PainelDeChamados } from "@tele/shared/atendimento";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { cartaoAtivo, exigirSemPendencia, precoPara } from "../cobranca.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { exigirCrmVerificado, situacoesCrm } from "../crm.js";
import { ErroHttp } from "../erros.js";
import { notificar } from "../notificacoes/index.js";
import type { ResolvedorDePagamento } from "../pagamento/index.js";
import { percentualDoMedico } from "../repasse.js";
import { expirarEsquecidosDaFila, registrarPendenciaDeEstorno } from "../reservas.js";

/**
 * A versao vem de @tele/shared, junto com o TEXTO que a tela mostra. Uma
 * fonte so: se houvesse duas, a pessoa poderia consentir com um texto e o
 * sistema registrar outro - e o registro nao provaria nada.
 */
import { VERSAO_DO_CONSENTIMENTO } from "@tele/shared/consentimento";

/** Duracao presumida de um atendimento imediato, para montar a consulta. */
const MINUTOS_DO_ATENDIMENTO = 20;
/** Sem ninguem online, ate quantos medicos aptos sao avisados de que ha paciente esperando. */
const MAXIMO_DE_AVISOS_SEM_NINGUEM_ONLINE = 50;

interface PedidoNaFila extends Record<string, unknown> {
  id: string;
  paciente_id: string;
  linha: LinhaDeAtendimento;
  especialidade: string | null;
  valor_combinado_centavos: number | null;
  cartao_id: string | null;
  pagamento_id: string | null;
}

export async function rotasFila(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador; producao: boolean; resolvedor: ResolvedorDePagamento }): Promise<void> {
  const { banco, resolvedor } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];
  const equipe = [...dentroDaClinica, exigirPapel("medico", "recepcao", "admin_clinica")];

  /** O que este medico pode atender (ADR-0024). */
  async function aptidaoDe(medicoId: string) {
    const [m] = await banco.select({ especialidades: medicos.especialidades, atendeProntoAtendimento: medicos.atendeProntoAtendimento }).from(medicos).where(eq(medicos.perfilId, medicoId)).limit(1);
    return m ?? { especialidades: [], atendeProntoAtendimento: false };
  }

  async function plantaoAbertoDe(medicoId: string, clinicaId: string) {
    const [p] = await banco
      .select({ id: plantoes.id })
      .from(plantoes)
      .where(and(eq(plantoes.clinicaId, clinicaId), eq(plantoes.medicoId, medicoId), eq(plantoes.status, "aberto"), gte(plantoes.fim, new Date())))
      .limit(1);
    return p ?? null;
  }

  /** Medicos da clinica que podem atender este pedido, com CRM conferido. `online` = so quem esta de plantao aberto. */
  async function medicosAptos(clinicaId: string, linha: LinhaDeAtendimento, especialidade: string | null, online: boolean): Promise<string[]> {
    const linhas = await banco
      .select({ id: medicos.perfilId, especialidades: medicos.especialidades, atendeProntoAtendimento: medicos.atendeProntoAtendimento })
      .from(vinculos)
      .innerJoin(medicos, eq(medicos.perfilId, vinculos.perfilId))
      .where(
        and(
          eq(vinculos.clinicaId, clinicaId),
          eq(vinculos.papel, "medico"),
          eq(vinculos.status, "ativo"),
          online ? sql`exists (select 1 from plantoes p where p.medico_id = ${medicos.perfilId} and p.clinica_id = ${clinicaId} and p.status = 'aberto' and p.fim >= now())` : undefined,
        ),
      );
    const aptos = linhas.filter((m) => medicoAtende(m, linha, especialidade)).map((m) => m.id);
    const situacoes = await situacoesCrm(banco, clinicaId, aptos);
    return aptos.filter((id) => situacoes.get(id) === "verificado");
  }

  // --- plantao --------------------------------------------------------------

  app.post("/plantoes", { preHandler: soMedico }, async (req, reply): Promise<Resposta<{ id: string }>> => {
    const dados = z
      .object({ inicio: z.string().datetime({ offset: true }), fim: z.string().datetime({ offset: true }) })
      .parse(req.body);
    await exigirCrmVerificado(banco, req.contexto.clinicaId, req.usuario.id);

    const inicio = new Date(dados.inicio);
    const fim = new Date(dados.fim);
    if (fim <= inicio) throw new ErroHttp(400, "PERIODO_INVALIDO", "O fim do plantão precisa ser depois do início.");
    if (fim.getTime() - inicio.getTime() > 24 * 3600 * 1000) {
      throw new ErroHttp(400, "PLANTAO_LONGO_DEMAIS", "Um plantão não pode passar de 24 horas.");
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
    // ADR-0016: plantao e atendimento - exige CRM conferido.
    await exigirCrmVerificado(banco, req.contexto.clinicaId, req.usuario.id);

    const [p] = await banco
      .select({ status: plantoes.status, medicoId: plantoes.medicoId, fim: plantoes.fim })
      .from(plantoes)
      .where(and(eq(plantoes.id, id), eq(plantoes.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!p) throw new ErroHttp(404, "PLANTAO_NAO_ENCONTRADO", "Plantão não encontrado nesta clínica.");
    if (p.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU", "Só quem está escalado abre o próprio plantão.");
    if (p.status !== "escalado") throw new ErroHttp(409, "JA_ABERTO", `Este plantão já está "${p.status}".`);
    if (p.fim < new Date()) throw new ErroHttp(409, "PLANTAO_VENCIDO", "Este plantão já passou.");

    // Online sem poder atender nada nao recebe pedido nenhum: melhor dizer agora.
    const aptidao = await aptidaoDe(req.usuario.id);
    if (!aptidao.atendeProntoAtendimento && aptidao.especialidades.length === 0) {
      throw new ErroHttp(409, "SEM_LINHA_DE_ATENDIMENTO", "Você ainda não tem pronto atendimento nem especialidade liberados. Fale com a administração.");
    }

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
    if (!p) throw new ErroHttp(404, "PLANTAO_NAO_ENCONTRADO", "Plantão não encontrado nesta clínica.");
    if (p.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU", "Só quem está escalado encerra o próprio plantão.");

    // Encerrar com paciente em atendimento deixaria alguem no vacuo.
    const [emAtendimento] = await banco
      .select({ n: count() })
      .from(filaAtendimento)
      .where(and(eq(filaAtendimento.plantaoId, id), inArray(filaAtendimento.status, ["chamado", "em_atendimento"])));
    if ((emAtendimento?.n ?? 0) > 0) {
      throw new ErroHttp(409, "ATENDIMENTO_EM_CURSO", "Conclua o atendimento em andamento antes de encerrar o plantão.");
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
        queixa: z.string().trim().min(5, "descreva o que você está sentindo").max(1000),
        linha: z.enum(["pronto_atendimento", "teleconsulta"]).default("pronto_atendimento"),
        especialidade: z.string().refine(especialidadeExiste, "especialidade desconhecida").optional(),
        /** Pix ja confirmado (quem nao tem cartao)... */
        pagamentoId: z.string().uuid("pagamentoId invalido").optional(),
        /** ...ou o cartao cadastrado, debitado ao final (ADR-0023). */
        usarCartao: z.literal(true).optional(),
        consentimento: z.literal(true, { message: "e preciso aceitar o termo de telemedicina" }),
      })
      .superRefine((d, ctx) => {
        if (d.linha === "teleconsulta" && !d.especialidade) ctx.addIssue({ code: "custom", path: ["especialidade"], message: "escolha a especialidade" });
        if (d.linha === "pronto_atendimento" && d.especialidade) ctx.addIssue({ code: "custom", path: ["especialidade"], message: "o pronto atendimento não tem especialidade" });
        if (!d.pagamentoId && !d.usarCartao) ctx.addIssue({ code: "custom", path: ["pagamentoId"], message: "informe o pagamento ou use o cartão cadastrado" });
        if (d.pagamentoId && d.usarCartao) ctx.addIssue({ code: "custom", path: ["usarCartao"], message: "escolha uma forma de pagamento só" });
      })
      .parse(req.body);

    if (req.contexto.papel !== "paciente") {
      throw new ErroHttp(403, "SO_PACIENTE", "Só paciente entra na fila de atendimento.");
    }
    const especialidade = dados.linha === "teleconsulta" ? dados.especialidade! : null;

    // Especialidade que ninguem atende aqui deixaria o paciente esperando para sempre.
    if (dados.linha === "teleconsulta" && (await medicosAptos(req.contexto.clinicaId, "teleconsulta", especialidade, false)).length === 0) {
      throw new ErroHttp(409, "ESPECIALIDADE_INDISPONIVEL", "Ainda não há médico desta especialidade na plataforma. Escolha outra ou use o pronto atendimento.");
    }

    // O valor deste atendimento hoje. Com cartao ele e obrigatorio (e o que sera
    // debitado no final); com Pix, o pagamento ja traz o valor que foi cobrado.
    const preco = await precoPara(banco, req.contexto.clinicaId, dados.linha, "imediato", { especialidade });
    if (!preco && dados.usarCartao) throw new ErroHttp(409, "SEM_PRECO", "O valor deste atendimento ainda não foi definido. Tente de novo mais tarde.");

    // Conferir e gravar acontecem sob a mesma trava, por paciente nesta clinica:
    // com clique duplo, o segundo pedido espera o primeiro e encontra a entrada.
    const entrada = await banco.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fila:${req.usuario.id}:${req.contexto.clinicaId}`}))`);

      // Ja esta na fila? Nao entra duas vezes.
      const [existente] = await tx
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
      if (existente) throw new ErroHttp(409, "JA_NA_FILA", "Você já está na fila desta clínica.");

      let cartaoId: string | null = null;
      let valorCombinado = preco?.valorCentavos ?? null;
      if (dados.usarCartao) {
        // CARTAO CADASTRADO: nada e cobrado agora. A consulta que nascer daqui
        // carrega o cartao e o valor combinado, e e debitada ao ser encerrada.
        await exigirSemPendencia(tx, req.usuario.id, req.contexto.clinicaId);
        const cartao = await cartaoAtivo(tx, req.usuario.id, req.contexto.clinicaId);
        if (!cartao) throw new ErroHttp(409, "SEM_CARTAO", "Você não tem cartão válido cadastrado. Cadastre um ou pague por Pix.");
        cartaoId = cartao.id;
      } else {
        // PIX: o pagamento precisa estar CONFIRMADO, ser desta pessoa, desta
        // clinica, e nao ter sido usado antes. Sem isso, entrar seria de graca.
        const [pagamento] = await tx
          .select({ id: pagamentos.id, status: pagamentos.status, pagadorId: pagamentos.pagadorId, consultaId: pagamentos.consultaId, valorCentavos: pagamentos.valorCentavos })
          .from(pagamentos)
          .where(and(eq(pagamentos.id, dados.pagamentoId!), eq(pagamentos.clinicaId, req.contexto.clinicaId)))
          .limit(1);
        if (!pagamento) throw new ErroHttp(404, "PAGAMENTO_NAO_ENCONTRADO", "Pagamento não encontrado nesta clínica.");
        if (pagamento.pagadorId !== req.usuario.id) throw new ErroHttp(403, "PAGAMENTO_DE_OUTRO", "Este pagamento não é seu.");
        if (pagamento.status !== "confirmado") {
          throw new ErroHttp(409, "PAGAMENTO_NAO_CONFIRMADO", "O pagamento ainda não foi confirmado. Aguarde a confirmação para entrar na fila.");
        }

        const [jaUsado] = await tx
          .select({ id: filaAtendimento.id })
          .from(filaAtendimento)
          .where(eq(filaAtendimento.pagamentoId, dados.pagamentoId!))
          .limit(1);
        if (jaUsado || pagamento.consultaId) {
          throw new ErroHttp(409, "PAGAMENTO_JA_USADO", "Este pagamento já foi usado em outro atendimento.");
        }
        // Quem pagou o pronto atendimento nao entra na fila de um especialista mais caro.
        if (preco && pagamento.valorCentavos < preco.valorCentavos) {
          throw new ErroHttp(409, "PAGAMENTO_DE_OUTRO_ATENDIMENTO", "Este pagamento é de outro tipo de atendimento. Refaça o pagamento para este.");
        }
        valorCombinado = pagamento.valorCentavos;
      }

      const [nova] = await tx
        .insert(filaAtendimento)
        .values({
          clinicaId: req.contexto.clinicaId,
          pacienteId: req.usuario.id,
          pagamentoId: dados.pagamentoId ?? null,
          cartaoId,
          valorCombinadoCentavos: valorCombinado,
          linha: dados.linha,
          especialidade,
          queixa: dados.queixa,
          consentimentoEm: new Date(),
          consentimentoVersao: VERSAO_DO_CONSENTIMENTO,
        })
        .returning({ id: filaAtendimento.id, entrouEm: filaAtendimento.entrouEm });

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "fila.entrou",
        tabela: "fila_atendimento",
        registroId: nova!.id,
        // O consentimento entra na auditoria: e o que prova, depois, que ele
        // existiu e sobre qual texto. A queixa nao entra: e dado de saude.
        detalhes: { consentimentoVersao: VERSAO_DO_CONSENTIMENTO, linha: dados.linha, especialidade, cobranca: cartaoId ? "cartao_ao_final" : "pix" },
        ip: req.ip,
      });
      return nova;
    });

    /**
     * O DESPACHO (ADR-0025): todo medico online que pode atender este pedido
     * e avisado. Se ninguem estiver online, avisa quem poderia estar.
     * O aviso nao leva nome nem queixa: so que ha alguem esperando, e em que.
     * Falha aqui nao pode desfazer a entrada na fila - o painel do medico
     * mostra o pedido de qualquer jeito.
     */
    let medicosOnline = 0;
    try {
      const online = await medicosAptos(req.contexto.clinicaId, dados.linha, especialidade, true);
      medicosOnline = online.length;
      const avisados = online.length > 0 ? online : (await medicosAptos(req.contexto.clinicaId, dados.linha, especialidade, false)).slice(0, MAXIMO_DE_AVISOS_SEM_NINGUEM_ONLINE);
      await notificar(
        banco,
        avisados.map((perfilId) => ({
          perfilId,
          clinicaId: req.contexto.clinicaId,
          tipo: "chamado_na_fila" as const,
          titulo: online.length > 0 ? "Paciente aguardando atendimento" : "Paciente aguardando e ninguém online",
          corpo: `${rotuloDoPedido(dados.linha, especialidade)}: há um paciente esperando agora. O primeiro médico que aceitar fica com o atendimento.`,
          link: `/c/${req.contexto.slug}/plantao`,
          chave: `chamado:${entrada!.id}`,
        })),
      );
    } catch (erro) {
      req.log.error({ err: erro, filaId: entrada!.id }, "despacho: nao foi possivel avisar os medicos");
    }

    void reply.code(201);
    return { ok: true as const, dados: { id: entrada!.id, entrouEm: entrada!.entrouEm.toISOString(), medicosOnline } };
  });

  /**
   * A fila. O paciente ve so a propria posicao; a equipe ve todo mundo.
   */
  app.get("/fila", { preHandler: dentroDaClinica }, async (req) => {
    await expirarEsquecidosDaFila(banco, req.contexto.clinicaId);

    const aguardando = await banco
      .select({
        id: filaAtendimento.id, pacienteId: filaAtendimento.pacienteId, entrouEm: filaAtendimento.entrouEm,
        prioridade: filaAtendimento.prioridade, queixa: filaAtendimento.queixa, status: filaAtendimento.status,
        linha: filaAtendimento.linha, especialidade: filaAtendimento.especialidade,
        // Modulo 12: quando o paciente e chamado, e por este id que a sala
        // de espera sabe para qual sala de video mandar ele.
        consultaId: filaAtendimento.consultaId,
        nome: perfis.nomeCompleto,
      })
      .from(filaAtendimento)
      .innerJoin(perfis, eq(perfis.id, filaAtendimento.pacienteId))
      .where(and(eq(filaAtendimento.clinicaId, req.contexto.clinicaId), inArray(filaAtendimento.status, ["aguardando", "chamado", "em_atendimento"])))
      .orderBy(asc(filaAtendimento.prioridade), asc(filaAtendimento.entrouEm));

    const souEquipe = ["medico", "recepcao", "admin_clinica"].includes(req.contexto.papel);
    const minha = aguardando.find((f) => f.pacienteId === req.usuario.id) ?? null;
    // A posicao e contada entre quem espera pelo MESMO tipo de medico.
    const naMinhaFrente = minha
      ? aguardando.filter((f) => f.status === "aguardando" && f.linha === minha.linha && f.especialidade === minha.especialidade && (f.prioridade < minha.prioridade || (f.prioridade === minha.prioridade && f.entrouEm < minha.entrouEm))).length
      : 0;
    const online = minha ? (await medicosAptos(req.contexto.clinicaId, minha.linha, minha.especialidade, true)).length : 0;

    const [abertos] = await banco
      .select({ n: count() })
      .from(plantoes)
      .where(and(eq(plantoes.clinicaId, req.contexto.clinicaId), eq(plantoes.status, "aberto"), gte(plantoes.fim, new Date())));

    // A queixa e informacao de saude: da equipe, so o medico le (LGPD, art. 6, III).
    // ADR-0025: e, entre os medicos, so quem esta online e pode atender aquele pedido.
    const meuPlantao = req.contexto.papeis.includes("medico") ? await plantaoAbertoDe(req.usuario.id, req.contexto.clinicaId) : null;
    const minhaAptidao = meuPlantao ? await aptidaoDe(req.usuario.id) : null;
    const leQueixa = (f: { linha: LinhaDeAtendimento; especialidade: string | null }) => Boolean(minhaAptidao && medicoAtende(minhaAptidao, f.linha, f.especialidade));

    return {
      ok: true as const,
      dados: {
        // Sem como receber, a tela avisa antes de o paciente contar o que sente.
        pagamentoDisponivel: await resolvedor.temRecebimento(req.contexto.clinicaId),
        totalAguardando: aguardando.filter((f) => f.status === "aguardando").length,
        /** Para o paciente na fila: medicos online que podem atende-lo. Para os demais: todos os online. */
        medicosDePlantao: minha ? online : abertos?.n ?? 0,
        minhaPosicao: minha ? naMinhaFrente + 1 : null,
        minhaSituacao: minha?.status ?? null,
        minhaEntradaId: minha?.id ?? null,
        minhaLinha: minha?.linha ?? null,
        minhaEspecialidade: minha?.especialidade ?? null,
        /** A consulta que nasceu do aceite. Nula enquanto ninguem aceitou. */
        minhaConsultaId: minha?.consultaId ?? null,
        // Estimativa simples e honesta: quantos estao na frente, dividido
        // pelos medicos que podem atender, vezes a duracao presumida.
        esperaEstimadaMinutos: minha && online > 0 ? Math.max(0, Math.round((naMinhaFrente * MINUTOS_DO_ATENDIMENTO) / online)) : null,
        // A lista completa e so para quem trabalha na clinica.
        lista: souEquipe
          ? aguardando.map((f, i) => ({
              id: f.id, posicao: i + 1, nome: f.nome, queixa: leQueixa(f) ? f.queixa : null, status: f.status, consultaId: f.consultaId,
              linha: f.linha, especialidade: f.especialidade,
              entrouEm: f.entrouEm.toISOString(),
              esperandoMinutos: Math.round((Date.now() - f.entrouEm.getTime()) / 60000),
            }))
          : [],
      },
    };
  });

  /**
   * O PAINEL DO MEDICO ONLINE (ADR-0025): os pedidos que ele pode aceitar,
   * do mais antigo ao mais novo. A tela consulta esta rota a cada poucos
   * segundos - um pedido aceito por outro medico simplesmente some dela.
   *
   * So para quem esta online: fora do plantao o medico nao ve queixa de
   * ninguem (LGPD, art. 6, III - ele nao vai atender).
   */
  app.get("/fila/chamados", { preHandler: soMedico }, async (req): Promise<Resposta<PainelDeChamados>> => {
    const plantao = await plantaoAbertoDe(req.usuario.id, req.contexto.clinicaId);

    const [meu] = await banco
      .select({ filaId: filaAtendimento.id, consultaId: filaAtendimento.consultaId, pacienteNome: perfis.nomeCompleto })
      .from(filaAtendimento)
      .innerJoin(consultas, eq(consultas.id, filaAtendimento.consultaId))
      .innerJoin(perfis, eq(perfis.id, filaAtendimento.pacienteId))
      .where(and(eq(filaAtendimento.clinicaId, req.contexto.clinicaId), eq(filaAtendimento.status, "em_atendimento"), eq(consultas.medicoId, req.usuario.id), eq(consultas.status, "em_andamento")))
      .limit(1);
    const emAtendimento = meu?.consultaId ? { filaId: meu.filaId, consultaId: meu.consultaId, pacienteNome: meu.pacienteNome } : null;

    if (!plantao) return { ok: true, dados: { online: false, plantaoId: null, emAtendimento, chamados: [] } };

    await expirarEsquecidosDaFila(banco, req.contexto.clinicaId);
    const aptidao = await aptidaoDe(req.usuario.id);
    const espera = await banco
      .select({
        id: filaAtendimento.id, linha: filaAtendimento.linha, especialidade: filaAtendimento.especialidade,
        pacienteNome: perfis.nomeCompleto, queixa: filaAtendimento.queixa, entrouEm: filaAtendimento.entrouEm,
      })
      .from(filaAtendimento)
      .innerJoin(perfis, eq(perfis.id, filaAtendimento.pacienteId))
      .where(and(eq(filaAtendimento.clinicaId, req.contexto.clinicaId), eq(filaAtendimento.status, "aguardando")))
      .orderBy(asc(filaAtendimento.prioridade), asc(filaAtendimento.entrouEm))
      .limit(200);

    const chamados: ChamadoNaFila[] = espera
      .filter((f) => medicoAtende(aptidao, f.linha, f.especialidade))
      .slice(0, 30)
      .map((f) => ({ ...f, entrouEm: f.entrouEm.toISOString(), esperandoMinutos: Math.round((Date.now() - f.entrouEm.getTime()) / 60000) }));

    return { ok: true, dados: { online: true, plantaoId: plantao.id, emAtendimento, chamados } };
  });

  /**
   * ACEITAR UM PEDIDO - o ponto delicado do modulo.
   *
   * O mesmo pedido aparece para varios medicos ao mesmo tempo, e dois podem
   * clicar no mesmo instante. So um pode ficar com o paciente.
   *
   * A solucao e do Postgres: SELECT ... FOR UPDATE SKIP LOCKED sobre a linha
   * da fila, com "status = 'aguardando'" no mesmo comando. A primeira
   * transacao tranca a linha; a segunda nao espera - PULA a linha trancada,
   * nao encontra nada e responde "outro medico ja aceitou". Depois que a
   * primeira grava, a linha deixa de estar "aguardando" e some do painel de
   * todo mundo.
   *
   * `filaId` nulo = "o proximo": o mais antigo que este medico pode atender.
   */
  async function aceitar(req: { usuario: { id: string }; contexto: { clinicaId: string; slug: string }; ip: string }, filaId: string | null) {
    // ADR-0016: o CRM pode ter vencido depois de o plantao abrir.
    await exigirCrmVerificado(banco, req.contexto.clinicaId, req.usuario.id);
    const plantao = await plantaoAbertoDe(req.usuario.id, req.contexto.clinicaId);
    if (!plantao) throw new ErroHttp(409, "SEM_PLANTAO_ABERTO", "Fique online antes de aceitar pacientes.");
    const aptidao = await aptidaoDe(req.usuario.id);
    // ADR-0026: a porcentagem do medico no momento em que ele aceita.
    const repasseMedicoBps = await percentualDoMedico(banco, req.contexto.clinicaId, req.usuario.id);

    const resultado = await banco.transaction(async (tx) => {
      /**
       * Paciente com outra consulta neste horario esbarra na trava do banco. No
       * "proximo" ele e pulado; sem isto, a fila inteira travaria nele. Se quem
       * esta ocupado e o proprio medico, ninguem adianta tentar.
       */
      const pulados: string[] = [];
      let pedido: PedidoNaFila | undefined;
      let consulta: { id: string } | undefined;
      const agora = new Date();

      for (;;) {
        const candidatos = (await tx.execute<PedidoNaFila>(sql`
          select id, paciente_id, linha, especialidade, valor_combinado_centavos, cartao_id, pagamento_id
          from fila_atendimento
          where clinica_id = ${req.contexto.clinicaId} and status = 'aguardando'
          ${filaId ? sql`and id = ${filaId}` : sql``}
          ${pulados.length ? sql`and id not in (${sql.join(pulados.map((p) => sql`${p}::uuid`), sql`, `)})` : sql``}
          and (
            (linha = 'pronto_atendimento' and ${aptidao.atendeProntoAtendimento})
            or (linha = 'teleconsulta' and especialidade in (${sql.join([...aptidao.especialidades, ""].map((e) => sql`${e}`), sql`, `)}))
          )
          order by prioridade asc, entrou_em asc
          limit 1
          for update skip locked
        `)) as unknown as PedidoNaFila[];
        pedido = candidatos[0];
        if (!pedido) return null;

        try {
          const p = pedido;
          [consulta] = await tx.transaction((sub) =>
            sub
              .insert(consultas)
              .values({
                clinicaId: req.contexto.clinicaId,
                pacienteId: p.paciente_id,
                medicoId: req.usuario.id,
                inicio: agora,
                fim: new Date(agora.getTime() + MINUTOS_DO_ATENDIMENTO * 60000),
                status: "em_andamento",
                repasseMedicoBps,
                linha: p.linha,
                especialidade: p.especialidade,
                // ADR-0023: quem entrou com cartao e debitado quando esta consulta for encerrada.
                ...(p.cartao_id && p.valor_combinado_centavos
                  ? { formaDeCobranca: "cartao_ao_final" as const, cartaoId: p.cartao_id, valorCombinadoCentavos: p.valor_combinado_centavos }
                  : { valorCombinadoCentavos: p.valor_combinado_centavos }),
                motivo: p.linha === "pronto_atendimento" ? "Pronto atendimento" : "Teleconsulta imediata",
                marcadoPor: req.usuario.id,
              })
              .returning({ id: consultas.id }),
          );
          break;
        } catch (erro) {
          const causa = (erro as { cause?: { code?: string; constraint_name?: string; constraint?: string } }).cause;
          if (causa?.code !== "23P01") throw erro;
          if (String(causa.constraint_name ?? causa.constraint ?? "").includes("medico")) {
            throw new ErroHttp(409, "MEDICO_COM_CONSULTA", "Você tem outra consulta neste horário. Conclua-a antes de aceitar outro paciente.");
          }
          if (filaId) throw new ErroHttp(409, "PACIENTE_OCUPADO", "Este paciente está em outra consulta agora. Tente outro pedido.");
          pulados.push(pedido.id);
        }
      }

      await tx
        .update(filaAtendimento)
        .set({ status: "em_atendimento", chamadoEm: agora, plantaoId: plantao.id, consultaId: consulta!.id })
        .where(eq(filaAtendimento.id, pedido.id));

      // O pagamento da fila (Pix) passa a apontar para a consulta que nasceu.
      if (pedido.pagamento_id) {
        await tx.update(pagamentos).set({ consultaId: consulta!.id, atualizadoEm: agora }).where(eq(pagamentos.id, pedido.pagamento_id));
      }

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: filaId ? "fila.aceitou" : "fila.chamou_proximo",
        tabela: "fila_atendimento",
        registroId: pedido.id,
        detalhes: { consultaId: consulta!.id, linha: pedido.linha, especialidade: pedido.especialidade },
        ip: req.ip,
      });
      await notificar(tx, {
        perfilId: pedido.paciente_id,
        clinicaId: req.contexto.clinicaId,
        tipo: "chamado_na_fila",
        titulo: "Um médico aceitou o seu atendimento",
        corpo: "Entre na sala: o médico já está esperando por você.",
        link: `/c/${req.contexto.slug}/consulta/${consulta!.id}`,
        chave: `aceito:${pedido.id}`,
      });

      return { filaId: pedido.id, consultaId: consulta!.id, pacienteId: pedido.paciente_id };
    });

    if (!resultado) return null;
    const [paciente] = await banco.select({ nome: perfis.nomeCompleto }).from(perfis).where(eq(perfis.id, resultado.pacienteId)).limit(1);
    return { ...resultado, pacienteNome: paciente?.nome ?? "" };
  }

  app.post("/fila/:id/aceitar", { preHandler: soMedico }, async (req) => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const resultado = await aceitar(req, id);
    if (!resultado) {
      // Nao esta mais aguardando (outro aceitou, o paciente desistiu) ou nunca foi para este medico.
      throw new ErroHttp(409, "JA_ACEITO", "Este atendimento não está mais disponível: outro médico já aceitou ou o paciente saiu da fila.");
    }
    return { ok: true as const, dados: { aceitou: true as const, ...resultado } };
  });

  app.post("/fila/proximo", { preHandler: soMedico }, async (req) => {
    const resultado = await aceitar(req, null);
    if (!resultado) return { ok: true as const, dados: { chamou: false as const } };
    return { ok: true as const, dados: { chamou: true as const, ...resultado } };
  });

  app.post("/fila/:id/desistir", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const motivo = z.object({ motivo: z.string().trim().max(200).optional() }).parse(req.body ?? {});

    const [f] = await banco
      .select({ status: filaAtendimento.status, pacienteId: filaAtendimento.pacienteId, pagamentoId: filaAtendimento.pagamentoId })
      .from(filaAtendimento)
      .where(and(eq(filaAtendimento.id, id), eq(filaAtendimento.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!f) throw new ErroHttp(404, "NAO_ENCONTRADO", "Entrada da fila não encontrada.");

    const souEquipe = ["recepcao", "admin_clinica"].includes(req.contexto.papel);
    if (f.pacienteId !== req.usuario.id && !souEquipe) throw new ErroHttp(403, "NAO_E_SUA", "Esta entrada da fila não é sua.");
    if (f.status !== "aguardando") throw new ErroHttp(409, "JA_EM_ATENDIMENTO", "O atendimento já começou. Fale com o profissional.");

    // A condicao de estado evita apagar o aceite que um medico acabou de fazer.
    const desistiu = await banco
      .update(filaAtendimento)
      .set({ status: "desistiu", encerradoEm: new Date(), observacao: motivo.motivo ?? null })
      .where(and(eq(filaAtendimento.id, id), eq(filaAtendimento.status, "aguardando")))
      .returning({ id: filaAtendimento.id });
    if (desistiu.length === 0) throw new ErroHttp(409, "JA_EM_ATENDIMENTO", "O atendimento acabou de começar. Fale com o profissional.");

    await registrarAuditoria(banco, {
      quem: req.usuario.id, clinicaId: req.contexto.clinicaId,
      acao: "fila.desistiu", tabela: "fila_atendimento", registroId: id,
      // O estorno nao e automatico: a clinica decide conforme a politica
      // dela (ADR-0012). Quem entrou com cartao nao pagou nada: nao ha o que devolver.
      detalhes: { motivo: motivo.motivo ?? null, pendenteDeEstorno: Boolean(f.pagamentoId) },
      ip: req.ip,
    });
    if (f.pagamentoId) {
      await registrarPendenciaDeEstorno(banco, { clinicaId: req.contexto.clinicaId, pagamentoId: f.pagamentoId, pacienteId: f.pacienteId, motivo: "fila: desistencia", ip: req.ip });
    }

    return { ok: true, dados: { status: "desistiu" } };
  });
}
