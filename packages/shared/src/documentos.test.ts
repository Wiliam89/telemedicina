/**
 * Testes da montagem de documento. O que se prova aqui e o que sustenta a
 * validacao publica: os mesmos dados produzem sempre o mesmo texto, byte a
 * byte - senao o hash guardado nao bateria com o documento apresentado.
 */
import { describe, expect, it } from "vitest";
import {
  gerarCodigoValidacao,
  iniciaisDoNome,
  montarTextoDocumento,
  normalizarCodigo,
  type DadosDoDocumento,
} from "./documentos.js";

const BASE: DadosDoDocumento = {
  tipo: "receita_simples",
  ano: 2026,
  numero: 7,
  emitidoEm: "2026-09-01T14:30:00.000Z",
  clinica: { nomeFantasia: "Clinica Vida", cnpj: "11222333000181" },
  medico: { nomeCompleto: "Dra. Ana Souza", crm: "123456", crmUf: "SP", especialidade: "Clinica geral" },
  paciente: { nomeCompleto: "Bruno Lima", cpf: "52998224725", dataNascimento: "1990-05-10" },
  conteudo: { itens: [{ medicamento: "Dipirona 500mg", posologia: "1 comprimido de 6 em 6 horas por 3 dias" }] },
  codigoValidacao: "ABCD-EFGH-JKMN",
};

describe("montarTextoDocumento", () => {
  it("1. e determinista: mesmos dados, mesmo texto", () => {
    expect(montarTextoDocumento(BASE)).toBe(montarTextoDocumento({ ...BASE }));
  });

  it("2. usa sempre \\n, nunca \\r\\n (o hash nao pode depender do sistema)", () => {
    expect(montarTextoDocumento(BASE)).not.toContain("\r");
  });

  it("3. traz identificacao da clinica, do paciente e do medico", () => {
    const t = montarTextoDocumento(BASE);
    expect(t).toContain("CLINICA VIDA");
    expect(t).toContain("11.222.333/0001-81");
    expect(t).toContain("Bruno Lima");
    expect(t).toContain("529.982.247-25");
    expect(t).toContain("CRM 123456-SP");
    expect(t).toContain("No 7/2026");
    expect(t).toContain("ABCD-EFGH-JKMN");
  });

  it("4. a prescricao sai numerada, com posologia embaixo", () => {
    const t = montarTextoDocumento({
      ...BASE,
      conteudo: {
        itens: [
          { medicamento: "Dipirona 500mg", posologia: "1 cp 6/6h", quantidade: "1 caixa" },
          { medicamento: "Amoxicilina 500mg", posologia: "1 cp 8/8h por 7 dias" },
        ],
      },
    });
    expect(t).toContain("1. Dipirona 500mg - 1 caixa");
    expect(t).toContain("2. Amoxicilina 500mg");
  });

  it("5. atestado diz os dias de afastamento", () => {
    const t = montarTextoDocumento({ ...BASE, tipo: "atestado", conteudo: { diasAfastamento: 3 } });
    expect(t).toContain("ATESTADO MEDICO");
    expect(t).toContain("por 3 dia(s)");
  });

  it("6. o CID so aparece quando enviado (art. 76 do Codigo de Etica Medica)", () => {
    expect(montarTextoDocumento({ ...BASE, tipo: "atestado", conteudo: { diasAfastamento: 1 } })).not.toContain("CID-10");
    expect(montarTextoDocumento({ ...BASE, tipo: "atestado", conteudo: { diasAfastamento: 1, cid10: "J00" } })).toContain("CID-10: J00");
  });

  it("7. mudar qualquer dado muda o texto (e portanto o hash)", () => {
    const original = montarTextoDocumento(BASE);
    expect(montarTextoDocumento({ ...BASE, numero: 8 })).not.toBe(original);
    expect(montarTextoDocumento({ ...BASE, conteudo: { itens: [{ medicamento: "Dipirona 1g", posologia: "1 cp 6/6h" }] } })).not.toBe(original);
  });
});

describe("codigo de validacao", () => {
  it("8. sai em tres blocos de 4, sem caracteres que se confundem", () => {
    let i = 0;
    const codigo = gerarCodigoValidacao(() => i++ % 31);
    expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(codigo).not.toMatch(/[01OIL]/);
  });

  it("9. normaliza o que a pessoa digita do papel", () => {
    expect(normalizarCodigo("abcd efgh jkmn")).toBe("ABCD-EFGH-JKMN");
    expect(normalizarCodigo("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(normalizarCodigo("abcd-efgh-jkmn")).toBe("ABCD-EFGH-JKMN");
  });
});

describe("iniciaisDoNome", () => {
  it("10. protege a identidade na validacao publica", () => {
    expect(iniciaisDoNome("Maria Silva Oliveira")).toBe("M. S. O.");
    expect(iniciaisDoNome("Bruno Lima")).toBe("B. L.");
  });
});
