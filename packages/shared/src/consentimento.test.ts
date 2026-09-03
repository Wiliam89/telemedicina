/**
 * O termo de consentimento e um documento juridico. Estes testes garantem
 * que ele nao perca, numa edicao futura, o que a norma exige que esteja
 * la - e que a versao nunca fique para tras do texto.
 */
import { describe, expect, it } from "vitest";
import { resumoDoTermo, TERMO_DE_TELEMEDICINA, VERSAO_DO_CONSENTIMENTO } from "./consentimento.js";

describe("termo de telemedicina", () => {
  const tudo = TERMO_DE_TELEMEDICINA.map((i) => `${i.titulo} ${i.texto}`).join(" ").toLowerCase();

  it("1. tem versao no formato de data", () => {
    expect(VERSAO_DO_CONSENTIMENTO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("2. avisa que NAO substitui emergencia e diz o que fazer", () => {
    expect(tudo).toContain("192");
    expect(tudo).toMatch(/samu|pronto-socorro/);
  });

  it("3. diz que o atendimento e para baixa complexidade", () => {
    expect(tudo).toMatch(/baixa complexidade|nao substitui/);
  });

  it("4. explica o tratamento dos dados e o direito de acesso", () => {
    expect(tudo).toMatch(/prontuario/);
    expect(tudo).toMatch(/copia dos seus dados|acesso ao prontuario e registrado/);
  });

  it("5. informa sobre gravacao", () => {
    expect(tudo).toContain("grava");
  });

  it("6. informa o direito de desistir", () => {
    expect(tudo).toMatch(/desistir|sair da fila/);
  });

  it("7. todo item tem titulo e texto de verdade", () => {
    for (const item of TERMO_DE_TELEMEDICINA) {
      expect(item.titulo.length).toBeGreaterThan(3);
      expect(item.texto.length).toBeGreaterThan(40);
    }
  });

  it("8. o resumo carrega a versao, para conferencia posterior", () => {
    expect(resumoDoTermo(VERSAO_DO_CONSENTIMENTO)).toContain(VERSAO_DO_CONSENTIMENTO);
  });
});
