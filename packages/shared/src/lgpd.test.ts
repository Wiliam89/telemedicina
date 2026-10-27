import { describe, expect, it } from "vitest";
import { consentimentosPendentes, VERSOES_LEGAIS } from "./lgpd.js";

const v = VERSOES_LEGAIS;
describe("consentimentos pendentes", () => {
  it("1. sem nenhum registro, tudo pendente", () => {
    expect(consentimentosPendentes([]).sort()).toEqual(["politica_de_privacidade", "telemedicina", "termos_de_uso"]);
  });
  it("2. aceito na versao atual nao fica pendente", () => {
    const r = consentimentosPendentes([
      { tipo: "termos_de_uso", acao: "aceito", versao: v.termos_de_uso, criadoEm: "2026-10-26T10:00:00Z" },
      { tipo: "politica_de_privacidade", acao: "aceito", versao: v.politica_de_privacidade, criadoEm: "2026-10-26T10:00:00Z" },
      { tipo: "telemedicina", acao: "aceito", versao: v.telemedicina, criadoEm: "2026-10-26T10:00:00Z" },
    ]);
    expect(r).toEqual([]);
  });
  it("3. versao antiga ou revogacao posterior voltam a pedir aceite", () => {
    const r = consentimentosPendentes([
      { tipo: "termos_de_uso", acao: "aceito", versao: "2020-01-01", criadoEm: "2020-01-01T10:00:00Z" },
      { tipo: "politica_de_privacidade", acao: "aceito", versao: v.politica_de_privacidade, criadoEm: "2026-10-26T10:00:00Z" },
      { tipo: "politica_de_privacidade", acao: "revogado", versao: v.politica_de_privacidade, criadoEm: "2026-10-27T10:00:00Z" },
      { tipo: "telemedicina", acao: "aceito", versao: v.telemedicina, criadoEm: "2026-10-26T10:00:00Z" },
    ]);
    expect(r.sort()).toEqual(["politica_de_privacidade", "termos_de_uso"]);
  });
});
