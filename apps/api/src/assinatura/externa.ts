/**
 * =====================================================================
 * ASSINATURA FEITA FORA DA PLATAFORMA (ADR-0017)
 * =====================================================================
 *
 * O medico baixa o PDF do documento, assina no programa que ja usa - o
 * aplicativo do certificado em nuvem (VIDaaS, BirdID, SafeID...), o
 * Assinador do ITI, o Adobe com token A3 - e envia o arquivo de volta.
 *
 * Antes de aceitar, conferimos quatro coisas. Qualquer uma falhando, o
 * arquivo e recusado e o documento continua "emitido":
 *
 *   1. ha assinatura e ela e matematicamente valida (o conteudo nao mudou
 *      depois de assinado, e a chave do certificado assinou);
 *   2. a assinatura cobre o arquivo INTEIRO - nada foi acrescentado depois;
 *   3. o arquivo e ESTE documento: os metadados trazem o codigo de
 *      validacao e o SHA-256 do texto que guardamos;
 *   4. quem assinou e o medico que emitiu: o CPF do certificado e o do
 *      cadastro (ou, se o certificado nao trouxer CPF, o nome confere).
 *
 * A validade juridica da cadeia ICP-Brasil (certificado emitido por AC
 * credenciada, nao revogado) e confirmada no validador oficial do ITI -
 * a pagina /validar leva ate ele.
 */
import { PDFDocument } from "pdf-lib";
import { verificarPdfAssinado, type ResultadoDaVerificacao } from "./verificar.js";

export interface DocumentoEsperado {
  codigoValidacao: string;
  hashTexto: string;
  medicoNome: string;
  medicoCpf: string | null;
}

export type ResultadoExterno =
  | { aceito: true; conferencia: ResultadoDaVerificacao; quantidadeDeAssinaturas: number }
  | { aceito: false; motivo: string };

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(DR|DRA)\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export async function conferirAssinaturaExterna(arquivo: Uint8Array, esperado: DocumentoEsperado): Promise<ResultadoExterno> {
  const texto = Buffer.from(arquivo).toString("latin1");
  if (!texto.startsWith("%PDF-")) return { aceito: false, motivo: "O arquivo enviado não é um PDF." };

  // --- 1) assinatura valida ------------------------------------------------
  const conferencia = verificarPdfAssinado(arquivo);
  if (!conferencia.integro || !conferencia.assinaturaValida) {
    return { aceito: false, motivo: conferencia.problema ?? "A assinatura do arquivo não é válida - o conteúdo pode ter sido alterado depois de assinado." };
  }

  // --- 2) cobre o arquivo inteiro -------------------------------------------
  // Com varias assinaturas (cada programa acrescenta a sua), vale a ULTIMA:
  // ela tem de terminar exatamente no fim do arquivo.
  const intervalos = [...texto.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => m.slice(1).map(Number) as [number, number, number, number]);
  const ultimo = intervalos.sort((x, y) => x[2] + x[3] - (y[2] + y[3])).at(-1)!;
  const fimAssinado = ultimo[2] + ultimo[3];
  // Alguns programas deixam uma quebra de linha depois do %%EOF.
  if (arquivo.length - fimAssinado > 2) {
    return { aceito: false, motivo: "O arquivo tem conteúdo acrescentado depois da assinatura. Envie o PDF exatamente como saiu do assinador." };
  }

  // --- 3) e este documento ---------------------------------------------------
  let palavras = "";
  let assunto = "";
  try {
    const pdf = await PDFDocument.load(arquivo, { updateMetadata: false, ignoreEncryption: true });
    palavras = pdf.getKeywords() ?? "";
    assunto = pdf.getSubject() ?? "";
  } catch {
    return { aceito: false, motivo: "Não foi possível ler o PDF enviado." };
  }
  const temCodigo = palavras.includes(`codigo:${esperado.codigoValidacao}`) || assunto.includes(esperado.codigoValidacao);
  const temHash = palavras.includes(`sha256:${esperado.hashTexto}`);
  if (!temCodigo || !temHash) {
    return { aceito: false, motivo: "Este PDF não é deste documento. Baixe o PDF pela plataforma, assine e envie o mesmo arquivo." };
  }

  // --- 4) quem assinou -------------------------------------------------------
  const titular = conferencia.titular;
  if (!titular) return { aceito: false, motivo: "Não foi possível identificar o titular do certificado." };
  if (titular.cpf && esperado.medicoCpf && titular.cpf !== esperado.medicoCpf) {
    return { aceito: false, motivo: "O PDF foi assinado com o certificado de outra pessoa (CPF diferente do seu cadastro)." };
  }
  if (!titular.cpf || !esperado.medicoCpf) {
    if (normalizar(titular.nome) !== normalizar(esperado.medicoNome)) {
      return { aceito: false, motivo: `O PDF foi assinado por "${titular.nome}", que não confere com o médico que emitiu o documento.` };
    }
  }

  return { aceito: true, conferencia, quantidadeDeAssinaturas: intervalos.length };
}
