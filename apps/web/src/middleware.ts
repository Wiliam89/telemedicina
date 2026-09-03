import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * MIDDLEWARE - roda antes de cada pagina, no servidor.
 *
 * Duas tarefas:
 *   1. Renovar a sessao: o Supabase entrega tokens que expiram em 1 hora;
 *      aqui eles sao renovados e regravados no cookie, para a pessoa nao
 *      ser deslogada no meio de uma consulta.
 *   2. Portaria das paginas: sem login, as telas internas mandam para
 *      /entrar (guardando para onde a pessoa queria ir); com login,
 *      /entrar e /criar-conta mandam para /clinicas, que decide o destino.
 *
 * Note que a portaria nao sabe nada de clinica: quem confere vinculo e a
 * API (e o RLS). Aqui so se pergunta "esta logado?".
 *
 * Nao usa src/lib/ambiente.ts de proposito: o middleware roda no "edge",
 * um ambiente enxuto, e le as variaveis direto.
 */
// /validar fica de fora de proposito: e a unica pagina publica, feita para
// farmacia, RH e laboratorio conferirem um documento sem ter conta.
const PAGINAS_PROTEGIDAS = ["/c", "/clinicas", "/completar-perfil", "/convite"];
// /entrar-na-clinica e semi-publica: mostra o nome da clinica sem login e
// so exige conta na hora de entrar. Por isso fica fora da lista.
const PAGINAS_SO_DESLOGADO = ["/entrar", "/criar-conta"];

export async function middleware(req: NextRequest) {
  let resposta = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (lista: { name: string; value: string; options?: CookieOptions }[]) => {
          for (const { name, value } of lista) req.cookies.set(name, value);
          resposta = NextResponse.next({ request: req });
          for (const { name, value, options } of lista) resposta.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser() valida o token com o Supabase (e renova se preciso).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const caminho = req.nextUrl.pathname;
  const protegida = PAGINAS_PROTEGIDAS.some((p) => caminho === p || caminho.startsWith(`${p}/`));
  const soDeslogado = PAGINAS_SO_DESLOGADO.some((p) => caminho === p);

  if (protegida && !user) {
    const destino = req.nextUrl.clone();
    destino.pathname = "/entrar";
    destino.searchParams.set("depois", caminho);
    return NextResponse.redirect(destino);
  }
  if (soDeslogado && user) {
    const destino = req.nextUrl.clone();
    destino.pathname = "/clinicas";
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  return resposta;
}

export const config = {
  // Tudo, menos arquivos estaticos e imagens.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
