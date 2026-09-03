/**
 * Testes de pagamento que rodam sem banco, sem rede e sem gateway.
 *
 * Duas camadas: a matematica do split (que decide dinheiro, entao precisa
 * ser exata) e a conferencia da assinatura do webhook (que decide se um
 * estranho consegue liberar atendimento de graca).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calcularComissao, escolherPreco, ProvedorLocalDePagamento, ProvedorMercadoPago } from "./pagamento/index.js";

describe("calculo do split", () => {
  it("1. divide o valor entre plataforma e clinica", () => {
    // R$ 150,00 com 10% de comissao
    expect(calcularComissao(15000, 1000)).toEqual({ plataforma: 1500, clinica: 13500 });
  });

  it("2. comissao zero deixa tudo com a clinica", () => {
    expect(calcularComissao(15000, 0)).toEqual({ plataforma: 0, clinica: 15000 });
  });

  it("3. arredonda a comissao PARA BAIXO: o centavo da duvida fica com a clinica", () => {
    // 7,5% de R$ 33,33 = 249,975 centavos
    const r = calcularComissao(3333, 750);
    expect(r.plataforma).toBe(249);
    expect(r.clinica).toBe(3084);
  });

  it("4. as partes SEMPRE somam o total (o banco recusaria o contrario)", () => {
    for (const valor of [100, 999, 3333, 15000, 99999, 1000000]) {
      for (const bps of [0, 1, 750, 1000, 2999, 3000]) {
        const r = calcularComissao(valor, bps);
        expect(r.plataforma + r.clinica).toBe(valor);
        expect(r.plataforma).toBeGreaterThanOrEqual(0);
        expect(r.clinica).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("escolha do preco", () => {
  const padrao = { valorCentavos: 15000, comissaoPlataformaBps: 1000, medicoId: null };
  const doMedico = { valorCentavos: 25000, comissaoPlataformaBps: 1000, medicoId: "medico-1" };

  it("5. o preco do medico ganha do padrao da clinica", () => {
    expect(escolherPreco([padrao, doMedico], "medico-1")?.valorCentavos).toBe(25000);
  });

  it("6. medico sem preco proprio usa o padrao", () => {
    expect(escolherPreco([padrao, doMedico], "medico-2")?.valorCentavos).toBe(15000);
  });

  it("7. sem preco nenhum, devolve null (a rota recusa cobrar)", () => {
    expect(escolherPreco([], "medico-1")).toBeNull();
  });
});

describe("assinatura do webhook", () => {
  const SEGREDO = "segredo-do-webhook";

  it("8. notificacao legitima e aceita", () => {
    const p = new ProvedorLocalDePagamento();
    const n = ProvedorLocalDePagamento.montarNotificacao("local_123", SEGREDO);
    expect(p.conferirNotificacao(n.cabecalhos, n.corpo, SEGREDO)).toBe(true);
  });

  it("9. corpo alterado invalida a assinatura", () => {
    const p = new ProvedorLocalDePagamento();
    const n = ProvedorLocalDePagamento.montarNotificacao("local_123", SEGREDO);
    expect(p.conferirNotificacao(n.cabecalhos, JSON.stringify({ id: "local_999", tipo: "pagamento" }), SEGREDO)).toBe(false);
  });

  it("10. segredo errado invalida", () => {
    const p = new ProvedorLocalDePagamento();
    const n = ProvedorLocalDePagamento.montarNotificacao("local_123", SEGREDO);
    expect(p.conferirNotificacao(n.cabecalhos, n.corpo, "outro-segredo")).toBe(false);
  });

  it("11. sem assinatura, recusa", () => {
    expect(new ProvedorLocalDePagamento().conferirNotificacao({}, "{}", SEGREDO)).toBe(false);
  });
});

describe("assinatura do webhook do Mercado Pago", () => {
  const SEGREDO = "segredo-mp";
  const mp = new ProvedorMercadoPago();

  function montar(id: string, requestId: string, ts: number, segredo = SEGREDO) {
    const corpo = JSON.stringify({ type: "payment", data: { id } });
    const v1 = createHmac("sha256", segredo).update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
    return { corpo, cabecalhos: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId } };
  }

  it("12. notificacao legitima e aceita", () => {
    const n = montar("123", "req-1", Math.floor(Date.now() / 1000));
    expect(mp.conferirNotificacao(n.cabecalhos, n.corpo, SEGREDO)).toBe(true);
  });

  it("13. notificacao VELHA e recusada (protege contra reenvio)", () => {
    const meiaHoraAtras = Math.floor(Date.now() / 1000) - 1800;
    const n = montar("123", "req-1", meiaHoraAtras);
    expect(mp.conferirNotificacao(n.cabecalhos, n.corpo, SEGREDO)).toBe(false);
  });

  it("14. trocar o id do pagamento invalida", () => {
    const ts = Math.floor(Date.now() / 1000);
    const n = montar("123", "req-1", ts);
    const adulterado = JSON.stringify({ type: "payment", data: { id: "999" } });
    expect(mp.conferirNotificacao(n.cabecalhos, adulterado, SEGREDO)).toBe(false);
  });

  it("15. so processa notificacao de pagamento", () => {
    expect(mp.lerNotificacao({ type: "payment", data: { id: "1" } })).toEqual({ idNoProvedor: "1" });
    expect(mp.lerNotificacao({ type: "plan", data: { id: "1" } })).toBeNull();
    expect(mp.lerNotificacao({})).toBeNull();
  });
});
