/**
 * Le DATABASE_URL de apps/api/.env (o unico lugar onde a senha do banco
 * vive) e para com uma mensagem clara se estiver faltando ou incompleta.
 * Usado pelos scripts deste pacote: testar-conexao, migrar, verificar-tabelas.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

export const CAMINHO_ENV_API = resolve(import.meta.dirname, "../../../apps/api/.env");

export function lerDatabaseUrl(): string {
  config({ path: CAMINHO_ENV_API, quiet: true });
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error("DATABASE_URL vazia em apps/api/.env. Rode: pnpm verificar");
    process.exit(1);
  }
  if (url.includes("[YOUR-PASSWORD]")) {
    console.error("DATABASE_URL ainda contem [YOUR-PASSWORD]. Troque pela senha do banco.");
    process.exit(1);
  }
  return url;
}

/** Traduz os erros de conexao mais comuns. Devolve null se nao reconhecer. */
export function explicarErroDeConexao(erro: unknown): string | null {
  const msg = erro instanceof Error ? erro.message : String(erro);
  if (/password authentication failed/i.test(msg))
    return "Senha errada. Settings > Database > Reset database password.";
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
    // O caso mais comum de todos: a pessoa copiou a conexao DIRETA
    // (db.<ref>.supabase.co), que so existe em IPv6. Numa rede IPv4 - a
    // maioria - o DNS simplesmente nao acha o endereco.
    if (/db\.[a-z0-9]+\.supabase\.co/i.test(msg)) {
      return [
        "Voce esta usando a conexao DIRETA (db.<projeto>.supabase.co), que so funciona por IPv6.",
        "       Troque pelo Session pooler: botao Connect > aba ORMs > Drizzle (ou Connection String, modo Session).",
        "       O endereco certo termina em pooler.supabase.com e contem a regiao (sa-east-1), na porta 5432.",
      ].join("\n");
    }
    return "Endereco errado. Copie de novo no botao Connect > ORMs > Drizzle (Session pooler).";
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(msg))
    return "Rede bloqueando a porta 5432? Tente a rede do celular para confirmar.";
  if (/Tenant or user not found/i.test(msg))
    return "O usuario deve ser postgres.<ref-do-projeto>, nao so 'postgres'. Copie de novo do Connect.";
  return null;
}
