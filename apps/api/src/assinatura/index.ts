/**
 * Ponto unico de entrada da assinatura. Quem usa (as rotas) conhece so
 * isto - trocar de provedor nao muda nada la fora.
 */
export { gerarPdfDocumento, type DadosDoPdf } from "./pdf.js";
export { assinarPdf, pareceAssinado, prepararPdfParaAssinatura, type DadosDaAssinatura } from "./pades.js";
export { verificarPdfAssinado, type ResultadoDaVerificacao } from "./verificar.js";
export { ArmazenamentoDeDocumentos, BALDE_DOCUMENTOS } from "./armazenamento.js";
export { ErroDoProvedor, type Autorizacao, type CredenciaisDoMedico, type EscopoAssinatura, type ProvedorDeAssinatura } from "./provedor.js";
export { ProvedorLocalDeTeste } from "./provedor-local.js";
export { ProvedorBirdId, type ConfigBirdId } from "./provedor-birdid.js";



export { ResolvedorDeProvedor, criarProvedorDaPlataforma } from "./resolvedor.js";
export type { ResolvedorDeProvedor as TipoResolvedor } from "./resolvedor.js";
