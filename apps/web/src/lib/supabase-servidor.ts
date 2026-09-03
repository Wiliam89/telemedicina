import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ambiente } from "./ambiente";

/**
 * Cliente do Supabase que roda NO SERVIDOR do Next (Server Components,
 * rotas, middleware). Le a sessao dos cookies que o navegador mandou.
 *
 * Continua usando so a chave publica: o servidor do site NAO tem a chave
 * secreta (ela mora na API). O que este cliente enxerga no banco e o que
 * o RLS deixa o usuario logado enxergar - nem mais, nem menos.
 */
export async function criarClienteServidor() {
  const jarra = await cookies();

  return createServerClient(ambiente.supabaseUrl, ambiente.supabasePublishableKey, {
    cookies: {
      getAll: () => jarra.getAll(),
      setAll: (lista: { name: string; value: string; options?: CookieOptions }[]) => {
        // Em Server Component nao da para gravar cookie; o middleware faz isso.
        try {
          for (const { name, value, options } of lista) jarra.set(name, value, options);
        } catch {
          /* ignorado de proposito */
        }
      },
    },
  });
}

/** O usuario logado, ou null. Pergunta ao Supabase (nao confia so no cookie). */
export async function usuarioAtual() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** O token de acesso da sessao atual, para chamar a API. */
export async function tokenAtual(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
