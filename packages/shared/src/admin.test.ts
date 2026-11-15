import { describe, expect, it } from "vitest";
import { formatarPercentual, lerPercentual } from "./admin.js";

describe("porcentagem do medico (ADR-0026)", () => {
  it("1. le o que a pessoa digita e devolve pontos-base", () => {
    expect(lerPercentual("70")).toBe(7000);
    expect(lerPercentual("72,5")).toBe(7250);
    expect(lerPercentual("72.55%")).toBe(7255);
    expect(lerPercentual("0")).toBe(0);
    expect(lerPercentual("100")).toBe(10000);
  });

  it("2. recusa o que nao e porcentagem valida", () => {
    for (const t of ["", "abc", "101", "-5", "70,555", "7 0", "1e2"]) expect(lerPercentual(t), t).toBeNull();
  });

  it("3. mostra do jeito brasileiro", () => {
    expect(formatarPercentual(7000)).toBe("70%");
    expect(formatarPercentual(7250)).toBe("72,5%");
    expect(formatarPercentual(null)).toBe("—");
  });
});
