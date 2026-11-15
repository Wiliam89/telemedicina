import { describe, expect, it } from "vitest";
import { calcularNps, celulaCsv, centavosParaCsv, montarCsv, podeRegistrarFalta, prazoDeRetornoValido, taxa } from "./retorno.js";

describe("retorno, faltas e planilha (ADR-0027)", () => {
  it("prazo de retorno: de 1 dia ao maximo da plataforma, nunca acima de 90", () => {
    expect(prazoDeRetornoValido(30, 30)).toBe(true);
    expect(prazoDeRetornoValido(31, 30)).toBe(false);
    expect(prazoDeRetornoValido(0, 30)).toBe(false);
    expect(prazoDeRetornoValido(7.5, 30)).toBe(false);
    expect(prazoDeRetornoValido(91, 120)).toBe(false);
    expect(prazoDeRetornoValido(1, 0)).toBe(false);
  });

  it("falta so depois da tolerancia de 15 minutos", () => {
    const inicio = new Date("2026-05-01T10:00:00Z");
    expect(podeRegistrarFalta(inicio, new Date("2026-05-01T10:14:59Z"))).toBe(false);
    expect(podeRegistrarFalta(inicio, new Date("2026-05-01T10:15:00Z"))).toBe(true);
  });

  it("NPS = % promotores - % detratores", () => {
    expect(calcularNps([])).toBeNull();
    expect(calcularNps([10, 9, 8, 0])).toBe(25);
    expect(calcularNps([0, 6])).toBe(-100);
    expect(taxa(1, 3)).toBe(33.3);
    expect(taxa(1, 0)).toBe(0);
  });

  it("CSV: virgula decimal, aspas, BOM e sem formula", () => {
    expect(centavosParaCsv(12345)).toBe("123,45");
    expect(centavosParaCsv(5)).toBe("0,05");
    expect(centavosParaCsv(-700)).toBe("-7,00");
    expect(celulaCsv("-7,00")).toBe("-7,00");
    expect(celulaCsv("=1+1")).toBe("'=1+1");
    expect(celulaCsv("@SOMA(A1)")).toBe("'@SOMA(A1)");
    expect(celulaCsv('Dr. "Zé"; filho')).toBe('"Dr. ""Zé""; filho"');
    expect(celulaCsv(null)).toBe("");
    expect(montarCsv(["a", "b"], [[1, "x"]])).toBe("﻿a;b\r\n1;x\r\n");
  });
});
