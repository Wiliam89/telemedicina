import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase-servidor";
import { destinoSeguro } from "@/lib/validacao";

/**
 * Para onde o link do e-mail de recuperacao de senha leva. O Supabase devolve um
 * codigo de uso unico, trocado aqui por uma sessao gravada em cookie.
 *
 * Este endereco precisa estar na lista "Redirect URLs" do painel do Supabase
 * (Authentication > URL Configuration). Sem isso, o Supabase recusa o retorno.
 */
export async function GET(req: NextRequest) {
  const codigo = req.nextUrl.searchParams.get("code");
  const destino = req.nextUrl.clone();
  destino.search = "";

  if (codigo) {
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(codigo);
    if (!error) {
      destino.pathname = destinoSeguro(req.nextUrl.searchParams.get("proximo"), "/clinicas");
      return NextResponse.redirect(destino);
    }
  }

  destino.pathname = "/recuperar-senha";
  destino.searchParams.set("erro", "link");
  return NextResponse.redirect(destino);
}
