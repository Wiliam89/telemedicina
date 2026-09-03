import { describe, expect, it } from "vitest";
import { cnpjValido } from "./rotas/clinicas.js";
import { hashDoCodigo } from "./rotas/equipe.js";

describe("cnpjValido", () => {
  it("1. aceita CNPJ com digitos verificadores corretos", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
  });
  it("2. recusa digito errado, sequencia repetida e tamanho errado", () => {
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
    expect(cnpjValido("112223330001")).toBe(false);
  });
});

describe("hashDoCodigo (convites)", () => {
  it("3. e estavel, tem 64 hexadecimais e nao devolve o codigo", () => {
    const h = hashDoCodigo("codigo-secreto-do-convite");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h).toBe(hashDoCodigo("codigo-secreto-do-convite"));
    expect(h).not.toContain("codigo");
  });
  it("4. codigos diferentes geram hashes diferentes", () => {
    expect(hashDoCodigo("a")).not.toBe(hashDoCodigo("b"));
  });
});
