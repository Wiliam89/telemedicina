/**
 * =====================================================================
 * CIFRAR SEGREDOS QUE PRECISAM FICAR NO BANCO
 * =====================================================================
 *
 * Quase nada precisa disto: senha vira hash (nao se decifra), token de
 * convite vira hash (Modulo 6). Mas o client secret do provedor de
 * assinatura e diferente - a API precisa do valor ORIGINAL para chamar o
 * provedor, entao hash nao serve.
 *
 * Usamos AES-256-GCM. GCM porque ele nao so esconde: ele DETECTA
 * alteracao. Se alguem trocar um byte do valor cifrado no banco, a
 * decifragem falha em vez de devolver lixo silenciosamente.
 *
 * A CHAVE VIVE FORA DO BANCO (CHAVE_CRIPTOGRAFIA, em apps/api/.env). Isso
 * e o ponto todo: quem obtiver um dump do banco nao tem como decifrar.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; // recomendado para GCM
const TAMANHO_TAG = 16;

/** Le a chave do ambiente e confere o tamanho. 32 bytes = 256 bits. */
export function lerChave(base64: string): Buffer {
  const chave = Buffer.from(base64, "base64");
  if (chave.length !== 32) {
    throw new Error(
      "CHAVE_CRIPTOGRAFIA deve ter 32 bytes em base64. Gere uma com:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return chave;
}

/**
 * Devolve "iv:tag:conteudo", tudo em base64. Guardar os tres juntos e o
 * normal: o IV e a tag nao sao segredos - o segredo e a chave.
 */
export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifrador = createCipheriv(ALGORITMO, chave, iv);
  const conteudo = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), conteudo.toString("base64")].join(":");
}

export function decifrar(guardado: string, chave: Buffer): string {
  const partes = guardado.split(":");
  if (partes.length !== 3) throw new Error("Valor cifrado em formato invalido.");

  const [ivB64, tagB64, conteudoB64] = partes as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) throw new Error("Valor cifrado em formato invalido.");

  const decifrador = createDecifrador(chave, iv, tag);
  // Se o conteudo tiver sido alterado, final() lanca - e e o que queremos.
  return Buffer.concat([decifrador.update(Buffer.from(conteudoB64, "base64")), decifrador.final()]).toString("utf8");
}

function createDecifrador(chave: Buffer, iv: Buffer, tag: Buffer) {
  const d = createDecipheriv(ALGORITMO, chave, iv);
  d.setAuthTag(tag);
  return d;
}
