/**
 * Testes do prontuario e dos documentos que rodam sem banco e sem rede.
 *
 * O que NAO esta aqui, de proposito: as regras de imutabilidade (alterar
 * evolucao finalizada, apagar, adendo de adendo, alterar documento
 * emitido). Elas nao vivem no codigo - vivem em gatilhos do banco, e so
 * fazem sentido testadas contra ele. `pnpm api:testar-fluxo` faz isso.
 */
import { describe, expect, it } from "vitest";
import { esquemaEmitir, hashDoTexto } from "./rotas/documentos.js";
import { esquemaAdendo, esquemaSoap } from "./rotas/prontuario.js";

function problemas(r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }): string {
  return r.success ? "" : (r.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
}

describe("hashDoTexto", () => {
  it("1. e SHA-256 hexadecimal, estavel e sensivel a qualquer mudanca", () => {
    const h = hashDoTexto("RECEITA\nDipirona 500mg");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashDoTexto("RECEITA\nDipirona 500mg"));
    expect(h).not.toBe(hashDoTexto("RECEITA\nDipirona 500mg ")); // um espaco
    expect(h).not.toBe(hashDoTexto("RECEITA\nDipirona 1g")); // a dose
  });
});

describe("esquema da evolucao (SOAP)", () => {
  it("2. aceita os quatro campos e o CID no formato certo", () => {
    expect(esquemaSoap.safeParse({ subjetivo: "dor", objetivo: "PA 120x80", avaliacao: "faringite", plano: "sintomaticos", cid10: "J02" }).success).toBe(true);
    expect(esquemaSoap.safeParse({ cid10: "J02.9" }).success).toBe(true);
  });

  it("3. recusa CID fora do formato A00 ou A00.0", () => {
    expect(problemas(esquemaSoap.safeParse({ cid10: "faringite" }))).toContain("cid10");
    expect(problemas(esquemaSoap.safeParse({ cid10: "j02" }))).toContain("cid10");
  });

  it("4. adendo vazio nao passa: adendo que nao diz nada nao corrige nada", () => {
    expect(esquemaAdendo.safeParse({}).success).toBe(false);
    expect(esquemaAdendo.safeParse({ objetivo: "havia febre" }).success).toBe(true);
  });
});

describe("esquema do documento", () => {
  const base = { consultaId: "11111111-1111-1111-1111-111111111111" };

  it("5. receita exige ao menos um medicamento com posologia", () => {
    expect(problemas(esquemaEmitir.safeParse({ ...base, tipo: "receita_simples", conteudo: {} }))).toContain("medicamento");
    expect(problemas(esquemaEmitir.safeParse({ ...base, tipo: "receita_simples", conteudo: { itens: [{ medicamento: "Dipirona 500mg" }] } }))).toContain("posologia");
    expect(esquemaEmitir.safeParse({ ...base, tipo: "receita_simples", conteudo: { itens: [{ medicamento: "Dipirona 500mg", posologia: "1 cp 6/6h" }] } }).success).toBe(true);
  });

  it("6. atestado exige os dias de afastamento, dentro do razoavel", () => {
    expect(problemas(esquemaEmitir.safeParse({ ...base, tipo: "atestado", conteudo: {} }))).toContain("dias");
    expect(esquemaEmitir.safeParse({ ...base, tipo: "atestado", conteudo: { diasAfastamento: 0 } }).success).toBe(false);
    expect(esquemaEmitir.safeParse({ ...base, tipo: "atestado", conteudo: { diasAfastamento: 400 } }).success).toBe(false);
    expect(esquemaEmitir.safeParse({ ...base, tipo: "atestado", conteudo: { diasAfastamento: 3 } }).success).toBe(true);
  });

  it("7. pedido de exame exige a lista; relatorio exige o texto", () => {
    expect(esquemaEmitir.safeParse({ ...base, tipo: "pedido_exame", conteudo: {} }).success).toBe(false);
    expect(esquemaEmitir.safeParse({ ...base, tipo: "pedido_exame", conteudo: { exames: ["Hemograma completo"] } }).success).toBe(true);
    expect(esquemaEmitir.safeParse({ ...base, tipo: "relatorio", conteudo: {} }).success).toBe(false);
    expect(esquemaEmitir.safeParse({ ...base, tipo: "relatorio", conteudo: { texto: "Paciente em acompanhamento." } }).success).toBe(true);
  });

  it("8. tipo inventado nao passa", () => {
    expect(esquemaEmitir.safeParse({ ...base, tipo: "receita_magica", conteudo: {} }).success).toBe(false);
  });
});
