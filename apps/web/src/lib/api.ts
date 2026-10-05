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
          ? `A API em ${ambiente.apiUrl} nao respondeu. Ela esta rodando? (pnpm dev)`
          : `Nao foi possivel falar com a API em ${ambiente.apiUrl}. Se ela estiver no ar, as causas mais comuns sao o endereco deste site nao estar em ORIGEM_PERMITIDA no servidor da API, ou a API ter demorado a acordar depois de um tempo parada - neste caso, tente de novo em alguns segundos.`,
      },
    };
  }
}
