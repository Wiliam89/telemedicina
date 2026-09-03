/**
 * Testes da agenda que rodam sem banco e sem rede.
 *
 * Duas camadas sao testadas aqui: a portaria (login e clinica) e os
 * esquemas de entrada. O comportamento que depende do banco - marcar,
 * cancelar, a trava contra dupla marcacao, o fuso da clinica - e provado
 * de ponta a ponta por `pnpm api:testar-fluxo`, contra o Supabase real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esquemaCancelar, esquemaGrade, esquemaMarcar } from "./rotas/agenda.js";
import { fusoValido } from "./rotas/clinicas.js";
import { criarServidor } from "./servidor.js";

/** Primeiro problema encontrado pelo Zod, no formato campo: mensagem. */
function problemas(resultado: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }): string[] {
  return resultado.success ? [] : (resultado.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("esquema da grade semanal", () => {
  it("1. aceita uma grade valida", () => {
    const r = esquemaGrade.safeParse({ blocos: [{ diaSemana: 1, horaInicio: "08:00", horaFim: "12:00", duracaoMinutos: 30 }] });
    expect(r.success).toBe(true);
  });

  it("2. recusa dia da semana fora de 0-6", () => {
    const r = esquemaGrade.safeParse({ blocos: [{ diaSemana: 9, horaInicio: "08:00", horaFim: "12:00", duracaoMinutos: 30 }] });
    expect(problemas(r).join()).toContain("diaSemana");
  });

  it("3. recusa consulta curta ou longa demais", () => {
    expect(problemas(esquemaGrade.safeParse({ blocos: [{ diaSemana: 1, horaInicio: "08:00", horaFim: "12:00", duracaoMinutos: 5 }] })).join()).toContain("10 minutos");
    expect(problemas(esquemaGrade.safeParse({ blocos: [{ diaSemana: 1, horaInicio: "08:00", horaFim: "12:00", duracaoMinutos: 300 }] })).join()).toContain("120 minutos");
  });

  it("4. recusa hora fora do formato HH:MM", () => {
    expect(problemas(esquemaGrade.safeParse({ blocos: [{ diaSemana: 1, horaInicio: "8h", horaFim: "12:00", duracaoMinutos: 30 }] })).join()).toContain("horaInicio");
    expect(problemas(esquemaGrade.safeParse({ blocos: [{ diaSemana: 1, horaInicio: "25:00", horaFim: "26:00", duracaoMinutos: 30 }] })).join()).toContain("horaInicio");
  });

  it("5. grade vazia e valida: e como o medico diz que parou de atender ali", () => {
    expect(esquemaGrade.safeParse({ blocos: [] }).success).toBe(true);
  });
});

describe("esquemas de consulta", () => {
  it("6. marcar exige medico e um instante com fuso", () => {
    expect(esquemaMarcar.safeParse({ medicoId: "11111111-1111-1111-1111-111111111111", inicio: "2026-09-10T11:00:00Z" }).success).toBe(true);
    expect(problemas(esquemaMarcar.safeParse({ medicoId: "nao-e-uuid", inicio: "2026-09-10T11:00:00Z" })).join()).toContain("medicoId");
    // sem fuso nao da: "as 11h" de quem?
    expect(esquemaMarcar.safeParse({ medicoId: "11111111-1111-1111-1111-111111111111", inicio: "2026-09-10 11:00" }).success).toBe(false);
  });

  it("7. cancelamento exige motivo com conteudo", () => {
    expect(esquemaCancelar.safeParse({ motivo: "x" }).success).toBe(false);
    expect(esquemaCancelar.safeParse({ motivo: "imprevisto de trabalho" }).success).toBe(true);
  });
});

describe("fusoValido", () => {
  it("8. aceita nome IANA e recusa deslocamento e invencao", () => {
    expect(fusoValido("America/Sao_Paulo")).toBe(true);
    expect(fusoValido("America/Manaus")).toBe(true);
    expect(fusoValido("America/Rio_Branco")).toBe(true);
    expect(fusoValido("UTC")).toBe(true);
    expect(fusoValido("Marte/Olympus")).toBe(false);
    // deslocamento nao sabe de horario de verao: recusado de proposito
    expect(fusoValido("-03:00")).toBe(false);
    expect(fusoValido("+0500")).toBe(false);
  });
});

describe("portaria das rotas da agenda", () => {
  const AMBIENTE = {
    NODE_ENV: "test" as const,
    PORT: 3333,
    SUPABASE_URL: "https://abcdefghij.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdefghijklmnop",
    DATABASE_URL: "postgresql://postgres.abc:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
    ORIGEM_PERMITIDA: "http://localhost:3000",
    ASSINATURA_PROVEDOR: "local_teste" as const,
    PERMITIR_ASSINATURA_SEM_VALOR_LEGAL: false,
  };
  let app: Awaited<ReturnType<typeof criarServidor>>["app"];

  beforeAll(async () => {
    ({ app } = await criarServidor({
      ambiente: AMBIENTE,
      autenticar: async (t) => (t === "token-bom" ? { id: "11111111-1111-1111-1111-111111111111", email: "t@e.com" } : null),
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  it("9. sem login: 401", async () => {
    const r = await app.inject({ method: "GET", url: "/horarios?medicoId=11111111-1111-1111-1111-111111111111&data=2026-09-10" });
    expect(r.statusCode).toBe(401);
  });

  it("10. logado mas sem dizer a clinica: 400", async () => {
    const r = await app.inject({ method: "GET", url: "/consultas", headers: { authorization: "Bearer token-bom" } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ erro: { codigo: "CLINICA_NAO_INFORMADA" } });
  });
});
