import type { Resposta } from "@tele/shared";
import { ambiente } from "./ambiente";

/**
 * Na pagina gerada no servidor, a API veria o IP da Vercel: a auditoria perderia
 * quem acessou, e todos dividiriam o mesmo limite de requisicoes. Aqui o site conta
 * o IP real, com um segredo que so existe no servidor. Sem SEGREDO_SITE_API, nao
 * envia nada e tudo funciona como antes.
 */
async function cabecalhosDoServidor(): Promise<Record<string, string>> {
  if (typeof window !== "undefined" || !process.env.SEGREDO_SITE_API) return {};
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return ip ? { "x-ip-do-usuario": ip, "x-segredo-do-site": process.env.SEGREDO_SITE_API } : {};
  } catch {
    return {}; // fora de uma requisicao (ex.: durante o build)
  }
}

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
        ...(await cabecalhosDoServidor()),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      cache: "no-store",
      // Escrita espera mais: o provedor de pagamento ou de assinatura pode levar ate
      // 20 s, e desistir antes faria a pessoa repetir algo que deu certo.
      signal: AbortSignal.timeout(metodo === "GET" ? 8000 : 30000),
    });
    const json = (await r.json()) as Resposta<T>;
    return { status: r.status, ...json };
  } catch {
    /**
     * Cair aqui NAO quer dizer, necessariamente, que a API esta fora do ar.
     * O `fetch` lanca do mesmo jeito em tres casos bem diferentes, e a
     * primeira versao desta mensagem dizia sempre "rode pnpm dev" - o que
     * manda a pessoa procurar no lugar errado quando a plataforma esta
     * publicada. Por isso a mensagem agora depende de onde estamos.
     *
     *   1. a API realmente nao esta no ar (tipico em desenvolvimento);
     *   2. o navegador BLOQUEOU a resposta por CORS - a API respondeu, mas
     *      sem autorizar este endereco (ORIGEM_PERMITIDA errada no servidor);
     *   3. a resposta demorou mais que o tempo limite acima - comum quando a
     *      API esta hospedada em plano gratuito e "dorme" por inatividade:
     *      a primeira chamada depois de um tempo parado leva quase um minuto.
     */
    const local = ambiente.apiUrl.includes("localhost") || ambiente.apiUrl.includes("127.0.0.1");
    return {
      status: 0,
      ok: false,
      erro: {
        codigo: "API_FORA_DO_AR",
        mensagem: local
          ? `A API em ${ambiente.apiUrl} não respondeu. Ela esta rodando? (pnpm dev)`
          : "Não conseguimos falar com o servidor agora. Verifique sua internet e tente de novo em alguns segundos.",
      },
    };
  }
}
