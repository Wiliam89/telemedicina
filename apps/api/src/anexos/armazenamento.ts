import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TAMANHO_MAXIMO_ANEXO, TIPOS_DE_ARQUIVO_ACEITOS } from "@tele/shared/prontuario";

/**
 * Onde moram os ARQUIVOS dos anexos (exames, laudos). O banco guarda so a
 * ficha do arquivo (titulo, hash, tamanho); o conteudo fica num balde
 * PRIVADO do Supabase Storage, em Sao Paulo como o resto (ADR-0001).
 *
 * Ninguem recebe o caminho do arquivo: a API entrega um link temporario,
 * de poucos minutos, a quem pode ver - e audita a entrega.
 */
export const BALDE_ANEXOS = "anexos-clinicos";
const VALIDADE_DO_LINK_SEGUNDOS = 300;

export interface ArmazenamentoDeAnexos {
  guardar(caminho: string, conteudo: Uint8Array, tipo: string): Promise<{ hash: string }>;
  linkTemporario(caminho: string, nomeParaBaixar: string): Promise<string>;
}

export class ArmazenamentoSupabaseDeAnexos implements ArmazenamentoDeAnexos {
  private readonly supabase: SupabaseClient;
  private baldeConferido = false;

  constructor(url: string, chaveSecreta: string) {
    this.supabase = createClient(url, chaveSecreta, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async garantirBalde(): Promise<void> {
    if (this.baldeConferido) return;
    const { data } = await this.supabase.storage.getBucket(BALDE_ANEXOS);
    if (!data) {
      const { error } = await this.supabase.storage.createBucket(BALDE_ANEXOS, {
        public: false,
        allowedMimeTypes: [...TIPOS_DE_ARQUIVO_ACEITOS],
        fileSizeLimit: TAMANHO_MAXIMO_ANEXO,
      });
      if (error && !/exist/i.test(error.message)) throw new Error(`Não foi possível preparar o armazenamento de anexos: ${error.message}`);
    }
    this.baldeConferido = true;
  }

  async guardar(caminho: string, conteudo: Uint8Array, tipo: string): Promise<{ hash: string }> {
    await this.garantirBalde();
    const { error } = await this.supabase.storage.from(BALDE_ANEXOS).upload(caminho, conteudo, { contentType: tipo, upsert: false });
    if (error) throw new Error(`Falha ao guardar o anexo: ${error.message}`);
    return { hash: createHash("sha256").update(conteudo).digest("hex") };
  }

  async linkTemporario(caminho: string, nomeParaBaixar: string): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(BALDE_ANEXOS)
      .createSignedUrl(caminho, VALIDADE_DO_LINK_SEGUNDOS, { download: nomeParaBaixar });
    if (error || !data) throw new Error(`Falha ao gerar o link do anexo: ${error?.message}`);
    return data.signedUrl;
  }
}

/** Para os testes: guarda em memoria. */
export class ArmazenamentoEmMemoriaDeAnexos implements ArmazenamentoDeAnexos {
  readonly arquivos = new Map<string, Uint8Array>();
  async guardar(caminho: string, conteudo: Uint8Array): Promise<{ hash: string }> {
    if (this.arquivos.has(caminho)) throw new Error("ja existe");
    this.arquivos.set(caminho, conteudo);
    return { hash: createHash("sha256").update(conteudo).digest("hex") };
  }
  async linkTemporario(caminho: string): Promise<string> {
    return `memoria://${caminho}`;
  }
}

/** Confere pelos primeiros bytes que o arquivo e mesmo o que diz ser. */
export function tipoPelosBytes(b: Uint8Array): (typeof TIPOS_DE_ARQUIVO_ACEITOS)[number] | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
