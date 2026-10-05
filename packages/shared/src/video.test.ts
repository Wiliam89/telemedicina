/**
 * A regra da janela da sala, testada sozinha.
 *
 * Estes testes nao precisam de banco, de API nem de provedor de video: a
 * regra e uma funcao que recebe estado e relogio e devolve sim ou nao. E
 * justamente por ser assim que ela pode ser testada em todos os cantos -
 * inclusive nos minutos exatos da borda, que e onde regra de horario erra.
 */
import { describe, expect, it } from "vitest";
import { decidirEntrada, janelaDaSala, MINUTOS_ANTES, MINUTOS_DEPOIS } from "./video.js";

const inicio = new Date("2026-10-05T14:00:00.000Z");
const fim = new Date("2026-10-05T14:30:00.000Z");

/** Atalho: "n minutos depois do inicio da consulta". */
const em = (minutos: number) => new Date(inicio.getTime() + minutos * 60_000);

describe("janela da sala", () => {
  it("1. abre antes do inicio e fecha depois do fim", () => {
    const { abreEm, fechaEm } = janelaDaSala(inicio, fim);
    expect(abreEm.toISOString()).toBe(em(-MINUTOS_ANTES).toISOString());
    expect(fechaEm.toISOString()).toBe(new Date(fim.getTime() + MINUTOS_DEPOIS * 60_000).toISOString());
  });
});

describe("quem entra, e quando", () => {
  const agendada = (agora: Date) => decidirEntrada({ status: "agendada", inicio, fim, agora });

  it("2. no horario da consulta: entra", () => {
    expect(agendada(em(0)).pode).toBe(true);
  });

  it("3. no minuto em que a sala abre: entra (a borda conta como dentro)", () => {
    expect(agendada(em(-MINUTOS_ANTES)).pode).toBe(true);
  });

  it("4. um minuto antes de abrir: nao entra, e a tela sabe a que horas abre", () => {
    const d = agendada(em(-MINUTOS_ANTES - 1));
    expect(d.pode).toBe(false);
    if (!d.pode) expect(d.motivo).toBe("cedo_demais");
    expect(d.abreEm.toISOString()).toBe(em(-MINUTOS_ANTES).toISOString());
  });

  it("5. consulta atrasada: a sala continua aberta depois do fim previsto", () => {
    expect(agendada(em(30 + MINUTOS_DEPOIS - 1)).pode).toBe(true);
  });

  it("6. passou da tolerancia: a sala fechou", () => {
    const d = agendada(em(30 + MINUTOS_DEPOIS + 1));
    expect(d.pode).toBe(false);
    if (!d.pode) expect(d.motivo).toBe("tarde_demais");
  });

  it("7. o estado vem antes do relogio: sem pagamento nao entra, nem na hora certa", () => {
    const d = decidirEntrada({ status: "aguardando_pagamento", inicio, fim, agora: em(0) });
    expect(d.pode).toBe(false);
    if (!d.pode) expect(d.motivo).toBe("aguardando_pagamento");
  });

  it("8. cancelada nao abre sala no horario marcado", () => {
    const d = decidirEntrada({ status: "cancelada", inicio, fim, agora: em(0) });
    if (!d.pode) expect(d.motivo).toBe("cancelada");
    else throw new Error("consulta cancelada nao devia abrir sala");
  });

  it("9. concluida nao reabre - atendimento encerrado e encerrado", () => {
    const d = decidirEntrada({ status: "concluida", inicio, fim, agora: em(0) });
    if (!d.pode) expect(d.motivo).toBe("concluida");
    else throw new Error("consulta concluida nao devia abrir sala");
  });

  it("10. em_andamento entra - e o caso do plantao, que comeca agora", () => {
    expect(decidirEntrada({ status: "em_andamento", inicio, fim, agora: em(1) }).pode).toBe(true);
  });

  it("11. toda recusa traz a janela, para a tela poder explicar em vez de so negar", () => {
    for (const status of ["aguardando_pagamento", "cancelada", "concluida"] as const) {
      const d = decidirEntrada({ status, inicio, fim, agora: em(0) });
      expect(d.abreEm).toBeInstanceOf(Date);
      expect(d.fechaEm).toBeInstanceOf(Date);
      if (!d.pode) expect(d.mensagem.length).toBeGreaterThan(20);
    }
  });
});
