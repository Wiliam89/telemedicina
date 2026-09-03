import type { Resposta } from "@tele/shared";
import { ambiente } from "./ambiente";

/**
 * Uma unica funcao para falar com a API (apps/api), usada tanto no servidor
 * (com o token vindo do cookie) quanto no navegador (com o token da sessao).
 *
 * O parametro `clinica` e o endereco (slug) da clinica atual - vem sempre
 * da URL (/c/<slug>/...), nunca de um estado guardado, para nao existir a
 * chance de agir na clinica errada depois de trocar de aba.
 *
 * Devolve o envelope da API como veio: { ok: true, dados } ou
 * { ok: false, erro: { codigo, mensagem, detalhes? } }. Nunca lanca por
 * status HTTP - quem chama decide o que fazer com cada codigo.
 */
export async function chamarApi<T>(
  rota: string,
  opcoes: { metodo?: "GET" | "POST" | "PUT" | "PATCH"; token?: string | null; corpo?: unknown; clinica?: string | null } = {},
): Promise<{ status: number } & Resposta<T>> {
  const { metodo = "GET", token, corpo, clinica } = opcoes;
  try {
    const r = await fetch(`${ambiente.apiUrl}${rota}`, {
      method: metodo,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        // Diz a API em qual clinica estamos. Sem isto, as rotas de dentro
        // da clinica respondem 400.
        ...(clinica ? { "x-clinica": clinica } : {}),
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const json = (await r.json()) as Resposta<T>;
    return { status: r.status, ...json };
  } catch {
    return {
      status: 0,
      ok: false,
      erro: { codigo: "API_FORA_DO_AR", mensagem: `A API em ${ambiente.apiUrl} nao respondeu. Ela esta rodando? (pnpm dev)` },
    };
  }
}
