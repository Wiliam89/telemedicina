import { describe, expect, it } from "vitest";
import { cpfValido, dataNascimentoValida, formatarCpf, problemaDaSenha, soDigitos } from "./validacao";

describe("validacao no navegador", () => {
  it("1. cpfValido confere os digitos verificadores", () => {
    expect(cpfValido("529.982.247-25")).toBe(true); // CPF de exemplo valido
    expect(cpfValido("52998224726")).toBe(false); // ultimo digito errado
    expect(cpfValido("11111111111")).toBe(false); // sequencia repetida
    expect(cpfValido("123")).toBe(false);
  });

  it("2. soDigitos e formatarCpf sao inversos", () => {
    expect(soDigitos("529.982.247-25")).toBe("52998224725");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });

  it("3. dataNascimentoValida recusa futuro, formato errado e idade impossivel", () => {
    expect(dataNascimentoValida("1990-05-10")).toBe(true);
    expect(dataNascimentoValida("2999-01-01")).toBe(false);
    expect(dataNascimentoValida("10/05/1990")).toBe(false);
    expect(dataNascimentoValida("1800-01-01")).toBe(false);
  });

  it("4. problemaDaSenha explica o que falta", () => {
    expect(problemaDaSenha("abc")).toMatch(/8 caracteres/);
    expect(problemaDaSenha("abcdefgh")).toMatch(/letras e numeros/);
    expect(problemaDaSenha("abcdefg1")).toBeNull();
  });
});
