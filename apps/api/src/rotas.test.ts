/**
 * Testes das rotas protegidas - sem banco e sem Supabase.
 *
 * O servidor aceita um "autenticador" falso: assim testamos o porteiro
 * (401) e a validacao (400) sem precisar de rede. O que depende do banco
 * (201, 404, 409) e provado pelo `pnpm api:testar-fluxo`, contra o Supabase.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarServidor } from "./servidor.js";

const AMBIENTE_TESTE = {
  NODE_ENV: "test" as const,
  PORT: 3333,
  SUPABASE_URL: "https://abcdefghij.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdefghijklmnop",
  DATABASE_URL: "postgresql://postgres.abc:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
  ORIGEM_PERMITIDA: "http://localhost:3000",
    ASSINATURA_PROVEDOR: "local_teste" as const,
};

/** Autenticador falso: so o token "token-bom" e aceito. */
const autenticarFalso = async (token: string) =>
  token === "token-bom" ? { id: "11111111-1111-1111-1111-111111111111", email: "teste@exemplo.com" } : null;

let app: Awaited<ReturnType<typeof criarServidor>>["app"];

beforeAll(async () => {
  ({ app } = await criarServidor({ ambiente: AMBIENTE_TESTE, autenticar: autenticarFalso }));
});
afterAll(async () => {
  await app.close();
});

describe("porteiro (exigirLogin)", () => {
  it("1. sem token: 401 no envelope padrao", async () => {
    const r = await app.inject({ method: "GET", url: "/perfis/eu" });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ ok: false, erro: { codigo: "NAO_AUTENTICADO" } });
  });

  it("2. token invalido: 401", async () => {
    const r = await app.inject({ method: "GET", url: "/medicos", headers: { authorization: "Bearer token-ruim" } });
    expect(r.statusCode).toBe(401);
  });

  it("3. cabecalho sem 'Bearer': 401", async () => {
    const r = await app.inject({ method: "GET", url: "/medicos", headers: { authorization: "token-bom" } });
    expect(r.statusCode).toBe(401);
  });
});

describe("POST /perfis - validacao", () => {
  it("4. corpo invalido: 400 com a lista de campos", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/perfis",
      headers: { authorization: "Bearer token-bom" },
      payload: { nomeCompleto: "Da", cpf: "123" },
    });
    expect(r.statusCode).toBe(400);
    const corpo = r.json() as { erro: { codigo: string; detalhes: { campo: string }[] } };
    expect(corpo.erro.codigo).toBe("DADOS_INVALIDOS");
    expect(corpo.erro.detalhes.map((d) => d.campo)).toEqual(expect.arrayContaining(["nomeCompleto", "cpf"]));
  });

  it("5. CRM fora do formato: 400 apontando o campo medico.crm", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/perfis",
      headers: { authorization: "Bearer token-bom" },
      payload: { nomeCompleto: "Dra. Teste", medico: { crm: "12", crmUf: "SP" } },
    });
    expect(r.statusCode).toBe(400);
    const corpo = r.json() as { erro: { detalhes: { campo: string }[] } };
    expect(corpo.erro.detalhes.map((d) => d.campo)).toContain("medico.crm");
  });
});

describe("contexto de clinica (Modulo 6)", () => {
  it("6. rota de dentro da clinica sem o cabecalho X-Clinica: 400", async () => {
    const r = await app.inject({ method: "GET", url: "/medicos", headers: { authorization: "Bearer token-bom" } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ erro: { codigo: "CLINICA_NAO_INFORMADA" } });
  });

  // "clinica inexistente -> 404" e "sem vinculo -> 403" precisam do banco:
  // sao provados de ponta a ponta por `pnpm api:testar-fluxo`, contra o
  // Supabase de verdade. Aqui ficam so os testes que rodam sem rede.

  it("8. criar clinica com CNPJ invalido: 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/clinicas",
      headers: { authorization: "Bearer token-bom" },
      payload: { nomeFantasia: "Clinica Teste", razaoSocial: "Teste LTDA", cnpj: "11111111111111", slug: "clinica-teste" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("9. endereco reservado nao pode virar clinica: 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/clinicas",
      headers: { authorization: "Bearer token-bom" },
      payload: { nomeFantasia: "Clinica Teste", razaoSocial: "Teste LTDA", cnpj: "11222333000181", slug: "admin" },
    });
    expect(r.statusCode).toBe(400);
  });
});
