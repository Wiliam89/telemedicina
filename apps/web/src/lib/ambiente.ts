/**
 * Variaveis publicas do frontend (apps/web/.env.local).
 *
 * Todas comecam com NEXT_PUBLIC_ porque vao para o navegador. Por isso
 * aqui NUNCA pode existir uma chave secreta.
 *
 * Verificamos na inicializacao: melhor quebrar ao subir do que descobrir
 * a variavel faltando com um paciente na tela.
 */
function obrigatoria(nome: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(
      `${nome} nao esta definida em apps/web/.env.local. Rode "pnpm verificar" na raiz do projeto.`,
    );
  }
  return valor;
}

export const ambiente = {
  supabaseUrl: obrigatoria("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: obrigatoria(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333",
} as const;

if (ambiente.supabasePublishableKey.startsWith("sb_secret_")) {
  throw new Error(
    "CHAVE SECRETA NO FRONTEND. Remova sb_secret_ de apps/web/.env.local e rotacione a chave no painel do Supabase.",
  );
}
