/**
 * =====================================================================
 * COBRANCA: CARTAO CADASTRADO, DEBITADO AO FINAL DA CONSULTA (ADR-0023)
 * =====================================================================
 *
 * Quem cadastrou cartao nao paga antes: marca a consulta (ou entra na fila)
 * com o valor combinado, e a cobranca acontece quando o medico encerra.
 *
 * O QUE ESTE ARQUIVO GARANTE:
 *
 * 1. UMA COBRANCA SO. A consulta e trancada (FOR UPDATE SKIP LOCKED) antes
 *    de o registro do pagamento nascer, e o registro nasce ANTES de chamar o
 *    provedor, com a chave de idempotencia. Duas copias da API, o agendador
 *    e o gatilho do encerramento rodando juntos resultam em um debito.
 *
 * 2. FALHA TEM SAIDA. Cartao recusado nao desfaz a consulta (ela aconteceu):
 *    vira pendencia, o paciente e avisado e paga por Pix - e nao marca nova
 *    consulta enquanto a pendencia existir.
 *
 * 3. O VALOR E O COMBINADO. Cobra-se o que foi mostrado ao paciente quando
 *    ele marcou, nao o que a tabela de precos diz hoje.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { cartoesSalvos, clinicas, consultas, pagamentos, perfis, precos, type Banco } from "@tele/db";
import { tipoDePreco, type LinhaDeAtendimento, type ModoDeAtendimento } from "@tele/shared/atendimento";
import { cartaoVencido, type PendenciaDePagamento } from "@tele/shared/cobranca";
import { registrarAuditoria } from "./auditoria.js";
import { ErroHttp } from "./erros.js";
import { notificar } from "./notificacoes/index.js";
import { ErroDePagamento, escolherPreco, type ResolvedorDePagamento } from "./pagamento/index.js";
import type { PrecoAplicavel } from "./pagamento/precificacao.js";

type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

/** Depois deste tempo sem o provedor responder, a tentativa vira pendencia para o paciente. */
const HORAS_ATE_DESISTIR_DO_PROVEDOR = 24;
/**
 * Uma tentativa registrada ha menos tempo que isto ainda esta falando com o
 * provedor (ele tem 20 s para responder): outra copia da API nao mexe nela.
 * So depois deste prazo ela e tratada como interrompida e repetida, com a
 * MESMA chave de idempotencia.
 */
const SEGUNDOS_DE_TENTATIVA_EM_CURSO = 90;

/** O preco que vale para este atendimento: do medico, da especialidade ou o padrao. */
export async function precoPara(
  b: Executor,
  clinicaId: string,
  linha: LinhaDeAtendimento,
  modo: ModoDeAtendimento,
  quem: { medicoId?: string | null; especialidade?: string | null } = {},
): Promise<PrecoAplicavel | null> {
  const tabela = await b
    .select({ valorCentavos: precos.valorCentavos, comissaoPlataformaBps: precos.comissaoPlataformaBps, medicoId: precos.medicoId, especialidade: precos.especialidade })
    .from(precos)
    .where(and(eq(precos.clinicaId, clinicaId), eq(precos.tipo, tipoDePreco(linha, modo))));
  return escolherPreco(tabela, quem.medicoId ?? null, linha === "teleconsulta" ? quem.especialidade ?? null : null);
}

/** O cartao em uso da pessoa nesta clinica. Vencido conta como nao ter. */
export async function cartaoAtivo(b: Executor, perfilId: string, clinicaId: string) {
  const [c] = await b
    .select()
    .from(cartoesSalvos)
    .where(and(eq(cartoesSalvos.perfilId, perfilId), eq(cartoesSalvos.clinicaId, clinicaId), eq(cartoesSalvos.status, "ativo")))
    .limit(1);
  if (!c || cartaoVencido(c.validadeMes, c.validadeAno)) return null;
  return c;
}

/**
 * Consultas ja realizadas cuja cobranca no cartao NAO passou: houve tentativa
 * recusada e nenhum pagamento confirmado depois.
 */
export async function pendenciasDePagamento(b: Executor, perfilId: string, clinicaId: string): Promise<PendenciaDePagamento[]> {
  const linhas = await b
    .select({ consultaId: consultas.id, realizadaEm: consultas.inicio, valorCentavos: consultas.valorCombinadoCentavos, medicoNome: perfis.nomeCompleto })
    .from(consultas)
    .innerJoin(perfis, eq(perfis.id, consultas.medicoId))
    .where(
      and(
        eq(consultas.pacienteId, perfilId),
        eq(consultas.clinicaId, clinicaId),
        eq(consultas.status, "concluida"),
        eq(consultas.formaDeCobranca, "cartao_ao_final"),
        sql`exists (select 1 from pagamentos p where p.consulta_id = ${consultas.id} and p.status = 'recusado')`,
        sql`not exists (select 1 from pagamentos p where p.consulta_id = ${consultas.id} and p.status in ('confirmado', 'autorizado'))`,
      ),
    )
    .orderBy(desc(consultas.inicio))
    .limit(20);
  return linhas.map((l) => ({ consultaId: l.consultaId, realizadaEm: l.realizadaEm.toISOString(), valorCentavos: l.valorCentavos ?? 0, medicoNome: l.medicoNome }));
}

/** Quem deve uma consulta nao marca outra: paga primeiro. */
export async function exigirSemPendencia(b: Executor, perfilId: string, clinicaId: string): Promise<void> {
  const [primeira] = await pendenciasDePagamento(b, perfilId, clinicaId);
  if (primeira) {
    throw new ErroHttp(402, "PAGAMENTO_PENDENTE", "Há uma consulta anterior com pagamento pendente. Regularize-a para continuar.", { consultaId: primeira.consultaId });
  }
}

export interface OpcoesDaCobranca {
  urlDeNotificacao: string;
  /** So esta consulta (gatilho do encerramento). Ausente = todas as pendentes (agendador). */
  consultaId?: string;
  log?: { error: (o: unknown, m: string) => void };
}

/**
 * Debita o cartao das consultas concluidas que ainda nao foram cobradas.
 * Chamada pelo agendador (a cada minuto) e logo depois de cada encerramento.
 * Segura para rodar em varias copias da API ao mesmo tempo.
 */
export async function cobrarConsultasConcluidas(banco: Banco, resolvedor: ResolvedorDePagamento, opcoes: OpcoesDaCobranca): Promise<{ cobradas: number; recusadas: number; adiadas: number }> {
  const resultado = { cobradas: 0, recusadas: 0, adiadas: 0 };

  // Na rodada do agendador, antes de cobrar o que falta, resolve o que ficou no meio do caminho.
  if (!opcoes.consultaId) {
    try {
      const r = await conciliarCobrancasPendentes(banco, resolvedor, new Date(), opcoes.log);
      resultado.cobradas += r.confirmadas;
      resultado.recusadas += r.recusadas;
    } catch (erro) {
      opcoes.log?.error({ err: erro }, "conciliacao das cobrancas no cartao falhou");
    }
  }

  const candidatas = await banco
    .select({ id: consultas.id })
    .from(consultas)
    .where(
      and(
        eq(consultas.status, "concluida"),
        eq(consultas.formaDeCobranca, "cartao_ao_final"),
        opcoes.consultaId ? eq(consultas.id, opcoes.consultaId) : undefined,
        // Ja resolvida (paga, recusada ou devolvida), ou aguardando o provedor responder.
        sql`not exists (
          select 1 from pagamentos p where p.consulta_id = ${consultas.id}
            and (p.status in ('confirmado', 'autorizado', 'recusado', 'estornado') or (p.status = 'pendente' and p.provedor_id is not null))
        )`,
      ),
    )
    .limit(25);

  for (const { id } of candidatas) {
    try {
      const r = await cobrarUma(banco, resolvedor, id, opcoes.urlDeNotificacao);
      if (r === "cobrada") resultado.cobradas++;
      else if (r === "recusada") resultado.recusadas++;
      else if (r === "adiada") resultado.adiadas++;
    } catch (erro) {
      // Uma consulta com problema nao pode impedir a cobranca das outras.
      opcoes.log?.error({ err: erro, consultaId: id }, "cobranca ao final da consulta falhou");
      resultado.adiadas++;
    }
  }
  return resultado;
}

/** Uma cobranca no cartao "em analise" no provedor ha mais que isto e conferida direto com ele. */
const MINUTOS_ATE_CONCILIAR = 10;

/**
 * CONCILIACAO. O provedor pode responder "em analise" e decidir depois; o
 * aviso dessa decisao pode se perder. Sem isto, a consulta nunca seria cobrada
 * nem viraria pendencia. A cada rodada, as cobrancas no cartao paradas ha
 * mais de 10 minutos sao consultadas no provedor.
 */
export async function conciliarCobrancasPendentes(banco: Banco, resolvedor: ResolvedorDePagamento, agora: Date = new Date(), log?: OpcoesDaCobranca["log"]): Promise<{ confirmadas: number; recusadas: number }> {
  const r = { confirmadas: 0, recusadas: 0 };
  const paradas = await banco
    .select({ id: pagamentos.id, clinicaId: pagamentos.clinicaId, provedorId: pagamentos.provedorId, consultaId: pagamentos.consultaId, pagadorId: pagamentos.pagadorId, cartaoId: pagamentos.cartaoId })
    .from(pagamentos)
    .where(
      and(
        eq(pagamentos.status, "pendente"),
        eq(pagamentos.metodo, "cartao_credito"),
        sql`${pagamentos.cartaoId} is not null and ${pagamentos.provedorId} is not null`,
        sql`${pagamentos.atualizadoEm} < ${new Date(agora.getTime() - MINUTOS_ATE_CONCILIAR * 60000).toISOString()}::timestamptz`,
      ),
    )
    .limit(25);

  for (const p of paradas) {
    // Um pagamento com problema nao pode impedir a conciliacao dos outros.
    let atual;
    try {
      const contexto = await resolvedor.para(p.clinicaId);
      atual = await contexto.provedor.consultar(contexto.credenciais, p.provedorId!);
    } catch (erro) {
      log?.error({ err: erro, pagamentoId: p.id }, "conciliacao: nao foi possivel consultar o provedor");
      continue;
    }
    const status = atual.status === "confirmado" || atual.status === "autorizado" ? "confirmado" : atual.status === "recusado" || atual.status === "expirado" ? "recusado" : null;

    await banco.transaction(async (tx) => {
      const data = new Date();
      if (!status) {
        // Continua em analise: so marca que foi conferida, para nao consultar a cada minuto.
        await tx.update(pagamentos).set({ atualizadoEm: data }).where(and(eq(pagamentos.id, p.id), eq(pagamentos.status, "pendente")));
        return;
      }
      const mudou = await tx
        .update(pagamentos)
        .set({ status, provedorPayload: atual.bruto, ...(status === "confirmado" ? { confirmadoEm: data } : {}), atualizadoEm: data })
        .where(and(eq(pagamentos.id, p.id), eq(pagamentos.status, "pendente")))
        .returning({ id: pagamentos.id });
      if (mudou.length === 0) return;
      if (status === "confirmado") r.confirmadas++;
      else r.recusadas++;
      await registrarAuditoria(tx, { quem: null, clinicaId: p.clinicaId, acao: status === "confirmado" ? "pagamento.cartao_debitado" : "pagamento.cartao_recusado", tabela: "pagamentos", registroId: p.id, detalhes: { consultaId: p.consultaId, conciliado: true } });
      const [dados] = await tx.select({ slug: clinicas.slug, ultimos4: cartoesSalvos.ultimos4 }).from(clinicas).leftJoin(cartoesSalvos, eq(cartoesSalvos.id, p.cartaoId!)).where(eq(clinicas.id, p.clinicaId)).limit(1);
      await notificar(tx, {
        perfilId: p.pagadorId,
        clinicaId: p.clinicaId,
        tipo: "pagamento",
        titulo: status === "confirmado" ? "Consulta paga no cartão" : "Não conseguimos cobrar o seu cartão",
        corpo:
          status === "confirmado"
            ? `O valor da sua consulta foi debitado no cartão final ${dados?.ultimos4 ?? ""}.`
            : `A cobrança no cartão final ${dados?.ultimos4 ?? ""} não foi aprovada. Pague a consulta por Pix para continuar usando a plataforma.`,
        link: status === "confirmado" || !p.consultaId ? null : `/c/${dados?.slug ?? ""}/pagamento/${p.consultaId}`,
        chave: `cobranca_final:${p.id}:${status}`,
      });
    });
  }
  return r;
}

async function cobrarUma(banco: Banco, resolvedor: ResolvedorDePagamento, consultaId: string, urlDeNotificacao: string): Promise<"cobrada" | "recusada" | "adiada" | "ignorada"> {
  // 1. Tranca a consulta, confere de novo e registra a tentativa - tudo junto.
  const preparo = await banco.transaction(async (tx) => {
    const [c] = await tx.execute<{ id: string; clinica_id: string; paciente_id: string; cartao_id: string | null; valor: number | null }>(sql`
      select id, clinica_id, paciente_id, cartao_id, valor_combinado_centavos as valor
      from consultas
      where id = ${consultaId} and status = 'concluida' and forma_de_cobranca = 'cartao_ao_final'
      for update skip locked
    `) as unknown as { id: string; clinica_id: string; paciente_id: string; cartao_id: string | null; valor: number | null }[];
    if (!c || !c.cartao_id || !c.valor) return null;

    const existentes = await tx
      .select()
      .from(pagamentos)
      .where(and(eq(pagamentos.consultaId, consultaId), inArray(pagamentos.status, ["pendente", "autorizado", "confirmado", "recusado", "estornado"])))
      .orderBy(desc(pagamentos.criadoEm));
    if (existentes.some((p) => p.status !== "pendente" || p.provedorId !== null)) return null;

    let [cartao] = await tx.select().from(cartoesSalvos).where(eq(cartoesSalvos.id, c.cartao_id)).limit(1);
    if (!cartao) return null;
    // Cartao trocado ou removido depois da consulta: nunca se cobra um cartao que a pessoa tirou.
    if (cartao.status !== "ativo") {
      const [atual] = await tx
        .select()
        .from(cartoesSalvos)
        .where(and(eq(cartoesSalvos.perfilId, c.paciente_id), eq(cartoesSalvos.clinicaId, c.clinica_id), eq(cartoesSalvos.status, "ativo")))
        .limit(1);
      if (!atual) return null;
      await tx.update(consultas).set({ cartaoId: atual.id }).where(eq(consultas.id, consultaId));
      cartao = atual;
    }

    // Tentativa anterior que caiu antes de o provedor responder: repete com a MESMA chave.
    // Se ela e recente, outra copia da API esta no meio dela: esta aqui nao faz nada.
    let registro = existentes[0];
    if (registro && Date.now() - registro.atualizadoEm.getTime() < SEGUNDOS_DE_TENTATIVA_EM_CURSO * 1000) return null;
    if (registro) {
      // Marca a retomada: duas copias nao retomam a mesma tentativa ao mesmo tempo.
      // O registro passa a apontar para o cartao que sera de fato usado (pode ter sido trocado).
      await tx.update(pagamentos).set({ atualizadoEm: new Date(), cartaoId: cartao.id }).where(eq(pagamentos.id, registro.id));
    } else {
      [registro] = await tx
        .insert(pagamentos)
        .values({
          clinicaId: c.clinica_id,
          pagadorId: c.paciente_id,
          consultaId,
          metodo: "cartao_credito",
          cartaoId: cartao.id,
          valorCentavos: c.valor,
          // A plataforma e a propria clinica (ADR-0022): nao ha divisao a fazer.
          valorClinicaCentavos: c.valor,
          valorPlataformaCentavos: 0,
          provedor: cartao.provedor,
          chaveIdempotencia: randomUUID(),
        })
        .returning();
      await tx.update(consultas).set({ pagamentoId: registro!.id }).where(eq(consultas.id, consultaId));
    }
    return { consulta: c, cartao, registro: registro! };
  });
  if (!preparo) return "ignorada";
  const { consulta, cartao, registro } = preparo;

  const [dados] = await banco
    .select({ nome: perfis.nomeCompleto, cpf: perfis.cpf, slug: clinicas.slug, clinicaNome: clinicas.nomeFantasia })
    .from(perfis)
    .innerJoin(clinicas, eq(clinicas.id, consulta.clinica_id))
    .where(eq(perfis.id, consulta.paciente_id))
    .limit(1);
  const linkDePagamento = `/c/${dados?.slug ?? ""}/pagamento/${consultaId}`;

  // 2. Chama o provedor FORA de transacao: nao se segura conexao esperando a rede.
  let status: "confirmado" | "recusado" | "pendente";
  let idNoProvedor: string | null = null;
  let bruto: Record<string, unknown> = {};
  try {
    const contexto = await resolvedor.para(consulta.clinica_id);
    const cobranca = await contexto.provedor.cobrar(contexto.credenciais, {
      chaveIdempotencia: registro.chaveIdempotencia,
      metodo: "cartao_credito",
      valorCentavos: registro.valorCentavos,
      comissaoPlataformaCentavos: 0,
      descricao: `Consulta em ${dados?.clinicaNome ?? "plataforma"}`,
      // O e-mail nao e guardado por nos; o cartao ja esta ligado ao cadastro no provedor.
      pagador: { nome: dados?.nome ?? "Paciente", email: "", cpf: dados?.cpf ?? null },
      cartaoSalvo: { clienteId: cartao.provedorClienteId, cartaoId: cartao.provedorCartaoId },
      urlDeNotificacao,
    });
    idNoProvedor = cobranca.idNoProvedor;
    bruto = cobranca.bruto;
    status = cobranca.status === "confirmado" || cobranca.status === "autorizado" ? "confirmado" : cobranca.status === "pendente" ? "pendente" : "recusado";
  } catch (erro) {
    const semResposta = erro instanceof ErroDePagamento && erro.codigo === "PROVEDOR_INDISPONIVEL";
    const antiga = Date.now() - registro.criadoEm.getTime() > HORAS_ATE_DESISTIR_DO_PROVEDOR * 3600 * 1000;
    // Sem resposta nao se sabe se cobrou: o registro continua pendente e a
    // proxima rodada repete com a mesma chave. So depois de um dia desiste.
    if (semResposta && !antiga) return "adiada";
    if (!(erro instanceof ErroDePagamento)) throw erro;
    status = "recusado";
    bruto = { erro: erro.codigo };
  }

  // 3. Grava o desfecho e avisa o paciente.
  const gravou = await banco.transaction(async (tx) => {
    const agora = new Date();
    const mudou = await tx
      .update(pagamentos)
      .set({
        status,
        provedorId: idNoProvedor,
        provedorPayload: bruto,
        ...(status === "confirmado" ? { confirmadoEm: agora } : {}),
        atualizadoEm: agora,
      })
      // So grava se ninguem resolveu este pagamento enquanto esperavamos (o aviso do provedor, por exemplo).
      .where(and(eq(pagamentos.id, registro.id), eq(pagamentos.status, "pendente")))
      .returning({ id: pagamentos.id });
    if (mudou.length === 0) return false;
    if (status === "pendente") return true;

    await registrarAuditoria(tx, {
      quem: null,
      clinicaId: consulta.clinica_id,
      acao: status === "confirmado" ? "pagamento.cartao_debitado" : "pagamento.cartao_recusado",
      tabela: "pagamentos",
      registroId: registro.id,
      detalhes: { consultaId, valorCentavos: registro.valorCentavos, provedor: cartao.provedor },
    });
    await notificar(tx, {
      perfilId: consulta.paciente_id,
      clinicaId: consulta.clinica_id,
      tipo: "pagamento",
      titulo: status === "confirmado" ? "Consulta paga no cartão" : "Não conseguimos cobrar o seu cartão",
      corpo:
        status === "confirmado"
          ? `O valor da sua consulta foi debitado no cartão final ${cartao.ultimos4}.`
          : `A cobrança no cartão final ${cartao.ultimos4} não foi aprovada. Pague a consulta por Pix para continuar usando a plataforma.`,
      link: status === "confirmado" ? null : linkDePagamento,
      chave: `cobranca_final:${registro.id}:${status}`,
    });
    return true;
  });

  if (!gravou) return "ignorada";
  return status === "confirmado" ? "cobrada" : status === "recusado" ? "recusada" : "adiada";
}
