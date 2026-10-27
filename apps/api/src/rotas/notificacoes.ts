/**
 * A central de notificacoes (o sino), ADR-0019.
 *
 *   GET  /notificacoes            as 50 mais recentes e quantas nao foram lidas
 *   POST /notificacoes/:id/lida   marca uma como lida
 *   POST /notificacoes/lidas      marca todas como lidas
 */
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, notificacoes, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { criarExigirLogin, type Autenticador } from "../autenticacao.js";

export interface NotificacaoResumo {
  id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  link: string | null;
  clinica: string | null;
  lida: boolean;
  criadoEm: string;
}

export async function rotasNotificacoes(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const exigirLogin = criarExigirLogin(opcoes.autenticar);

  app.get("/notificacoes", { preHandler: exigirLogin }, async (req): Promise<Resposta<{ naoLidas: number; itens: NotificacaoResumo[] }>> => {
    const [linhas, [total]] = await Promise.all([
      banco
        .select({ n: notificacoes, clinica: clinicas.nomeFantasia })
        .from(notificacoes)
        .leftJoin(clinicas, eq(clinicas.id, notificacoes.clinicaId))
        .where(eq(notificacoes.perfilId, req.usuario.id))
        .orderBy(desc(notificacoes.criadoEm))
        .limit(50),
      banco.select({ n: count() }).from(notificacoes).where(and(eq(notificacoes.perfilId, req.usuario.id), isNull(notificacoes.lidaEm))),
    ]);
    return {
      ok: true,
      dados: {
        naoLidas: total?.n ?? 0,
        itens: linhas.map(({ n, clinica }) => ({
          id: n.id,
          tipo: n.tipo,
          titulo: n.titulo,
          corpo: n.corpo,
          link: n.link,
          clinica,
          lida: n.lidaEm !== null,
          criadoEm: n.criadoEm.toISOString(),
        })),
      },
    };
  });

  app.post("/notificacoes/:id/lida", { preHandler: exigirLogin }, async (req): Promise<Resposta<{ ok: true }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    await banco
      .update(notificacoes)
      .set({ lidaEm: new Date() })
      .where(and(eq(notificacoes.id, id), eq(notificacoes.perfilId, req.usuario.id), isNull(notificacoes.lidaEm)));
    return { ok: true, dados: { ok: true } };
  });

  app.post("/notificacoes/lidas", { preHandler: exigirLogin }, async (req): Promise<Resposta<{ ok: true }>> => {
    await banco.update(notificacoes).set({ lidaEm: new Date() }).where(and(eq(notificacoes.perfilId, req.usuario.id), isNull(notificacoes.lidaEm)));
    return { ok: true, dados: { ok: true } };
  });
}
