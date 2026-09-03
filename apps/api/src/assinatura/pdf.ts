/**
 * =====================================================================
 * GERACAO DO PDF DO DOCUMENTO
 * =====================================================================
 *
 * Ate o Modulo 8, o documento existia como texto. A partir daqui ele vira
 * PDF - porque e o PDF que a farmacia recebe, que o RH arquiva e que o
 * validador do ITI abre. A assinatura ICP-Brasil em padrao PAdES vive
 * DENTRO do PDF, entao sem PDF nao ha assinatura.
 *
 * O PDF e montado a partir do MESMO texto canonico cujo hash foi guardado
 * na emissao (Modulo 8). Assim continuam existindo duas provas
 * independentes: o hash do texto (que a validacao publica mostra) e a
 * assinatura criptografica do PDF.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface DadosDoPdf {
  textoImpresso: string;
  tipo: string;
  numero: number;
  ano: number;
  codigoValidacao: string;
  hashTexto: string;
  /** Endereco publico de conferencia, impresso no rodape. */
  urlValidacao: string;
}

const MARGEM = 56; // ~2 cm
const LARGURA = 595.28; // A4 em pontos
const ALTURA = 841.89;

/** Quebra o texto em linhas que cabem na largura util. */
function quebrar(texto: string, fonte: { widthOfTextAtSize: (t: string, s: number) => number }, tamanho: number, largura: number): string[] {
  const saida: string[] = [];
  for (const linha of texto.split("\n")) {
    if (fonte.widthOfTextAtSize(linha, tamanho) <= largura) {
      saida.push(linha);
      continue;
    }
    let atual = "";
    for (const palavra of linha.split(" ")) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) atual = tentativa;
      else {
        if (atual) saida.push(atual);
        atual = palavra;
      }
    }
    saida.push(atual);
  }
  return saida;
}

/**
 * Monta o PDF. Usa fonte monoespacada de propósito: o texto canonico foi
 * pensado em colunas (separadores de 64 tracos), e fonte proporcional
 * desalinharia tudo.
 */
export async function gerarPdfDocumento(d: DadosDoPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.tipo} ${d.numero}/${d.ano}`);
  pdf.setSubject(`Documento medico - codigo ${d.codigoValidacao}`);
  // Sem data de criacao variavel: dois PDFs do mesmo documento devem ser
  // iguais byte a byte, senao a reemissao mudaria o arquivo sem motivo.
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  pdf.setProducer("Plataforma de Telemedicina");
  pdf.setCreator("Plataforma de Telemedicina");

  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoNegrito = await pdf.embedFont(StandardFonts.CourierBold);

  const tamanho = 9;
  const alturaLinha = tamanho * 1.45;
  const larguraUtil = LARGURA - MARGEM * 2;
  const linhas = quebrar(d.textoImpresso, mono, tamanho, larguraUtil);

  let pagina = pdf.addPage([LARGURA, ALTURA]);
  let y = ALTURA - MARGEM;

  const rodape = (p: typeof pagina) => {
    p.drawLine({
      start: { x: MARGEM, y: MARGEM + 34 },
      end: { x: LARGURA - MARGEM, y: MARGEM + 34 },
      thickness: 0.5,
      color: rgb(0.75, 0.8, 0.83),
    });
    p.drawText(`Confira a autenticidade em ${d.urlValidacao}`, { x: MARGEM, y: MARGEM + 22, size: 7.5, font: mono, color: rgb(0.35, 0.43, 0.48) });
    p.drawText(`codigo ${d.codigoValidacao}  |  SHA-256 ${d.hashTexto.slice(0, 32)}...`, { x: MARGEM, y: MARGEM + 11, size: 7, font: mono, color: rgb(0.35, 0.43, 0.48) });
  };

  for (const linha of linhas) {
    if (y < MARGEM + 60) {
      rodape(pagina);
      pagina = pdf.addPage([LARGURA, ALTURA]);
      y = ALTURA - MARGEM;
    }
    // As linhas de titulo (tudo em maiusculas, sem minusculas) saem em negrito.
    const titulo = linha.length > 0 && linha === linha.toUpperCase() && /[A-Z]/.test(linha);
    pagina.drawText(linha, { x: MARGEM, y, size: tamanho, font: titulo ? monoNegrito : mono, color: rgb(0.06, 0.16, 0.24) });
    y -= alturaLinha;
  }
  rodape(pagina);

  return pdf.save({ useObjectStreams: false });
}
