/**
 * A conferencia do PDF assinado FORA da plataforma (ADR-0017). O "programa
 * externo" aqui e o proprio pipeline PAdES com o certificado de teste - o
 * arquivo que sai dele tem a mesma forma do que sai de um assinador real.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinarPdf, conferirAssinaturaExterna, gerarPdfDocumento, prepararPdfParaAssinatura, ProvedorLocalDeTeste } from "./assinatura/index.js";

const TEXTO = ["CLINICA VIDA", "RECEITA", "No 9/2026", "1. Amoxicilina 500 mg", "   1 cp de 8/8h por 7 dias"].join("\n");
const HASH = createHash("sha256").update(TEXTO).digest("hex");
const CPF = "52998224725";

async function gerar(codigo = "WXYZ-2345-6789") {
  return gerarPdfDocumento({ textoImpresso: TEXTO, tipo: "receita_simples", numero: 9, ano: 2026, codigoValidacao: codigo, hashTexto: HASH, urlValidacao: "http://localhost:3000/validar" });
}

async function assinarFora(pdf: Uint8Array, cpf = CPF) {
  const preparado = await prepararPdfParaAssinatura(pdf, { motivo: "Receita 9/2026", local: "Clinica Vida", nomeDoAssinante: "Medico de Teste" });
  const provedor = new ProvedorLocalDeTeste();
  const auth = await provedor.autorizar({ cpf, otp: ProvedorLocalDeTeste.OTP_DE_TESTE }, "unica");
  return (await assinarPdf(preparado, provedor, auth, "Receita 9/2026")).pdfAssinado;
}

const esperado = { codigoValidacao: "WXYZ-2345-6789", hashTexto: HASH, medicoNome: "Médico de Teste", medicoCpf: CPF };

describe("assinatura externa: o que entra e o que e recusado", () => {
  it("1. aceita o PDF deste documento, assinado pelo medico que o emitiu", async () => {
    const r = await conferirAssinaturaExterna(await assinarFora(await gerar()), esperado);
    expect(r.aceito).toBe(true);
    if (r.aceito) expect(r.conferencia.titular?.cpf).toBe(CPF);
  });

  it("2. recusa PDF sem assinatura", async () => {
    const r = await conferirAssinaturaExterna(await gerar(), esperado);
    expect(r).toMatchObject({ aceito: false });
  });

  it("3. recusa arquivo que nao e PDF", async () => {
    const r = await conferirAssinaturaExterna(new Uint8Array(Buffer.from("MZ executavel")), esperado);
    expect(r).toMatchObject({ aceito: false, motivo: expect.stringMatching(/não é um PDF/) });
  });

  it("4. recusa conteudo acrescentado depois da assinatura", async () => {
    const assinado = await assinarFora(await gerar());
    const acrescido = new Uint8Array(Buffer.concat([Buffer.from(assinado), Buffer.from("\n% pagina extra inserida depois\n1 0 obj << >> endobj\n")]));
    const r = await conferirAssinaturaExterna(acrescido, esperado);
    expect(r).toMatchObject({ aceito: false, motivo: expect.stringMatching(/acrescentado/) });
  });

  it("5. recusa um byte alterado dentro do conteudo assinado", async () => {
    const assinado = Buffer.from(await assinarFora(await gerar()));
    const i = assinado.indexOf("Amoxicilina") >= 0 ? assinado.indexOf("Amoxicilina") : 200;
    assinado[i] = assinado[i]! ^ 0x01;
    const r = await conferirAssinaturaExterna(new Uint8Array(assinado), esperado);
    expect(r.aceito).toBe(false);
  });

  it("6. recusa o PDF assinado de OUTRO documento", async () => {
    const outro = await assinarFora(await gerar("AAAA-BBBB-CCCC"));
    const r = await conferirAssinaturaExterna(outro, esperado);
    expect(r).toMatchObject({ aceito: false, motivo: expect.stringMatching(/não é deste documento/) });
  });

  it("7. recusa assinatura com certificado de outra pessoa", async () => {
    const r = await conferirAssinaturaExterna(await assinarFora(await gerar(), "11144477735"), esperado);
    expect(r).toMatchObject({ aceito: false, motivo: expect.stringMatching(/outra pessoa/) });
  });

  it("8. sem CPF no cadastro, confere pelo nome (sem acento, sem 'Dr.')", async () => {
    const assinado = await assinarFora(await gerar());
    expect((await conferirAssinaturaExterna(assinado, { ...esperado, medicoCpf: null, medicoNome: "Dr. Médico de Teste" })).aceito).toBe(true);
    expect((await conferirAssinaturaExterna(assinado, { ...esperado, medicoCpf: null, medicoNome: "Outra Pessoa" })).aceito).toBe(false);
  });
});
