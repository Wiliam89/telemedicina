/**
 * Testes da assinatura que rodam sem banco, sem rede e sem provedor real.
 *
 * O que se prova aqui e o nucleo criptografico: o PDF sai valido, a
 * assinatura confere, e um unico byte alterado e detectado. Se este
 * arquivo passar, o caminho todo esta correto - o que muda com um provedor
 * de verdade e so a origem do CMS.
 */
import { createHash, randomBytes } from "node:crypto";
import { cifrar, decifrar, lerChave } from "./criptografia.js";
import { describe, expect, it } from "vitest";
import { assinarPdf, criarProvedorDaPlataforma, gerarPdfDocumento, prepararPdfParaAssinatura, ProvedorLocalDeTeste, verificarPdfAssinado } from "./assinatura/index.js";

const TEXTO = ["CLINICA VIDA", "-".repeat(64), "RECEITA", "No 7/2026", "1. Dipirona 500mg", "   1 cp de 6/6h por 3 dias"].join("\n");

async function pdfAssinadoDeTeste() {
  const pdf = await gerarPdfDocumento({
    textoImpresso: TEXTO,
    tipo: "receita_simples",
    numero: 7,
    ano: 2026,
    codigoValidacao: "ABCD-EFGH-JKMN",
    hashTexto: createHash("sha256").update(TEXTO).digest("hex"),
    urlValidacao: "http://localhost:3000/validar",
  });
  const preparado = await prepararPdfParaAssinatura(pdf, { motivo: "Receita 7/2026", local: "Clinica Vida", nomeDoAssinante: "Dra. Ana" });
  const provedor = new ProvedorLocalDeTeste();
  const auth = await provedor.autorizar({ cpf: "52998224725", otp: ProvedorLocalDeTeste.OTP_DE_TESTE }, "unica");
  return assinarPdf(preparado, provedor, auth, "Receita 7/2026");
}

describe("geracao do PDF", () => {
  it("1. produz um PDF valido com o conteudo do documento", async () => {
    const pdf = await gerarPdfDocumento({
      textoImpresso: TEXTO, tipo: "receita_simples", numero: 7, ano: 2026,
      codigoValidacao: "ABCD-EFGH-JKMN", hashTexto: "a".repeat(64), urlValidacao: "http://x/validar",
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("2. e determinista: o mesmo documento gera sempre os mesmos bytes", async () => {
    const dados = { textoImpresso: TEXTO, tipo: "receita_simples", numero: 7, ano: 2026, codigoValidacao: "ABCD-EFGH-JKMN", hashTexto: "a".repeat(64), urlValidacao: "http://x/validar" };
    const a = await gerarPdfDocumento(dados);
    const b = await gerarPdfDocumento(dados);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("preparacao e assinatura (PAdES)", () => {
  it("3. o PDF preparado ganha o espaco da assinatura", async () => {
    const pdf = await gerarPdfDocumento({ textoImpresso: TEXTO, tipo: "receita_simples", numero: 1, ano: 2026, codigoValidacao: "A-B-C", hashTexto: "a".repeat(64), urlValidacao: "http://x" });
    const preparado = await prepararPdfParaAssinatura(pdf, { motivo: "m", local: "l", nomeDoAssinante: "n" });
    expect(preparado.length).toBeGreaterThan(pdf.length);
    expect(Buffer.from(preparado).toString("latin1")).toContain("/ByteRange");
  });

  it("4. o PDF assinado verifica como integro e com assinatura valida", async () => {
    const { pdfAssinado } = await pdfAssinadoDeTeste();
    const r = verificarPdfAssinado(pdfAssinado);
    expect(r.integro).toBe(true);
    expect(r.assinaturaValida).toBe(true);
  });

  it("5. o titular do certificado e lido do CMS (nome e CPF)", async () => {
    const { pdfAssinado } = await pdfAssinadoDeTeste();
    const r = verificarPdfAssinado(pdfAssinado);
    expect(r.titular?.cpf).toBe("52998224725");
    expect(r.titular?.nome).toContain("MEDICO");
  });

  it("6. alterar UM byte do PDF quebra a integridade", async () => {
    const { pdfAssinado } = await pdfAssinadoDeTeste();
    const adulterado = Buffer.from(pdfAssinado);
    adulterado[900] = adulterado[900]! ^ 0x01;
    const r = verificarPdfAssinado(new Uint8Array(adulterado));
    expect(r.integro).toBe(false);
    expect(r.problema).toContain("alterado");
  });

  it("7. arquivo sem assinatura e recusado com mensagem clara", () => {
    const r = verificarPdfAssinado(new Uint8Array(Buffer.from("%PDF-1.7 sem assinatura")));
    expect(r.integro).toBe(false);
    expect(r.problema).toContain("nao tem assinatura");
  });
});

describe("provedor local de teste", () => {
  it("8. recusa codigo errado e CPF invalido", async () => {
    const p = new ProvedorLocalDeTeste();
    await expect(p.autorizar({ cpf: "52998224725", otp: "999999" }, "unica")).rejects.toThrow(/Codigo incorreto/);
    await expect(p.autorizar({ cpf: "123", otp: "000000" }, "unica")).rejects.toThrow(/CPF/);
  });

  it("9. recusa assinar com autorizacao vencida", async () => {
    const p = new ProvedorLocalDeTeste();
    const vencida = { token: "local:52998224725:1", expiraEm: new Date(Date.now() - 1000), escopo: "unica" as const };
    await expect(p.assinar(vencida, { hashHex: "a".repeat(64), descricao: "x" })).rejects.toThrow(/venceu/);
  });
});

describe("escolha do provedor", () => {
  const base = {
    NODE_ENV: "development" as const, PORT: 3333,
    SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x",
    DATABASE_URL: "postgresql://a:b@c:5432/d", ORIGEM_PERMITIDA: "http://localhost:3000",
    ASSINATURA_PROVEDOR: "local_teste" as const,
  };

  it("10. em desenvolvimento, o provedor local e aceito", () => {
    expect(criarProvedorDaPlataforma(base).nome).toBe("local_teste");
  });

  it("11. em PRODUCAO, o provedor local e recusado: ele nao tem valor legal", () => {
    expect(() => criarProvedorDaPlataforma({ ...base, NODE_ENV: "production" })).toThrow(/nao tem valor legal|producao/i);
  });

  it("12. birdid sem credenciais completas e recusado", () => {
    expect(() => criarProvedorDaPlataforma({ ...base, ASSINATURA_PROVEDOR: "birdid" })).toThrow(/ASSINATURA_URL|ASSINATURA_CLIENT/);
  });
});

describe("criptografia do segredo da clinica", () => {
  const chave = lerChave(randomBytes(32).toString("base64"));

  it("13. cifra e decifra de volta o mesmo valor", () => {
    const segredo = "client-secret-do-provedor-123";
    const guardado = cifrar(segredo, chave);
    expect(guardado).not.toContain(segredo);
    expect(decifrar(guardado, chave)).toBe(segredo);
  });

  it("14. o mesmo valor cifrado duas vezes da resultados diferentes", () => {
    // Se fossem iguais, daria para saber que duas clinicas usam o mesmo
    // segredo so olhando o banco.
    expect(cifrar("igual", chave)).not.toBe(cifrar("igual", chave));
  });

  it("15. alterar o valor cifrado faz a decifragem FALHAR (nao devolve lixo)", () => {
    const guardado = cifrar("segredo", chave);
    const partes = guardado.split(":");
    const conteudo = Buffer.from(partes[2]!, "base64");
    conteudo[0] = conteudo[0]! ^ 0x01;
    const adulterado = [partes[0], partes[1], conteudo.toString("base64")].join(":");
    expect(() => decifrar(adulterado, chave)).toThrow();
  });

  it("16. chave errada nao decifra", () => {
    const outra = lerChave(randomBytes(32).toString("base64"));
    expect(() => decifrar(cifrar("segredo", chave), outra)).toThrow();
  });

  it("17. chave de tamanho errado e recusada com instrucao de como gerar", () => {
    expect(() => lerChave(Buffer.from("curta").toString("base64"))).toThrow(/32 bytes|randomBytes/);
  });
});
