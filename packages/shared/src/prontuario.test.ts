import { describe, expect, it } from "vitest";
import { calcularIdade, calcularImc, classificarImc } from "./prontuario.js";

describe("prontuario: contas da ficha", () => {
  it("1. IMC com uma casa decimal", () => {
    expect(calcularImc(70, 175)).toBe(22.9);
    expect(calcularImc(null, 175)).toBeNull();
    expect(calcularImc(70, undefined)).toBeNull();
  });

  it("2. classificacao do IMC segue as faixas da OMS", () => {
    expect(classificarImc(17)).toBe("Abaixo do peso");
    expect(classificarImc(22.9)).toBe("Peso adequado");
    expect(classificarImc(27)).toBe("Sobrepeso");
    expect(classificarImc(41)).toBe("Obesidade grau III");
  });

  it("3. idade so vira no dia do aniversario", () => {
    const ref = new Date(2026, 5, 14); // 14/06/2026
    expect(calcularIdade("1990-06-15", ref)).toBe(35);
    expect(calcularIdade("1990-06-14", ref)).toBe(36);
    expect(calcularIdade("1990-01-01", ref)).toBe(36);
  });
});
