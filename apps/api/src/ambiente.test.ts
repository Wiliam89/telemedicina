import { afterEach, describe, expect, it, vi } from "vitest";
import { carregarAmbiente } from "./ambiente.js";

/**
 * Testes da validacao de ambiente.
 *
 * Eles garantem que a API se recusa a subir com configuracao errada -
 * inclusive no erro mais perigoso: colocar a chave publicavel no lugar da
 * secreta (ou vice-versa).
 */

const valido = {
  SUPABASE_URL: "https://abcdefghij.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdefghijklmnop",
  DATABASE_URL: "postgresql://postgres.abc:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
};

describe("carregarAmbiente", () => {
  afterEach(() => vi.restoreAllMocks());

  it("aceita uma configuracao completa e aplica os padroes", () => {
    const amb = carregarAmbiente(valido);
    expect(amb.PORT).toBe(3333);
    expect(amb.NODE_ENV).toBe("development");
    expect(amb.ORIGEM_PERMITIDA).toBe("http://localhost:3000");
  });

  it("aceita a chave legada service_role (comeca com eyJ)", () => {
    const amb = carregarAmbiente({ ...valido, SUPABASE_SECRET_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" });
    expect(amb.SUPABASE_SECRET_KEY.startsWith("eyJ")).toBe(true);
  });

  function esperarSaida(ambiente: Record<string, string>) {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sair = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    expect(() => carregarAmbiente(ambiente)).toThrow("exit");
    expect(sair).toHaveBeenCalledWith(1);
  }

  it("recusa subir sem SUPABASE_URL", () => {
    const { SUPABASE_URL: _, ...semUrl } = valido;
    esperarSaida(semUrl);
  });

  it("recusa a chave publicavel no lugar da secreta", () => {
    esperarSaida({ ...valido, SUPABASE_SECRET_KEY: "sb_publishable_1234567890abcdefghij" });
  });

  it("recusa DATABASE_URL com [YOUR-PASSWORD] ainda no lugar", () => {
    esperarSaida({
      ...valido,
      DATABASE_URL: "postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
    });
  });
});
