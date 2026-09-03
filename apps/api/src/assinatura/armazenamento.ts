/**
 * =====================================================================
 * ONDE O PDF ASSINADO FICA GUARDADO
 * =====================================================================
 *
 * No Supabase Storage, num balde PRIVADO. Privado importa: um balde
 * publico significaria que qualquer pessoa com o endereco do arquivo le a
 * receita de qualquer paciente - e endereco vaza (histórico do navegador,
 * mensagem encaminhada, log de servidor).
 *
 * O acesso e sempre por URL assinada de curta duracao, gerada na hora pela
 * API depois de conferir quem esta pedindo. E o mesmo modelo do resto da
 * plataforma: quem decide o acesso e o servidor, nunca o endereco.
 *
 * O balde e criado pela propria API na primeira vez, e nao por clique no
 * painel - pelo mesmo motivo da ADR-0004: o que nasce de clique nao tem
 * historico nem se reproduz em outro ambiente.
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BALDE_DOCUMENTOS = "documentos-assinados";

/** Quanto tempo o link de download vale. Curto de proposito. */
const VALIDADE_DO_LINK_SEGUNDOS = 300;

export class ArmazenamentoDeDocumentos {
  private readonly supabase: SupabaseClient;
  private baldeConferido = false;

  constructor(url: string, chaveSecreta: string) {
    this.supabase = createClient(url, chaveSecreta, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  /** Cria o balde privado se ainda nao existir. Roda uma vez por processo. */
  private async garantirBalde(): Promise<void> {
    if (this.baldeConferido) return;
    const { data } = await this.supabase.storage.getBucket(BALDE_DOCUMENTOS);
    if (!data) {
      const { error } = await this.supabase.storage.createBucket(BALDE_DOCUMENTOS, {
        public: false,
        allowedMimeTypes: ["application/pdf"],
        fileSizeLimit: "10MB",
      });
      // "already exists" acontece quando dois processos sobem juntos: tudo bem.
      if (error && !/exist/i.test(error.message)) {
        throw new Error(`Nao foi possivel preparar o armazenamento: ${error.message}`);
      }
    }
    this.baldeConferido = true;
  }

  /**
   * O caminho carrega a clinica: facilita separar, apagar por cliente e
   * auditar. `<clinica>/<ano>/<id>.pdf`
   */
  static caminhoDo(clinicaId: string, ano: number, documentoId: string): string {
    return `${clinicaId}/${ano}/${documentoId}.pdf`;
  }

  async guardar(caminho: string, pdf: Uint8Array): Promise<{ caminho: string; hash: string }> {
    await this.garantirBalde();
    const { error } = await this.supabase.storage.from(BALDE_DOCUMENTOS).upload(caminho, pdf, {
      contentType: "application/pdf",
      // Documento assinado nunca e substituido: se ja existe, algo esta errado.
      upsert: false,
    });
    if (error) throw new Error(`Falha ao guardar o documento assinado: ${error.message}`);
    return { caminho, hash: createHash("sha256").update(pdf).digest("hex") };
  }

  /** Baixa o arquivo - usado para conferir a assinatura e para o download. */
  async ler(caminho: string): Promise<Uint8Array> {
    const { data, error } = await this.supabase.storage.from(BALDE_DOCUMENTOS).download(caminho);
    if (error || !data) throw new Error(`Documento nao encontrado no armazenamento: ${error?.message ?? caminho}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  /** Link temporario, gerado so depois de a API conferir quem pediu. */
  async linkTemporario(caminho: string): Promise<string> {
    const { data, error } = await this.supabase.storage.from(BALDE_DOCUMENTOS).createSignedUrl(caminho, VALIDADE_DO_LINK_SEGUNDOS);
    if (error || !data) throw new Error(`Falha ao gerar o link: ${error?.message}`);
    return data.signedUrl;
  }
}
