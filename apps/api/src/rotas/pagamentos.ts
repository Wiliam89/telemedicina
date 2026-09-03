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
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, consultas, pagamentos, perfis, precos, vinculos, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { calcularComissao, ErroDePagamento, escolherPreco, type ResolvedorDePagamento } from "../pagamento/index.js";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

/** Quanto tempo o horario fica reservado esperando o pagamento. */
const MINUTOS_DE_RESERVA = 20;

const esquemaPrecos = z.object({
  itens: z
    .array(
      z.object({
        tipo: z.enum(["agendada", "pronto_atendimento"]),
        medicoId: z.string().uuid().nullable().optional(),
        valorCentavos: z.number().int().min(100, "minimo R$ 1,00").max(1000000, "maximo R$ 10.000,00"),
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
  opcoes: { banco: Banco; autenticar: Autenticador; resolvedor: ResolvedorDePagamento; urlPublicaDaApi: string; segredoDoWebhook: string },
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

  app.put("/precos", { preHandler: [...dentroDaClinica, exigirPapel("admin_clinica")] }, async (req): Promise<Resposta<{ itens: number }>> => {
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

    return { ok: true, dados: { itens: itens.length } };
  });

  // --- cobranca -------------------------------------------------------------

  app.post("/consultas/:id/pagamento", { preHandler: dentroDaClinica }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const dados = z
      .object({
        metodo: z.enum(["pix", "cartao_credito"]),
        tokenDoCartao: z.string().min(1).optional(),
        parcelas: z.number().int().min(1).max(12).optional(),
      })
      .parse(req.body);

    const [consulta] = await banco
      .select({
        id: consultas.id, status: consultas.status, pacienteId: consultas.pacienteId, medicoId: consultas.medicoId,
        inicio: consultas.inicio, pagamentoId: consultas.pagamentoId,
        pagadorNome: perfis.nomeCompleto, pagadorCpf: perfis.cpf,
      })
      .from(consultas)
      .innerJoin(perfis, eq(perfis.id, consultas.pacienteId))
      .where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId)))
      .limit(1);

    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta nao encontrada nesta clinica.");
    if (consulta.pacienteId !== req.usuario.id && !["recepcao", "admin_clinica"].includes(req.contexto.papel)) {
      throw new ErroHttp(403, "NAO_E_SUA", "So o paciente ou a recepcao pagam esta consulta.");
    }
    if (consulta.status !== "aguardando_pagamento") {
      throw new ErroHttp(409, "NAO_AGUARDA_PAGAMENTO", `Esta consulta esta "${consulta.status}" - nao ha o que pagar.`);
    }

    // Preco: o do medico, se houver; senao o padrao da clinica.
    const tabela = await banco
      .select({ valorCentavos: precos.valorCentavos, comissaoPlataformaBps: precos.comissaoPlataformaBps, medicoId: precos.medicoId })
      .from(precos)
      .where(and(eq(precos.clinicaId, req.contexto.clinicaId), eq(precos.tipo, "agendada")));
    const preco = escolherPreco(tabela, consulta.medicoId);
    if (!preco) throw new ErroHttp(409, "SEM_PRECO", "Esta clinica ainda nao definiu o valor da consulta. Fale com a administracao.");

    const divisao = calcularComissao(preco.valorCentavos, preco.comissaoPlataformaBps);
    const chaveIdempotencia = randomUUID();

    let contexto;
    try {
      contexto = await resolvedor.para(req.contexto.clinicaId);
    } catch (erro) {
      traduzir(erro);
    }

    // Grava ANTES de chamar o provedor: se a chamada cair no meio, existe
    // registro do que foi tentado, com a chave de idempotencia.
    const [registro] = await banco
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
        chaveIdempotencia,
      })
      .returning({ id: pagamentos.id });

    let cobranca;
    try {
      cobranca = await contexto.provedor.cobrar(contexto.credenciais, {
        chaveIdempotencia,
        metodo: dados.metodo,
        valorCentavos: preco.valorCentavos,
        comissaoPlataformaCentavos: divisao.plataforma,
        descricao: `Consulta em ${req.contexto.nomeFantasia}`,
        pagador: { nome: consulta.pagadorNome, email: req.usuario.email ?? "sem-email@exemplo.com", cpf: consulta.pagadorCpf },
        ...(dados.tokenDoCartao ? { tokenDoCartao: dados.tokenDoCartao } : {}),
        ...(dados.parcelas ? { parcelas: dados.parcelas } : {}),
        expiraEmMinutos: MINUTOS_DE_RESERVA,
        urlDeNotificacao: `${opcoes.urlPublicaDaApi}/webhooks/pagamento`,
      });
    } catch (erro) {
      await banco.update(pagamentos).set({ status: "recusado", atualizadoEm: new Date() }).where(eq(pagamentos.id, registro!.id));
      traduzir(erro);
    }

    await banco.transaction(async (tx) => {
      await tx
        .update(pagamentos)
        .set({
          provedorId: cobranca.idNoProvedor,
          status: cobranca.status === "confirmado" ? "confirmado" : cobranca.status === "autorizado" ? "autorizado" : "pendente",
          pixCopiaECola: cobranca.pixCopiaECola ?? null,
          pixQrBase64: cobranca.pixQrBase64 ?? null,
          expiraEm: cobranca.expiraEm ?? null,
          provedorPayload: cobranca.bruto,
          ...(cobranca.status === "autorizado" ? { autorizadoEm: new Date() } : {}),
          ...(cobranca.status === "confirmado" ? { confirmadoEm: new Date() } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(pagamentos.id, registro!.id));

      await tx.update(consultas).set({ pagamentoId: registro!.id }).where(eq(consultas.id, consulta.id));

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "pagamento.criado",
        tabela: "pagamentos",
        registroId: registro!.id,
        detalhes: { metodo: dados.metodo, valorCentavos: preco.valorCentavos, provedor: contexto.provedor.nome },
        ip: req.ip,
      });
    });

    // Cartao autorizado ja confirma a consulta: o valor esta reservado, e a
    // captura acontece quando o atendimento e concluido.
    if (cobranca.status === "autorizado" || cobranca.status === "confirmado") {
      await confirmarConsultaPaga(banco, registro!.id);
    }

    void reply.code(201);
    return {
      ok: true as const,
      dados: {
        pagamentoId: registro!.id,
        status: cobranca.status,
        valorCentavos: preco.valorCentavos,
        pixCopiaECola: cobranca.pixCopiaECola ?? null,
        pixQrBase64: cobranca.pixQrBase64 ?? null,
        expiraEm: cobranca.expiraEm?.toISOString() ?? null,
        avisoDaClinica: contexto.avisoDeVencimento,
      },
    };
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

    if (req.contexto.papel !== "paciente") {
      throw new ErroHttp(403, "SO_PACIENTE", "So paciente paga pronto atendimento.");
    }

    const tabela = await banco
      .select({ valorCentavos: precos.valorCentavos, comissaoPlataformaBps: precos.comissaoPlataformaBps, medicoId: precos.medicoId })
      .from(precos)
      .where(and(eq(precos.clinicaId, req.contexto.clinicaId), eq(precos.tipo, "pronto_atendimento")));
    const preco = tabela.find((p) => p.medicoId === null);
    if (!preco) throw new ErroHttp(409, "SEM_PRECO", "Esta clinica ainda nao definiu o valor do pronto atendimento.");

    const [pessoa] = await banco
      .select({ nome: perfis.nomeCompleto, cpf: perfis.cpf })
      .from(perfis)
      .where(eq(perfis.id, req.usuario.id))
      .limit(1);

    const divisao = calcularComissao(preco.valorCentavos, preco.comissaoPlataformaBps);
    const chaveIdempotencia = randomUUID();

    let contexto;
    try {
      contexto = await resolvedor.para(req.contexto.clinicaId);
    } catch (erro) {
      traduzir(erro);
    }

    const [registro] = await banco
      .insert(pagamentos)
      .values({
        clinicaId: req.contexto.clinicaId,
        pagadorId: req.usuario.id,
        metodo: dados.metodo,
        valorCentavos: preco.valorCentavos,
        valorClinicaCentavos: divisao.clinica,
        valorPlataformaCentavos: divisao.plataforma,
        provedor: contexto.provedor.nome,
        chaveIdempotencia,
      })
      .returning({ id: pagamentos.id });

    let cobranca;
    try {
      cobranca = await contexto.provedor.cobrar(contexto.credenciais, {
        chaveIdempotencia,
        metodo: dados.metodo,
        valorCentavos: preco.valorCentavos,
        comissaoPlataformaCentavos: divisao.plataforma,
        descricao: `Pronto atendimento em ${req.contexto.nomeFantasia}`,
        pagador: { nome: pessoa?.nome ?? "Paciente", email: req.usuario.email ?? "sem-email@exemplo.com", cpf: pessoa?.cpf ?? null },
        ...(dados.tokenDoCartao ? { tokenDoCartao: dados.tokenDoCartao } : {}),
        expiraEmMinutos: 20,
        urlDeNotificacao: `${opcoes.urlPublicaDaApi}/webhooks/pagamento`,
      });
    } catch (erro) {
      await banco.update(pagamentos).set({ status: "recusado", atualizadoEm: new Date() }).where(eq(pagamentos.id, registro!.id));
      traduzir(erro);
    }

    await banco.transaction(async (tx) => {
      await tx
        .update(pagamentos)
        .set({
          provedorId: cobranca.idNoProvedor,
          status: cobranca.status === "confirmado" ? "confirmado" : cobranca.status === "autorizado" ? "autorizado" : "pendente",
          pixCopiaECola: cobranca.pixCopiaECola ?? null,
          pixQrBase64: cobranca.pixQrBase64 ?? null,
          expiraEm: cobranca.expiraEm ?? null,
          provedorPayload: cobranca.bruto,
          ...(cobranca.status === "confirmado" ? { confirmadoEm: new Date() } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(pagamentos.id, registro!.id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "pagamento.criado",
        tabela: "pagamentos",
        registroId: registro!.id,
        detalhes: { tipo: "pronto_atendimento", valorCentavos: preco.valorCentavos },
        ip: req.ip,
      });
    });

    void reply.code(201);
    return {
      ok: true as const,
      dados: {
        pagamentoId: registro!.id,
        status: cobranca.status,
        valorCentavos: preco.valorCentavos,
        pixCopiaECola: cobranca.pixCopiaECola ?? null,
        pixQrBase64: cobranca.pixQrBase64 ?? null,
        expiraEm: cobranca.expiraEm?.toISOString() ?? null,
      },
    };
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

    if (!p) throw new ErroHttp(404, "PAGAMENTO_NAO_ENCONTRADO", "Pagamento nao encontrado nesta clinica.");
    if (p.pagadorId !== req.usuario.id && !["recepcao", "admin_clinica"].includes(req.contexto.papel)) {
      throw new ErroHttp(403, "NAO_E_SEU", "Este pagamento nao e seu.");
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
    const corpoBruto = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const cabecalhos = req.headers as Record<string, string | undefined>;

    // Qual provedor assinou? Tentamos os que conhecemos.
    const { ProvedorLocalDePagamento } = await import("../pagamento/provedor-local.js");
    const { ProvedorMercadoPago } = await import("../pagamento/provedor-mercadopago.js");
    const candidatos = [new ProvedorMercadoPago(), new ProvedorLocalDePagamento()];
    const provedor = candidatos.find((p) => p.conferirNotificacao(cabecalhos, corpoBruto, opcoes.segredoDoWebhook));

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

    // Pagamento que nao conhecemos: respondemos 200 para o provedor parar
    // de reenviar, mas registramos - pode ser sinal de configuracao errada.
    if (!registro) {
      req.log.warn({ idNoProvedor: aviso.idNoProvedor }, "webhook de pagamento desconhecido");
      return reply.code(200).send({ ok: true, desconhecido: true });
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
      req.log.error({ erro }, "falha ao conferir pagamento no provedor");
      // 500 faz o provedor reenviar - que e o que queremos aqui.
      return reply.code(500).send({ ok: false });
    }

    return reply.code(200).send({ ok: true });
  });

  // --- apoio ----------------------------------------------------------------

  /** Aplica o estado vindo do provedor. Idempotente por construcao. */
  async function aplicarEstado(b: Banco, pagamentoId: string, status: string, bruto: Record<string, unknown>): Promise<void> {
    const mapa: Record<string, "pendente" | "autorizado" | "confirmado" | "recusado" | "estornado" | "expirado"> = {
      pendente: "pendente", autorizado: "autorizado", confirmado: "confirmado",
      recusado: "recusado", estornado: "estornado", expirado: "expirado",
    };
    const novo = mapa[status] ?? "pendente";

    const [atual] = await b.select({ status: pagamentos.status, clinicaId: pagamentos.clinicaId }).from(pagamentos).where(eq(pagamentos.id, pagamentoId)).limit(1);
    if (!atual || atual.status === novo) return; // ja aplicado: nada a fazer

    await b
      .update(pagamentos)
      .set({
        status: novo,
        provedorPayload: bruto,
        ...(novo === "confirmado" ? { confirmadoEm: new Date() } : {}),
        ...(novo === "autorizado" ? { autorizadoEm: new Date() } : {}),
        atualizadoEm: new Date(),
      })
      .where(eq(pagamentos.id, pagamentoId));

    await registrarAuditoria(b, {
      quem: null, // foi o provedor, nao uma pessoa
      clinicaId: atual.clinicaId,
      acao: `pagamento.${novo}`,
      tabela: "pagamentos",
      registroId: pagamentoId,
      detalhes: { de: atual.status, para: novo },
    });

    if (novo === "confirmado" || novo === "autorizado") await confirmarConsultaPaga(b, pagamentoId);
    if (novo === "recusado" || novo === "expirado" || novo === "estornado") await liberarConsulta(b, pagamentoId);
  }

  /** Pagamento em ordem: a consulta sai da reserva e vira agendada. */
  async function confirmarConsultaPaga(b: Banco, pagamentoId: string): Promise<void> {
    await b
      .update(consultas)
      .set({ status: "agendada", expiraReservaEm: null, atualizadoEm: new Date() })
      .where(and(eq(consultas.pagamentoId, pagamentoId), eq(consultas.status, "aguardando_pagamento")));
  }

  /** Pagamento que nao veio: o horario volta a ficar livre. */
  async function liberarConsulta(b: Banco, pagamentoId: string): Promise<void> {
    await b
      .update(consultas)
      .set({
        status: "cancelada",
        canceladoEm: new Date(),
        motivoCancelamento: "pagamento nao confirmado",
        expiraReservaEm: null,
        atualizadoEm: new Date(),
      })
      .where(and(eq(consultas.pagamentoId, pagamentoId), eq(consultas.status, "aguardando_pagamento")));
  }
}

export { MINUTOS_DE_RESERVA };
