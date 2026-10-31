/**
 * =====================================================================
 * ROTAS DE PAGAMENTO
 * =====================================================================
 *
 *   GET  /precos                     quanto custa nesta clinica
 *   PUT  /precos                     a administracao define
 *   POST /consultas/:id/pagamento    cria a cobranca da consulta reservada
 *   GET  /pagamentos/:id             estado atual (a tela consulta enquanto espera)
 *   POST /webhooks/pagamento         o provedor avisa - E A UNICA FONTE DA VERDADE
 *
 * A REGRA QUE ORGANIZA TUDO: o estado do pagamento vem do PROVEDOR, nunca
 * da tela. "O usuario voltou para a pagina de sucesso" nao e prova de
 * pagamento - e so uma pagina. Confirmacao chega por webhook, e o webhook
 * e conferido por assinatura antes de qualquer coisa.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consultas, filaAtendimento, pagamentos, perfis, precos, vinculos, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { calcularComissao, clinicaTemRecebimento, ErroDePagamento, escolherPreco, type Cobranca, type ContextoDePagamento, type PedidoDeCobranca, type ResolvedorDePagamento } from "../pagamento/index.js";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";
import { notificar } from "../notificacoes/index.js";
import { liberarReservasVencidas, MOTIVO_RESERVA_VENCIDA, registrarPendenciaDeEstorno, type Transacao } from "../reservas.js";

/** Quanto tempo o horario fica reservado esperando o pagamento. */
const MINUTOS_DE_RESERVA = 20;

const esquemaPrecos = z.object({
  itens: z
    .array(
      z.object({
        tipo: z.enum(["agendada", "pronto_atendimento"]),
        medicoId: z.string().uuid().nullable().optional(),
        valorCentavos: z.number().int().min(100, "mínimo R$ 1,00").max(1000000, "máximo R$ 10.000,00"),
        comissaoPlataformaBps: z.number().int().min(0).max(3000, "comissao maxima de 30%").default(0),
      }),
    )
    .max(50),
});

function traduzir(erro: unknown): never {
  if (erro instanceof ErroDePagamento) {
    const status = erro.codigo === "PROVEDOR_INDISPONIVEL" ? 503 : erro.codigo === "CLINICA_SEM_RECEBIMENTO" || erro.codigo === "TOKEN_VENCIDO" ? 409 : 400;
    throw new ErroHttp(status, erro.codigo, erro.message);
  }
  throw erro;
}

export async function rotasPagamentos(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; resolvedor: ResolvedorDePagamento; urlPublicaDaApi: string; segredoDoWebhook: string | null; producao: boolean },
): Promise<void> {
  const { banco, resolvedor } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);

  // --- precos ---------------------------------------------------------------

  app.get("/precos", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ tipo: string; medicoId: string | null; valorCentavos: number }[]>> => {
    const linhas = await banco
      .select({ tipo: precos.tipo, medicoId: precos.medicoId, valorCentavos: precos.valorCentavos })
      .from(precos)
      .where(eq(precos.clinicaId, req.contexto.clinicaId));
    // A comissao da plataforma nao aparece aqui: e assunto entre a clinica
    // e a plataforma, nao do paciente.
    return { ok: true, dados: linhas };
  });

  app.put("/precos", { preHandler: [...dentroDaClinica, exigirPapel("admin_clinica")] }, async (req): Promise<Resposta<{ itens: number; aviso: string | null }>> => {
    const { itens } = esquemaPrecos.parse(req.body);

    await banco.transaction(async (tx) => {
      await tx.delete(precos).where(eq(precos.clinicaId, req.contexto.clinicaId));
      if (itens.length > 0) {
        await tx.insert(precos).values(
          itens.map((i) => ({
            clinicaId: req.contexto.clinicaId,
            tipo: i.tipo,
            medicoId: i.medicoId ?? null,
            valorCentavos: i.valorCentavos,
            comissaoPlataformaBps: i.comissaoPlataformaBps,
          })),
        );
      }
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "precos.alterados",
        tabela: "precos",
        registroId: req.contexto.clinicaId,
        detalhes: { itens: itens.length },
        ip: req.ip,
      });
    });

    const semRecebimento = opcoes.producao && itens.length > 0 && !(await clinicaTemRecebimento(banco, req.contexto.clinicaId));
    return {
      ok: true,
      dados: {
        itens: itens.length,
        aviso: semRecebimento
          ? "Sua clínica ainda não tem conta de recebimento conectada. Até lá, as consultas agendadas são confirmadas sem cobrança pela plataforma, e o pronto atendimento fica indisponível."
          : null,
      },
    };
  });

  // --- cobranca -------------------------------------------------------------

  /**
   * Cartao fica recusado em producao ate existir a captura: a pre-autorizacao
   * reservaria o valor do paciente e nunca seria cobrada nem devolvida.
   */
  function exigirMetodoDisponivel(metodo: string): void {
    if (opcoes.producao && metodo === "cartao_credito") {
      throw new ErroHttp(409, "CARTAO_INDISPONIVEL", "Pagamento com cartão ainda não está disponível. Use o Pix.");
    }
  }

  /** O que a tela recebe sobre uma cobranca que ja existe: nao se cobra de novo. */
  function respostaDe(p: { id: string; status: string; valorCentavos: number; pixCopiaECola: string | null; pixQrBase64: string | null; expiraEm: Date | null }, avisoDaClinica: string | null = null) {
    return {
      ok: true as const,
      dados: {
        pagamentoId: p.id,
        status: p.status,
        valorCentavos: p.valorCentavos,
        pixCopiaECola: p.pixCopiaECola,
        pixQrBase64: p.pixQrBase64,
        expiraEm: p.expiraEm?.toISOString() ?? null,
        avisoDaClinica,
      },
    };
  }

  /**
   * Chama o provedor com a chave de idempotencia gravada e guarda o resultado.
   * Fica fora de transacao: nao se segura conexao do banco esperando a rede.
   *
   * Sem resposta do provedor nao da para saber se a cobranca nasceu. O registro
   * continua pendente, e a proxima tentativa usa a MESMA chave, entao o provedor
   * nao cria outra. So recusa definitiva vira "recusado".
   */
  async function efetivarCobranca(
    registroId: string,
    contexto: ContextoDePagamento,
    pedido: PedidoDeCobranca,
    aoGravar: { quem: string; clinicaId: string; ip: string; detalhes: Record<string, unknown> },
  ) {
    let cobranca: Cobranca;
    try {
      cobranca = await contexto.provedor.cobrar(contexto.credenciais, pedido);
    } catch (erro) {
      if (!(erro instanceof ErroDePagamento && erro.codigo === "PROVEDOR_INDISPONIVEL")) {
        await banco.update(pagamentos).set({ status: "recusado", atualizadoEm: new Date() }).where(eq(pagamentos.id, registroId));
      }
      traduzir(erro);
    }

    await banco.transaction(async (tx) => {
      await tx
        .update(pagamentos)
        .set({
          provedorId: cobranca.idNoProvedor,
          // O estado real: uma cobranca recusada ficaria "pendente" para sempre.
          status: cobranca.status,
          pixCopiaECola: cobranca.pixCopiaECola ?? null,
          pixQrBase64: cobranca.pixQrBase64 ?? null,
          expiraEm: cobranca.expiraEm ?? null,
          provedorPayload: cobranca.bruto,
          ...(cobranca.status === "autorizado" ? { autorizadoEm: new Date() } : {}),
          ...(cobranca.status === "confirmado" ? { confirmadoEm: new Date() } : {}),
          ...(cobranca.status === "estornado" ? { estornadoEm: new Date(), motivoEstorno: "informado pelo provedor" } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(pagamentos.id, registroId));

      await registrarAuditoria(tx, {
        quem: aoGravar.quem,
        clinicaId: aoGravar.clinicaId,
        acao: "pagamento.criado",
        tabela: "pagamentos",
        registroId,
        detalhes: { ...aoGravar.detalhes, provedor: contexto.provedor.nome },
        ip: aoGravar.ip,
      });
    });
    return cobranca;
  }

  app.post("/consultas/:id/pagamento", { preHandler: dentroDaClinica }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const dados = z
      .object({
        metodo: z.enum(["pix", "cartao_credito"]),
        tokenDoCartao: z.string().min(1).optional(),
        parcelas: z.number().int().min(1).max(12).optional(),
      })
      .parse(req.body);
    exigirMetodoDisponivel(dados.metodo);

    const [consulta] = await banco
      .select({
        id: consultas.id, status: consultas.status, pacienteId: consultas.pacienteId, medicoId: consultas.medicoId,
        inicio: consultas.inicio, pagamentoId: consultas.pagamentoId, expiraReservaEm: consultas.expiraReservaEm,
        pagadorNome: perfis.nomeCompleto, pagadorCpf: perfis.cpf,
      })
      .from(consultas)
      .innerJoin(perfis, eq(perfis.id, consultas.pacienteId))
      .where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId)))
      .limit(1);

    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta não encontrada nesta clínica.");
    if (consulta.pacienteId !== req.usuario.id && !["recepcao", "admin_clinica"].includes(req.contexto.papel)) {
      throw new ErroHttp(403, "NAO_E_SUA", "Só o paciente ou a recepção pagam esta consulta.");
    }
    if (consulta.status !== "aguardando_pagamento") {
      throw new ErroHttp(409, "NAO_AGUARDA_PAGAMENTO", `Esta consulta está "${consulta.status}": não há o que pagar.`);
    }
    // Reserva vencida nao se paga: o horario pode ja ser de outra pessoa.
    const fimDaReserva = consulta.expiraReservaEm;
    if (!fimDaReserva || fimDaReserva.getTime() <= Date.now()) {
      await liberarReservasVencidas(banco, { medicoId: consulta.medicoId, pacienteId: consulta.pacienteId });
      throw new ErroHttp(409, "RESERVA_VENCIDA", "O prazo para pagar este horário terminou. Marque a consulta novamente.");
    }

    // Preco: o do medico, se houver; senao o padrao da clinica.
    const tabela = await banco
      .select({ valorCentavos: precos.valorCentavos, comissaoPlataformaBps: precos.comissaoPlataformaBps, medicoId: precos.medicoId })
      .from(precos)
      .where(and(eq(precos.clinicaId, req.contexto.clinicaId), eq(precos.tipo, "agendada")));
    const preco = escolherPreco(tabela, consulta.medicoId);
    if (!preco) throw new ErroHttp(409, "SEM_PRECO", "Esta clínica ainda não definiu o valor da consulta. Fale com a administração.");

    const divisao = calcularComissao(preco.valorCentavos, preco.comissaoPlataformaBps);

    let contexto;
    try {
      contexto = await resolvedor.para(req.contexto.clinicaId);
    } catch (erro) {
      traduzir(erro);
    }

    /**
     * Clique duplo, duas abas ou a tela repetindo depois de um tempo esgotado:
     * tudo isso chega aqui como pedidos iguais, e o paciente nao pode pagar
     * duas vezes. A trava na linha da consulta faz o segundo pedido esperar o
     * primeiro gravar e encontrar a cobranca dele. A transacao termina antes de
     * chamar o provedor.
     */
    const registro = await banco.transaction(async (tx) => {
      const [travada] = await tx.select({ status: consultas.status }).from(consultas).where(eq(consultas.id, consulta.id)).for("update");
      if (travada?.status !== "aguardando_pagamento") throw new ErroHttp(409, "NAO_AGUARDA_PAGAMENTO", "Esta consulta não está mais aguardando pagamento.");

      const [ativa] = await tx
        .select()
        .from(pagamentos)
        .where(and(eq(pagamentos.consultaId, consulta.id), inArray(pagamentos.status, ["pendente", "autorizado", "confirmado"])))
        .orderBy(desc(pagamentos.criadoEm))
        .limit(1);
      if (ativa) {
        const vencida = ativa.status === "pendente" && ativa.expiraEm !== null && ativa.expiraEm.getTime() <= Date.now();
        if (!vencida) return { ...ativa, reaproveitada: true };
        await tx.update(pagamentos).set({ status: "expirado", atualizadoEm: new Date() }).where(eq(pagamentos.id, ativa.id));
      }

      // Grava ANTES de chamar o provedor: se a chamada cair no meio, existe
      // registro do que foi tentado, com a chave de idempotencia.
      const [novo] = await tx
        .insert(pagamentos)
        .values({
          clinicaId: req.contexto.clinicaId,
          pagadorId: req.usuario.id,
          consultaId: consulta.id,
          metodo: dados.metodo,
          valorCentavos: preco.valorCentavos,
          valorClinicaCentavos: divisao.clinica,
          valorPlataformaCentavos: divisao.plataforma,
          provedor: contexto.provedor.nome,
          chaveIdempotencia: randomUUID(),
        })
        .returning();
      await tx.update(consultas).set({ pagamentoId: novo!.id }).where(eq(consultas.id, consulta.id));
      return { ...novo!, reaproveitada: false };
    });

    // Ja existe cobranca: devolve a mesma. Sem provedorId, a tentativa anterior
    // ficou sem resposta e segue adiante com a mesma chave.
    if (registro.reaproveitada && registro.provedorId) return respostaDe(registro, contexto.avisoDeVencimento);

    const cobranca = await efetivarCobranca(
      registro.id,
      contexto,
      {
        chaveIdempotencia: registro.chaveIdempotencia,
        metodo: registro.metodo === "cartao_credito" ? "cartao_credito" : "pix",
        valorCentavos: registro.valorCentavos,
        comissaoPlataformaCentavos: registro.valorPlataformaCentavos,
        descricao: `Consulta em ${req.contexto.nomeFantasia}`,
        pagador: { nome: consulta.pagadorNome, email: req.usuario.email ?? "sem-email@exemplo.com", cpf: consulta.pagadorCpf },
        ...(dados.tokenDoCartao ? { tokenDoCartao: dados.tokenDoCartao } : {}),
        ...(dados.parcelas ? { parcelas: dados.parcelas } : {}),
        // O Pix nao pode valer mais que a reserva, senao o paciente paga por um
        // horario que ja foi liberado.
        expiraEmMinutos: Math.max(1, Math.ceil((fimDaReserva.getTime() - Date.now()) / 60000)),
        urlDeNotificacao: `${opcoes.urlPublicaDaApi}/webhooks/pagamento`,
      },
      { quem: req.usuario.id, clinicaId: req.contexto.clinicaId, ip: req.ip, detalhes: { metodo: dados.metodo, valorCentavos: registro.valorCentavos } },
    );

    // Cartao autorizado ja confirma a consulta: o valor esta reservado, e a
    // captura acontece quando o atendimento e concluido.
    if (cobranca.status === "autorizado" || cobranca.status === "confirmado") {
      await banco.transaction((tx) => confirmarConsultaPaga(tx, registro.id));
    }

    void reply.code(201);
    return respostaDe(
      { id: registro.id, status: cobranca.status, valorCentavos: registro.valorCentavos, pixCopiaECola: cobranca.pixCopiaECola ?? null, pixQrBase64: cobranca.pixQrBase64 ?? null, expiraEm: cobranca.expiraEm ?? null },
      contexto.avisoDeVencimento,
    );
  });

  /**
   * Cobranca AVULSA do pronto atendimento.
   *
   * Diferente da consulta agendada, aqui nao ha consulta ainda: o paciente
   * paga para entrar na fila, e a consulta so nasce quando um medico o
   * chama. Por isso o pagamento nasce sem `consultaId` - ele e "consumido"
   * na entrada da fila e passa a apontar para a consulta na chamada.
   */
  app.post("/pagamentos/pronto-atendimento", { preHandler: dentroDaClinica }, async (req, reply) => {
    const dados = z
      .object({ metodo: z.enum(["pix", "cartao_credito"]), tokenDoCartao: z.string().min(1).optional() })
      .parse(req.body);
    exigirMetodoDisponivel(dados.metodo);

    if (req.contexto.papel !== "paciente") {
      throw new ErroHttp(403, "SO_PACIENTE", "Só paciente paga pronto atendimento.");
    }

    const tabela = await banco
      .select({ valorCentavos: precos.valorCentavos, comissaoPlataformaBps: precos.comissaoPlataformaBps, medicoId: precos.medicoId })
      .from(precos)
      .where(and(eq(precos.clinicaId, req.contexto.clinicaId), eq(precos.tipo, "pronto_atendimento")));
    const preco = tabela.find((p) => p.medicoId === null);
    if (!preco) throw new ErroHttp(409, "SEM_PRECO", "Esta clínica ainda não definiu o valor do pronto atendimento.");

    const [pessoa] = await banco
      .select({ nome: perfis.nomeCompleto, cpf: perfis.cpf })
      .from(perfis)
      .where(eq(perfis.id, req.usuario.id))
      .limit(1);

    const divisao = calcularComissao(preco.valorCentavos, preco.comissaoPlataformaBps);

    let contexto;
    try {
      contexto = await resolvedor.para(req.contexto.clinicaId);
    } catch (erro) {
      traduzir(erro);
    }

    // Aqui nao ha consulta para travar: a trava e por paciente nesta clinica.
    // Cobranca em aberto, ou ja paga e ainda nao usada na fila, e reaproveitada.
    const registro = await banco.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pronto:${req.usuario.id}:${req.contexto.clinicaId}`}))`);
      const [ativa] = await tx
        .select()
        .from(pagamentos)
        .where(
          and(
            eq(pagamentos.pagadorId, req.usuario.id),
            eq(pagamentos.clinicaId, req.contexto.clinicaId),
            isNull(pagamentos.consultaId),
            inArray(pagamentos.status, ["pendente", "confirmado"]),
            notExists(tx.select({ id: filaAtendimento.id }).from(filaAtendimento).where(eq(filaAtendimento.pagamentoId, pagamentos.id))),
          ),
        )
        .orderBy(desc(pagamentos.criadoEm))
        .limit(1);
      if (ativa) {
        const vencida = ativa.status === "pendente" && ativa.expiraEm !== null && ativa.expiraEm.getTime() <= Date.now();
        if (!vencida) return { ...ativa, reaproveitada: true };
        await tx.update(pagamentos).set({ status: "expirado", atualizadoEm: new Date() }).where(eq(pagamentos.id, ativa.id));
      }
      const [novo] = await tx
        .insert(pagamentos)
        .values({
          clinicaId: req.contexto.clinicaId,
          pagadorId: req.usuario.id,
          metodo: dados.metodo,
          valorCentavos: preco.valorCentavos,
          valorClinicaCentavos: divisao.clinica,
          valorPlataformaCentavos: divisao.plataforma,
          provedor: contexto.provedor.nome,
          chaveIdempotencia: randomUUID(),
        })
        .returning();
      return { ...novo!, reaproveitada: false };
    });

    if (registro.reaproveitada && registro.provedorId) return respostaDe(registro);

    const cobranca = await efetivarCobranca(
      registro.id,
      contexto,
      {
        chaveIdempotencia: registro.chaveIdempotencia,
        metodo: registro.metodo === "cartao_credito" ? "cartao_credito" : "pix",
        valorCentavos: registro.valorCentavos,
        comissaoPlataformaCentavos: registro.valorPlataformaCentavos,
        descricao: `Pronto atendimento em ${req.contexto.nomeFantasia}`,
        pagador: { nome: pessoa?.nome ?? "Paciente", email: req.usuario.email ?? "sem-email@exemplo.com", cpf: pessoa?.cpf ?? null },
        ...(dados.tokenDoCartao ? { tokenDoCartao: dados.tokenDoCartao } : {}),
        expiraEmMinutos: 20,
        urlDeNotificacao: `${opcoes.urlPublicaDaApi}/webhooks/pagamento`,
      },
      { quem: req.usuario.id, clinicaId: req.contexto.clinicaId, ip: req.ip, detalhes: { tipo: "pronto_atendimento", valorCentavos: registro.valorCentavos } },
    );

    void reply.code(201);
    return respostaDe({ id: registro.id, status: cobranca.status, valorCentavos: registro.valorCentavos, pixCopiaECola: cobranca.pixCopiaECola ?? null, pixQrBase64: cobranca.pixQrBase64 ?? null, expiraEm: cobranca.expiraEm ?? null });
  });

  app.get("/pagamentos/:id", { preHandler: dentroDaClinica }, async (req) => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const [p] = await banco
      .select({
        id: pagamentos.id, status: pagamentos.status, metodo: pagamentos.metodo, valorCentavos: pagamentos.valorCentavos,
        pixCopiaECola: pagamentos.pixCopiaECola, pixQrBase64: pagamentos.pixQrBase64, expiraEm: pagamentos.expiraEm,
        pagadorId: pagamentos.pagadorId, consultaId: pagamentos.consultaId,
      })
      .from(pagamentos)
      .where(and(eq(pagamentos.id, id), eq(pagamentos.clinicaId, req.contexto.clinicaId)))
      .limit(1);

    if (!p) throw new ErroHttp(404, "PAGAMENTO_NAO_ENCONTRADO", "Pagamento não encontrado nesta clínica.");
    if (p.pagadorId !== req.usuario.id && !["recepcao", "admin_clinica"].includes(req.contexto.papel)) {
      throw new ErroHttp(403, "NAO_E_SEU", "Este pagamento não é seu.");
    }

    return {
      ok: true as const,
      dados: { ...p, expiraEm: p.expiraEm?.toISOString() ?? null },
    };
  });

  // --- webhook: a fonte da verdade -----------------------------------------

  /**
   * O provedor avisa aqui. Tres cuidados, nesta ordem:
   *
   *   1. CONFERIR A ASSINATURA. Sem isso, qualquer um que descubra esta URL
   *      cria pagamento fantasma e ganha atendimento de graca.
   *   2. RESPONDER 200 RAPIDO. O provedor reenvia se demorar - e reenviar
   *      significa processar de novo.
   *   3. SER IDEMPOTENTE. A mesma notificacao chega varias vezes; o
   *      processamento tem de dar no mesmo resultado.
   *
   * Esta rota e publica de proposito (o provedor nao tem login), mas so
   * aceita o que vem assinado.
   */
  app.post("/webhooks/pagamento", { config: { rawBody: true } }, async (req, reply) => {
    // Sem segredo nao ha como conferir nada: melhor recusar e o provedor reenviar.
    const segredo = opcoes.segredoDoWebhook;
    if (!segredo) {
      req.log.error("webhook de pagamento recebido, mas PAGAMENTO_WEBHOOK_SEGREDO nao esta definido");
      return reply.code(503).send({ ok: false });
    }

    const corpoBruto = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const cabecalhos = req.headers as Record<string, string | undefined>;

    // Qual provedor assinou? Tentamos os que conhecemos. O simulado nao entra
    // em producao: ele so existe para testar sem contratar um gateway.
    const { ProvedorLocalDePagamento } = await import("../pagamento/provedor-local.js");
    const { ProvedorMercadoPago } = await import("../pagamento/provedor-mercadopago.js");
    const candidatos = opcoes.producao ? [new ProvedorMercadoPago()] : [new ProvedorMercadoPago(), new ProvedorLocalDePagamento()];
    const provedor = candidatos.find((p) => p.conferirNotificacao(cabecalhos, corpoBruto, segredo));

    if (!provedor) {
      req.log.warn({ ip: req.ip }, "webhook de pagamento com assinatura invalida");
      return reply.code(401).send({ ok: false });
    }

    const aviso = provedor.lerNotificacao(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!aviso) return reply.code(200).send({ ok: true, ignorado: true });

    const [registro] = await banco
      .select({ id: pagamentos.id, clinicaId: pagamentos.clinicaId, status: pagamentos.status, consultaId: pagamentos.consultaId })
      .from(pagamentos)
      .where(and(eq(pagamentos.provedor, provedor.nome), eq(pagamentos.provedorId, aviso.idNoProvedor)))
      .limit(1);

    // Pagamento que nao conhecemos: pode ser so o aviso chegando antes de a API
    // gravar o id que o provedor acabou de devolver. Responder 200 perderia esse
    // pagamento para sempre; o 404 faz o provedor tentar de novo mais tarde.
    if (!registro) {
      req.log.warn({ idNoProvedor: aviso.idNoProvedor }, "webhook de pagamento desconhecido");
      return reply.code(404).send({ ok: false, desconhecido: true });
    }

    // Vamos ao provedor perguntar o estado real: o corpo da notificacao diz
    // "algo mudou", nao "esta pago". Confiar no corpo seria confiar em quem
    // pode ter forjado o valor.
    let contexto;
    try {
      contexto = await resolvedor.para(registro.clinicaId);
      const atual = await contexto.provedor.consultar(contexto.credenciais, aviso.idNoProvedor);
      await aplicarEstado(banco, registro.id, atual.status, atual.bruto);
    } catch (erro) {
      req.log.error({ err: erro }, "falha ao conferir pagamento no provedor");
      // 500 faz o provedor reenviar - que e o que queremos aqui.
      return reply.code(500).send({ ok: false });
    }

    return reply.code(200).send({ ok: true });
  });

  // --- apoio ----------------------------------------------------------------

  /**
   * Aplica o estado vindo do provedor, tudo numa transacao so: se o processo
   * cair no meio, nada fica pela metade e o reenvio do aviso refaz o trabalho.
   *
   * O provedor pode avisar fora de ordem, entao so as mudancas abaixo valem. Um
   * aviso atrasado de "pendente" nao pode desfazer um "confirmado".
   */
  async function aplicarEstado(b: Banco, pagamentoId: string, status: string, bruto: Record<string, unknown>): Promise<void> {
    const novo = ESTADOS_CONHECIDOS.find((e) => e === status);
    if (!novo) return;

    await b.transaction(async (tx) => {
      const [atual] = await tx.select({ status: pagamentos.status, clinicaId: pagamentos.clinicaId }).from(pagamentos).where(eq(pagamentos.id, pagamentoId)).for("update");
      if (!atual) return;

      if (atual.status !== novo) {
        if (!TRANSICOES_DO_PAGAMENTO[atual.status].includes(novo)) return;

        const agora = new Date();
        await tx
          .update(pagamentos)
          .set({
            status: novo,
            provedorPayload: bruto,
            ...(novo === "confirmado" ? { confirmadoEm: agora } : {}),
            ...(novo === "autorizado" ? { autorizadoEm: agora } : {}),
            ...(novo === "estornado" ? { estornadoEm: agora, motivoEstorno: "informado pelo provedor" } : {}),
            atualizadoEm: agora,
          })
          .where(eq(pagamentos.id, pagamentoId));

        await registrarAuditoria(tx, {
          quem: null, // foi o provedor, nao uma pessoa
          clinicaId: atual.clinicaId,
          acao: `pagamento.${novo}`,
          tabela: "pagamentos",
          registroId: pagamentoId,
          detalhes: { de: atual.status, para: novo },
        });
      }

      if (novo === "confirmado" || novo === "autorizado") await confirmarConsultaPaga(tx, pagamentoId);
      if (novo === "recusado" || novo === "expirado" || novo === "estornado") await liberarConsulta(tx, pagamentoId);
      if (novo === "estornado" && atual.status !== novo) await tratarEstorno(tx, pagamentoId, atual.clinicaId);
    });
  }

  /**
   * Pagamento em ordem: a consulta sai da reserva e vira agendada.
   *
   * PAGAMENTO TARDIO: a reserva pode ter vencido enquanto o banco processava o
   * Pix. Se o horario continua livre, a consulta volta. Se ja e de outra pessoa,
   * ou se alguem cancelou de proposito, o dinheiro fica registrado como pendencia
   * e a clinica e avisada. Sem isto, o paciente pagaria e ficaria sem consulta,
   * sem nenhum aviso.
   */
  async function confirmarConsultaPaga(tx: Transacao, pagamentoId: string): Promise<void> {
    // A busca sai do pagamento: a consulta pode apontar para uma cobranca mais
    // nova, que substituiu este Pix vencido, e ele ainda assim pode ter sido pago.
    const [c] = await tx
      .select({ id: consultas.id, status: consultas.status, motivo: consultas.motivoCancelamento, inicio: consultas.inicio, clinicaId: consultas.clinicaId, pacienteId: consultas.pacienteId, pagamentoAtual: consultas.pagamentoId })
      .from(pagamentos)
      .innerJoin(consultas, eq(consultas.id, pagamentos.consultaId))
      .where(eq(pagamentos.id, pagamentoId))
      .limit(1);
    if (!c) return; // pagamento da fila, ainda sem consulta

    if (c.status === "aguardando_pagamento") {
      await tx.update(consultas).set({ status: "agendada", expiraReservaEm: null, pagamentoId, atualizadoEm: new Date() }).where(eq(consultas.id, c.id));
      return;
    }
    if (c.status !== "cancelada") {
      // Consulta ja garantida por outra cobranca: este dinheiro entrou a mais.
      if (c.pagamentoAtual && c.pagamentoAtual !== pagamentoId) {
        await registrarPendenciaDeEstorno(tx, { clinicaId: c.clinicaId, pagamentoId, pacienteId: c.pacienteId, consultaId: c.id, motivo: "segundo pagamento da mesma consulta" });
      }
      return;
    }

    if (c.motivo === MOTIVO_RESERVA_VENCIDA && c.inicio.getTime() > Date.now()) {
      try {
        // Subtransacao: se a trava do banco recusar, so esta parte e desfeita.
        await tx.transaction(async (sub) => {
          await sub
            .update(consultas)
            .set({ status: "agendada", canceladoEm: null, canceladoPor: null, motivoCancelamento: null, pagamentoId, atualizadoEm: new Date() })
            .where(eq(consultas.id, c.id));
          await registrarAuditoria(sub, { quem: null, clinicaId: c.clinicaId, acao: "consulta.reativada_por_pagamento", tabela: "consultas", registroId: c.id, detalhes: { pagamentoId } });
          await notificar(sub, {
            perfilId: c.pacienteId,
            clinicaId: c.clinicaId,
            tipo: "consulta_marcada",
            titulo: "Pagamento confirmado: sua consulta está marcada",
            corpo: "O pagamento chegou depois do prazo, mas o horário ainda estava livre e foi confirmado para você.",
            link: null,
            chave: `consulta_reativada:${c.id}:${pagamentoId}`,
          });
        });
        return;
      } catch (erro) {
        const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
        if (codigo !== "23P01") throw erro;
      }
    }

    await registrarPendenciaDeEstorno(tx, {
      clinicaId: c.clinicaId,
      pagamentoId,
      pacienteId: c.pacienteId,
      consultaId: c.id,
      motivo: c.motivo === MOTIVO_RESERVA_VENCIDA ? "pagamento depois do prazo, horario indisponivel" : "pagamento de consulta cancelada",
    });
  }

  /**
   * O provedor devolveu o dinheiro. Quem esta na fila sai dela, e a clinica fica
   * sabendo das consultas ja marcadas: cancelar ou manter e decisao dela (ADR-0021).
   */
  async function tratarEstorno(tx: Transacao, pagamentoId: string, clinicaId: string): Promise<void> {
    await tx
      .update(filaAtendimento)
      .set({ status: "desistiu", encerradoEm: new Date(), observacao: "pagamento estornado" })
      .where(and(eq(filaAtendimento.pagamentoId, pagamentoId), eq(filaAtendimento.status, "aguardando")));

    const administradores = await tx
      .select({ perfilId: vinculos.perfilId })
      .from(vinculos)
      .where(and(eq(vinculos.clinicaId, clinicaId), eq(vinculos.papel, "admin_clinica"), eq(vinculos.status, "ativo")));
    await notificar(
      tx,
      administradores.map((a) => ({
        perfilId: a.perfilId,
        clinicaId,
        tipo: "consulta_cancelada" as const,
        titulo: "Pagamento estornado",
        corpo: "O provedor devolveu um pagamento. Se havia consulta marcada, confira na agenda se ela deve continuar.",
        link: null,
        chave: `estorno:${pagamentoId}`,
      })),
    );
  }

  /** Pagamento que nao veio: o horario volta a ficar livre. */
  async function liberarConsulta(tx: Transacao, pagamentoId: string): Promise<void> {
    await tx
      .update(consultas)
      .set({
        status: "cancelada",
        canceladoEm: new Date(),
        motivoCancelamento: MOTIVO_RESERVA_VENCIDA,
        expiraReservaEm: null,
        atualizadoEm: new Date(),
      })
      .where(and(eq(consultas.pagamentoId, pagamentoId), eq(consultas.status, "aguardando_pagamento")));
  }
}

type EstadoDoPagamento = "pendente" | "autorizado" | "confirmado" | "recusado" | "estornado" | "expirado";

const ESTADOS_CONHECIDOS: EstadoDoPagamento[] = ["pendente", "autorizado", "confirmado", "recusado", "estornado", "expirado"];

const TRANSICOES_DO_PAGAMENTO: Record<EstadoDoPagamento, EstadoDoPagamento[]> = {
  pendente: ["autorizado", "confirmado", "recusado", "estornado", "expirado"],
  autorizado: ["confirmado", "recusado", "estornado", "expirado"],
  confirmado: ["estornado"],
  // O provedor tem a palavra final: Pix dado como vencido aqui pode ter sido pago la.
  recusado: ["confirmado", "autorizado"],
  expirado: ["confirmado", "autorizado"],
  estornado: [],
};

export { MINUTOS_DE_RESERVA };
