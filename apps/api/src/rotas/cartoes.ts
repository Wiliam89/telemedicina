/**
 * =====================================================================
 * CARTAO CADASTRADO E PENDENCIAS DE PAGAMENTO (ADR-0023)
 * =====================================================================
 *
 *   GET  /cartoes                  o meu cartao e como o navegador o tokeniza
 *   POST /cartoes                  cadastra (recebe so o TOKEN, nunca o numero)
 *   POST /cartoes/:id/remover      remove
 *   GET  /pagamentos/pendencias    consultas realizadas que o cartao nao pagou
 *
 * Cadastrar e opcional. Quem cadastra e debitado ao final de cada consulta;
 * quem nao cadastra paga por Pix antes de a consulta comecar.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cartoesSalvos, consultas, filaAtendimento, perfis, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { cartaoVencido, VERSAO_DA_AUTORIZACAO_DE_COBRANCA, type CartaoResumo, type MeiosDePagamento, type PendenciaDePagamento } from "@tele/shared/cobranca";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { pendenciasDePagamento } from "../cobranca.js";
import { criarExigirClinica } from "../contexto.js";
import { ErroHttp } from "../erros.js";
import { ErroDePagamento, type ResolvedorDePagamento } from "../pagamento/index.js";

function resumir(c: typeof cartoesSalvos.$inferSelect): CartaoResumo {
  return {
    id: c.id,
    bandeira: c.bandeira,
    ultimos4: c.ultimos4,
    validadeMes: c.validadeMes,
    validadeAno: c.validadeAno,
    vencido: cartaoVencido(c.validadeMes, c.validadeAno),
    criadoEm: c.criadoEm.toISOString(),
  };
}

export async function rotasCartoes(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador; resolvedor: ResolvedorDePagamento }): Promise<void> {
  const { banco, resolvedor } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);

  async function meuCartao(perfilId: string, clinicaId: string) {
    const [c] = await banco
      .select()
      .from(cartoesSalvos)
      .where(and(eq(cartoesSalvos.perfilId, perfilId), eq(cartoesSalvos.clinicaId, clinicaId), eq(cartoesSalvos.status, "ativo")))
      .limit(1);
    return c ?? null;
  }

  app.get("/cartoes", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<MeiosDePagamento>> => {
    const cartao = await meuCartao(req.usuario.id, req.contexto.clinicaId);
    return { ok: true, dados: { cartao: cartao ? resumir(cartao) : null, tokenizacao: await resolvedor.tokenizacao(req.contexto.clinicaId) } };
  });

  /**
   * O corpo traz o TOKEN que o navegador obteve direto do provedor. Numero,
   * validade e codigo de seguranca nunca chegam aqui - e esta rota recusa
   * qualquer coisa que pareca um numero de cartao, para um erro de
   * integracao nao virar vazamento.
   */
  app.post("/cartoes", { preHandler: dentroDaClinica, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply): Promise<Resposta<CartaoResumo>> => {
    const dados = z
      .object({
        tokenDoCartao: z
          .string()
          .trim()
          .min(8, "token do cartão inválido")
          .max(300)
          .refine((v) => !/^\d{12,19}$/.test(v.replace(/[\s-]/g, "")), "Envie o token gerado pelo provedor, nunca o número do cartão."),
        autorizo: z.literal(true, { message: "É preciso autorizar a cobrança ao final da consulta." }),
      })
      .strict()
      .parse(req.body);

    if (!req.contexto.papeis.includes("paciente")) throw new ErroHttp(403, "SO_PACIENTE", "O cartão é cadastrado por quem é atendido.");

    const [pessoa] = await banco.select({ nome: perfis.nomeCompleto, cpf: perfis.cpf }).from(perfis).where(eq(perfis.id, req.usuario.id)).limit(1);
    if (!req.usuario.email) throw new ErroHttp(400, "EMAIL_NECESSARIO", "Sua conta precisa de um e-mail para cadastrar o cartão.");

    let contexto;
    try {
      contexto = await resolvedor.para(req.contexto.clinicaId);
    } catch (erro) {
      if (erro instanceof ErroDePagamento) throw new ErroHttp(409, "CARTAO_INDISPONIVEL", "O cadastro de cartão ainda não está disponível. Use o Pix.");
      throw erro;
    }

    let noProvedor;
    try {
      noProvedor = await contexto.provedor.salvarCartao(contexto.credenciais, { pagador: { nome: pessoa?.nome ?? "Paciente", email: req.usuario.email, cpf: pessoa?.cpf ?? null }, tokenDoCartao: dados.tokenDoCartao });
    } catch (erro) {
      if (erro instanceof ErroDePagamento) {
        if (erro.codigo === "PROVEDOR_INDISPONIVEL") throw new ErroHttp(503, erro.codigo, "O serviço de pagamento não respondeu. Tente de novo em instantes.");
        throw new ErroHttp(400, "CARTAO_NAO_ACEITO", "O cartão não foi aceito. Confira os dados ou use outro cartão.");
      }
      throw erro;
    }
    if (cartaoVencido(noProvedor.validadeMes, noProvedor.validadeAno)) throw new ErroHttp(400, "CARTAO_VENCIDO", "Este cartão está vencido. Use outro.");

    const novo = await banco.transaction(async (tx) => {
      // Um cartao ativo por pessoa: o novo substitui o anterior. A trava evita
      // que dois cadastros simultaneos deixem dois ativos (o indice unico e a ultima defesa).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cartao:${req.usuario.id}:${req.contexto.clinicaId}`}))`);
      const anteriores = await tx
        .update(cartoesSalvos)
        .set({ status: "removido", removidoEm: new Date() })
        .where(and(eq(cartoesSalvos.perfilId, req.usuario.id), eq(cartoesSalvos.clinicaId, req.contexto.clinicaId), eq(cartoesSalvos.status, "ativo")))
        .returning({ id: cartoesSalvos.id });
      const [c] = await tx
        .insert(cartoesSalvos)
        .values({
          perfilId: req.usuario.id,
          clinicaId: req.contexto.clinicaId,
          provedor: contexto.provedor.nome,
          provedorClienteId: noProvedor.clienteId,
          provedorCartaoId: noProvedor.cartaoId,
          bandeira: noProvedor.bandeira.slice(0, 30),
          ultimos4: noProvedor.ultimos4,
          validadeMes: noProvedor.validadeMes,
          validadeAno: noProvedor.validadeAno,
          autorizacaoVersao: VERSAO_DA_AUTORIZACAO_DE_COBRANCA,
        })
        .returning();
      // Consultas ja marcadas para cobrar no cartao antigo passam a cobrar no novo.
      if (anteriores.length > 0) {
        const ids = anteriores.map((a) => a.id);
        await tx.update(consultas).set({ cartaoId: c!.id }).where(and(inArray(consultas.cartaoId, ids), inArray(consultas.status, ["agendada", "em_andamento"])));
        await tx.update(filaAtendimento).set({ cartaoId: c!.id }).where(and(inArray(filaAtendimento.cartaoId, ids), inArray(filaAtendimento.status, ["aguardando", "chamado", "em_atendimento"])));
      }
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "cartao.cadastrado",
        tabela: "cartoes_salvos",
        registroId: c!.id,
        // So o que identifica o cartao para a propria pessoa. Nunca o numero.
        detalhes: { bandeira: c!.bandeira, ultimos4: c!.ultimos4, autorizacaoVersao: VERSAO_DA_AUTORIZACAO_DE_COBRANCA, substituiu: anteriores.length > 0 },
        ip: req.ip,
      });
      return c!;
    });

    void reply.code(201);
    return { ok: true, dados: resumir(novo) };
  });

  app.post("/cartoes/:id/remover", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ removido: true }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);

    const cartao = await meuCartao(req.usuario.id, req.contexto.clinicaId);
    if (!cartao || cartao.id !== id) throw new ErroHttp(404, "CARTAO_NAO_ENCONTRADO", "Cartão não encontrado.");

    await banco.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cartao:${req.usuario.id}:${req.contexto.clinicaId}`}))`);
      // Atendimento combinado para cobrar neste cartao ainda nao foi cobrado:
      // remover agora deixaria a consulta sem como ser paga.
      const [emAberto] = await tx.execute<{ n: number }>(sql`
        select (
          (select count(*) from consultas c where c.cartao_id = ${id} and (
            c.status in ('agendada', 'em_andamento')
            or (c.status = 'concluida' and c.forma_de_cobranca = 'cartao_ao_final'
                and not exists (select 1 from pagamentos p where p.consulta_id = c.id and p.status in ('confirmado', 'autorizado', 'recusado', 'estornado')))
          ))
          + (select count(*) from fila_atendimento f where f.cartao_id = ${id} and f.status in ('aguardando', 'chamado', 'em_atendimento'))
        )::int as n
      `) as unknown as { n: number }[];
      if ((emAberto?.n ?? 0) > 0) {
        throw new ErroHttp(409, "CARTAO_EM_USO", "Há consulta marcada ou em andamento para cobrar neste cartão. Conclua ou cancele antes de removê-lo, ou cadastre outro cartão no lugar.");
      }
      await tx.update(cartoesSalvos).set({ status: "removido", removidoEm: new Date() }).where(and(eq(cartoesSalvos.id, id), eq(cartoesSalvos.status, "ativo")));
      await registrarAuditoria(tx, { quem: req.usuario.id, clinicaId: req.contexto.clinicaId, acao: "cartao.removido", tabela: "cartoes_salvos", registroId: id, ip: req.ip });
    });

    // Apagar no provedor e o que faz o cartao deixar de poder ser cobrado de fato.
    try {
      const contexto = await resolvedor.para(req.contexto.clinicaId);
      await contexto.provedor.removerCartao(contexto.credenciais, { clienteId: cartao.provedorClienteId, cartaoId: cartao.provedorCartaoId });
    } catch (erro) {
      // O cartao ja esta removido para nos e nunca mais sera cobrado por aqui.
      req.log.warn({ err: erro, cartaoId: id }, "nao foi possivel apagar o cartao no provedor");
    }
    return { ok: true, dados: { removido: true } };
  });

  app.get("/pagamentos/pendencias", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<PendenciaDePagamento[]>> => {
    return { ok: true, dados: await pendenciasDePagamento(banco, req.usuario.id, req.contexto.clinicaId) };
  });
}
