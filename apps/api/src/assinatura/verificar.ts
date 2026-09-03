/**
 * =====================================================================
 * VERIFICACAO DE UM PDF ASSINADO
 * =====================================================================
 *
 * Guardar um PDF assinado nao basta: a plataforma precisa saber CONFERIR
 * a assinatura. E o que permite a tela dizer "assinado e integro" em vez
 * de "tem um arquivo aqui", e o que detecta um PDF trocado no
 * armazenamento.
 *
 * A conferencia refaz o caminho da assinatura, ao contrario:
 *
 *   1. le o ByteRange e recalcula o hash dos trechos assinados;
 *   2. abre o CMS e confere que o atributo messageDigest bate com esse
 *      hash - e o que liga a assinatura AO CONTEUDO deste PDF;
 *   3. confere a assinatura RSA sobre os atributos autenticados, com a
 *      chave publica do certificado - e o que liga a assinatura AO
 *      TITULAR do certificado.
 *
 * Os dois passos sao necessarios: sem o (2), alguem colaria uma assinatura
 * valida de outro documento; sem o (3), alguem forjaria os atributos.
 *
 * O que esta funcao NAO faz: conferir se o certificado pertence a cadeia
 * ICP-Brasil e se nao foi revogado. Isso exige as ACs raiz e consulta de
 * LCR/OCSP, e entra junto com o provedor de producao - por enquanto a
 * funcao devolve o titular para que a camada de cima decida.
 */
import { createHash, createVerify } from "node:crypto";
import forge from "node-forge";

export interface ResultadoDaVerificacao {
  /** O PDF nao foi alterado depois de assinado. */
  integro: boolean;
  /** A assinatura confere com a chave publica do certificado. */
  assinaturaValida: boolean;
  titular: { nome: string; cpf: string | null } | null;
  assinadoEm: Date | null;
  emissorDoCertificado: string | null;
  problema?: string;
}

const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

/** O nome em certificado ICP-Brasil de pessoa fisica vem como "NOME:CPF". */
function separarNomeECpf(commonName: string): { nome: string; cpf: string | null } {
  const partes = commonName.split(":");
  const possivelCpf = partes.length > 1 ? partes[partes.length - 1]!.replace(/\D/g, "") : "";
  if (possivelCpf.length === 11) return { nome: partes.slice(0, -1).join(":").trim(), cpf: possivelCpf };
  return { nome: commonName.trim(), cpf: null };
}

export function verificarPdfAssinado(pdfBytes: Uint8Array): ResultadoDaVerificacao {
  const vazio: ResultadoDaVerificacao = { integro: false, assinaturaValida: false, titular: null, assinadoEm: null, emissorDoCertificado: null };
  const buffer = Buffer.from(pdfBytes);
  const texto = buffer.toString("latin1");

  const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(texto);
  if (!br) return { ...vazio, problema: "O arquivo nao tem assinatura (ByteRange ausente)." };
  const [a, b, c, d] = br.slice(1).map(Number) as [number, number, number, number];

  // Os bytes que foram assinados: tudo, menos o buraco do /Contents.
  const conteudoAssinado = Buffer.concat([buffer.subarray(a, a + b), buffer.subarray(c, c + d)]);
  const hashDoPdf = createHash("sha256").update(conteudoAssinado).digest();

  const inicio = texto.indexOf("/Contents <", a);
  const fim = texto.indexOf(">", inicio);
  if (inicio < 0 || fim < 0) return { ...vazio, problema: "Assinatura ilegivel no arquivo." };
  const cmsHex = texto.slice(inicio + "/Contents <".length, fim).replace(/(00)+$/i, "");

  let p7: forge.pkcs7.PkcsSignedData & { certificates: forge.pki.Certificate[]; rawCapture: Record<string, unknown> };
  try {
    const der = forge.util.createBuffer(Buffer.from(cmsHex, "hex").toString("binary"));
    p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as never;
  } catch {
    return { ...vazio, problema: "Nao foi possivel ler a assinatura (CMS invalido)." };
  }

  const certificado = p7.certificates?.[0];
  if (!certificado) return { ...vazio, problema: "A assinatura nao traz o certificado do assinante." };

  const cn = certificado.subject.getField("CN")?.value ?? "";
  const titular = separarNomeECpf(String(cn));
  const emissor = String(certificado.issuer.getField("CN")?.value ?? certificado.issuer.getField("O")?.value ?? "");

  // --- 1) A assinatura se refere a ESTE conteudo? ---------------------------
  const atributos = (p7.rawCapture["authenticatedAttributes"] ?? []) as forge.asn1.Asn1[];
  let digestDeclarado: Buffer | null = null;
  let assinadoEm: Date | null = null;

  for (const attr of atributos) {
    const oid = forge.asn1.derToOid((attr.value as forge.asn1.Asn1[])[0]!.value as string);
    const valor = ((attr.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[])[0];
    if (oid === OID_MESSAGE_DIGEST) digestDeclarado = Buffer.from(valor!.value as string, "binary");
    if (oid === OID_SIGNING_TIME) {
      // UTCTIME vem como "260901120000Z"; o forge sabe interpretar.
      try {
        assinadoEm = forge.asn1.utcTimeToDate(valor!.value as string);
      } catch {
        const data = new Date(valor!.value as string);
        if (!Number.isNaN(data.getTime())) assinadoEm = data;
      }
    }
  }

  const integro = digestDeclarado !== null && digestDeclarado.equals(hashDoPdf);

  // --- 2) A assinatura foi feita pela chave deste certificado? --------------
  let assinaturaValida = false;
  try {
    // O que e assinado nao e o documento: e o conjunto de atributos
    // autenticados, serializado como SET OF (nao como [0] implicito).
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, atributos);
    const derAtributos = Buffer.from(forge.asn1.toDer(set).getBytes(), "binary");
    const assinatura = Buffer.from(p7.rawCapture["signature"] as string, "binary");
    const pem = forge.pki.publicKeyToPem(certificado.publicKey as forge.pki.rsa.PublicKey);

    const verificador = createVerify("RSA-SHA256");
    verificador.update(derAtributos);
    assinaturaValida = verificador.verify(pem, assinatura);
  } catch {
    assinaturaValida = false;
  }

  return {
    integro,
    assinaturaValida,
    titular,
    assinadoEm,
    emissorDoCertificado: emissor || null,
    ...(integro && assinaturaValida ? {} : { problema: !integro ? "O arquivo foi alterado depois de assinado." : "A assinatura nao confere com o certificado." }),
  };
}
