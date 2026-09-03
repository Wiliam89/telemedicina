/**
 * Testes do calculo de horarios. Sem banco, sem rede e sem relogio real:
 * "agora" e sempre passado como parametro, entao o resultado nunca muda
 * conforme o dia em que os testes rodam.
 */
import { describe, expect, it } from "vitest";
import { calcularHorariosLivres, diaDaSemanaLocal, formatarMinutos, instanteLocal, minutosDoDia } from "./agenda.js";

const SP = "America/Sao_Paulo";
const GRADE = [{ diaSemana: 4, horaInicio: "08:00:00", horaFim: "10:00:00", duracaoMinutos: 30 }];
// 2026-09-10 e uma quinta-feira (dia 4).
const QUINTA = "2026-09-10";
const ONTEM = new Date("2026-09-01T12:00:00Z");

describe("apoio", () => {
  it("1. converte hora em minutos e de volta", () => {
    expect(minutosDoDia("08:30:00")).toBe(510);
    expect(formatarMinutos(510)).toBe("08:30");
    expect(formatarMinutos(0)).toBe("00:00");
  });

  it("2. sabe o dia da semana no fuso da clinica", () => {
    expect(diaDaSemanaLocal(QUINTA, SP)).toBe(4);
    expect(diaDaSemanaLocal("2026-09-13", SP)).toBe(0); // domingo
  });

  it("3. converte hora local em instante absoluto (Sao Paulo = UTC-3)", () => {
    expect(instanteLocal(QUINTA, 8 * 60, SP).toISOString()).toBe("2026-09-10T11:00:00.000Z");
  });
});

describe("calcularHorariosLivres", () => {
  it("4. gera um horario por intervalo do bloco", () => {
    const livres = calcularHorariosLivres({ data: QUINTA, fuso: SP, grade: GRADE, ocupado: [], agora: ONTEM });
    expect(livres.map((h) => h.rotulo)).toEqual(["08:00", "08:30", "09:00", "09:30"]);
  });

  it("5. dia sem grade nao tem horario nenhum", () => {
    const livres = calcularHorariosLivres({ data: "2026-09-13", fuso: SP, grade: GRADE, ocupado: [], agora: ONTEM });
    expect(livres).toHaveLength(0);
  });

  it("6. horario ocupado some da lista", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, grade: GRADE, agora: ONTEM,
      ocupado: [{ inicio: "2026-09-10T12:00:00Z", fim: "2026-09-10T12:30:00Z" }], // 09:00 local
    });
    expect(livres.map((h) => h.rotulo)).toEqual(["08:00", "08:30", "09:30"]);
  });

  it("7. ocupacao que cobre parte do horario tambem o remove", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, grade: GRADE, agora: ONTEM,
      ocupado: [{ inicio: "2026-09-10T11:15:00Z", fim: "2026-09-10T11:20:00Z" }], // 5 min dentro do 08:00
    });
    expect(livres.map((h) => h.rotulo)).toEqual(["08:30", "09:00", "09:30"]);
  });

  it("8. bloqueio do dia inteiro zera a agenda", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, grade: GRADE, agora: ONTEM,
      ocupado: [{ inicio: "2026-09-10T00:00:00Z", fim: "2026-09-11T00:00:00Z" }],
    });
    expect(livres).toHaveLength(0);
  });

  it("9. horario que ja passou nao aparece", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, grade: GRADE, ocupado: [],
      agora: new Date("2026-09-10T12:10:00Z"), // 09:10 local
    });
    expect(livres.map((h) => h.rotulo)).toEqual(["09:30"]);
  });

  it("10. antecedencia minima corta os horarios proximos demais", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, grade: GRADE, ocupado: [],
      agora: new Date("2026-09-10T11:00:00Z"), // 08:00 local
      antecedenciaMinutos: 60,
    });
    expect(livres.map((h) => h.rotulo)).toEqual(["09:00", "09:30"]);
  });

  it("11. dois blocos no mesmo dia (manha e tarde) com duracoes diferentes", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, agora: ONTEM, ocupado: [],
      grade: [
        { diaSemana: 4, horaInicio: "08:00:00", horaFim: "09:00:00", duracaoMinutos: 30 },
        { diaSemana: 4, horaInicio: "14:00:00", horaFim: "15:00:00", duracaoMinutos: 20 },
      ],
    });
    expect(livres.map((h) => h.rotulo)).toEqual(["08:00", "08:30", "14:00", "14:20", "14:40"]);
  });

  it("12. sobra menor que a duracao nao vira horario", () => {
    const livres = calcularHorariosLivres({
      data: QUINTA, fuso: SP, agora: ONTEM, ocupado: [],
      grade: [{ diaSemana: 4, horaInicio: "08:00:00", horaFim: "08:50:00", duracaoMinutos: 30 }],
    });
    expect(livres.map((h) => h.rotulo)).toEqual(["08:00"]); // 08:30-09:00 nao cabe
  });
});
