/**
 * =====================================================================
 * PAdES: COMO A ASSINATURA ENTRA NO PDF
 * =====================================================================
 *
 * PAdES e o padrao de assinatura dentro de um PDF - o que o Adobe Reader
 * e o validador do ITI reconhecem. O processo tem uma sutileza que vale
 * entender, porque ela explica o codigo:
 *
 *   1. Abre-se espaco no PDF para a assinatura (o "placeholder"), com um
 *      campo /Contents vazio de tamanho fixo.
 *   2. Calcula-se o ByteRange: os dois trechos do arquivo que serao
 *      assinados - tudo, MENOS o buraco onde a assinatura vai entrar.
 *      (Nao da para assinar o arquivo inteiro: a assinatura faz parte dele,
 *      e assinar algo que contem a propria assinatura e impossivel.)
 *   3. Calcula-se o hash desses dois trechos.
 *   4. O hash vai ao provedor, o medico autoriza no celular, volta o CMS.
 *   5. O CMS e escrito no buraco. O PDF fica assinado.
 *
 * O passo 4 e o unico que sai da nossa infraestrutura - e sai so o hash.
 */
import { createHash } from "node:crypto";
import { SignPdf } from "@signpdf/signpdf";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { Signer } from "@signpdf/utils";
import { PDFDocument } from "pdf-lib";
import type { AssinaturaPronta, Autorizacao, ProvedorDeAssinatura } from "./provedor.js";

/** Espaco reservado para a assinatura. Generoso: CMS com carimbo do tempo cresce. */
const TAMANHO_DA_ASSINATURA = 16384;

export interface DadosDaAssinatura {
  motivo: string;
  local: string;
  nomeDoAssinante: string;
  contato?: string;
}

/**
 * Insere o espaco da assinatura e devolve o PDF preparado.
 * Separado do resto porque e este PDF - e nao o original - que sera
 * assinado e guardado.
 */
export async function prepararPdfParaAssinatura(pdfBytes: Uint8Array, dados: DadosDaAssinatura): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  pdflibAddPlaceholder({
    pdfDoc: pdf,
    reason: dados.motivo,
    location: dados.local,
    name: dados.nomeDoAssinante,
    contactInfo: dados.contato ?? "",
    signatureLength: TAMANHO_DA_ASSINATURA,
  });
  return pdf.save({ useObjectStreams: false });
}

/**
 * Assina o PDF preparado usando o provedor. O @signpdf calcula o
 * ByteRange e escreve o CMS no lugar certo; nos so fornecemos "como
 * assinar este pedaco de bytes" - que, no nosso caso, e "calcule o hash e
 * mande ao provedor de nuvem".
 */
export async function assinarPdf(
  pdfPreparado: Uint8Array,
  provedor: ProvedorDeAssinatura,
  autorizacao: Autorizacao,
  descricao: string,
): Promise<{ pdfAssinado: Uint8Array; assinatura: AssinaturaPronta }> {
  let capturada: AssinaturaPronta | null = null;

  /**
   * O @signpdf entrega os bytes do ByteRange e espera o CMS de volta.
   * Aqui esta o ponto exato em que a assinatura em nuvem se encaixa: em
   * vez de assinar com uma chave que a plataforma guarda (o que seria
   * inaceitavel - a chave e do medico), calculamos o hash e pedimos ao
   * provedor, que so devolve depois que o medico autorizar no celular.
   */
  class AssinadorEmNuvem extends Signer {
    override async sign(conteudo: Buffer): Promise<Buffer> {
      // O provedor recebe SO o hash - nunca estes bytes.
      const hashHex = createHash("sha256").update(conteudo).digest("hex");
      capturada = await provedor.assinar(autorizacao, { hashHex, descricao });
      return Buffer.from(capturada.cmsBase64, "base64");
    }
  }

  const signPdf = new SignPdf();
  const assinado = await signPdf.sign(Buffer.from(pdfPreparado), new AssinadorEmNuvem());

  if (!capturada) throw new Error("O provedor nao devolveu assinatura.");
  return { pdfAssinado: new Uint8Array(assinado), assinatura: capturada };
}

/**
 * Confere que o PDF tem estrutura de assinatura: dicionario /Sig, ByteRange
 * preenchido (nao mais o marcador de asteriscos) e conteudo no /Contents.
 */
export function pareceAssinado(pdfBytes: Uint8Array): boolean {
  const texto = Buffer.from(pdfBytes).toString("latin1");
  if (!texto.includes("/ByteRange")) return false;
  // O marcador vem como /ByteRange [0 /********** ...]; assinado, sao numeros.
  const byteRange = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(texto);
  return byteRange !== null && texto.includes("/Sig");
}
