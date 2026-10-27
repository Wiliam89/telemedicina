/**
 * Operacao (ADR-0020): as sondas do orquestrador e o id de requisicao.
 * Roda sem banco de verdade - e justamente o caso em que /pronto tem de
 * dizer "nao mande trafego para mim".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ambiente } from "./ambiente.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const AMBIENTE = {
  NODE_ENV: "test" as const,
  PORT: 3990,
  SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdefghijklmnop",
  // Porta fechada: o banco "nao responde".
  DATABASE_URL: "postgresql://u:s@127.0.0.1:1/nada",
  ORIGEM_PERMITIDA: "http://localhost:3000",
  ASSINATURA_PROVEDOR: "local_teste" as const,
  PERMITIR_ASSINATURA_SEM_VALOR_LEGAL: false,
  VIDEO_PROVEDOR: "local_teste" as const,
  PERMITIR_VIDEO_SIMULADO: false,
  EMAIL_PROVEDOR: "console" as const,
  NOME_PLATAFORMA: "Teste",
  DB_POOL_MAX: 1,
  LIMITE_POR_MINUTO: 10000,
} satisfies Ambiente;

let app: Awaited<ReturnType<typeof criarServidor>>["app"];

beforeAll(async () => {
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar: async () => null, provedorDeVideo: new ProvedorLocalDeVideo() }));
});
afterAll(async () => {
  await app?.close();
});

describe("operacao", () => {
  it("1. /vivo responde sem depender do banco", async () => {
    const r = await app.inject({ method: "GET", url: "/vivo" });
    expect(r.statusCode).toBe(200);
  });

  it("2. /pronto diz 503 quando o banco nao responde", async () => {
    const r = await app.inject({ method: "GET", url: "/pronto" });
    expect(r.statusCode).toBe(503);
    expect(r.json().erro.codigo).toBe("BANCO_INDISPONIVEL");
  });

  it("3. toda resposta traz o id da requisicao; o do balanceador e respeitado", async () => {
    const gerado = await app.inject({ method: "GET", url: "/vivo" });
    expect(gerado.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const recebido = await app.inject({ method: "GET", url: "/vivo", headers: { "x-request-id": "balanceador-123" } });
    expect(recebido.headers["x-request-id"]).toBe("balanceador-123");
  });

  it("4. a validacao publica tem limite proprio contra adivinhacao de codigos", async () => {
    const respostas = await Promise.all(Array.from({ length: 35 }, () => app.inject({ method: "GET", url: "/validar/AAAA-BBBB-CCCC" })));
    expect(respostas.some((r) => r.statusCode === 429)).toBe(true);
  });
});
