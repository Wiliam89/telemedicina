import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase-servidor";
import { destinoSeguro } from "@/lib/validacao";

/**
 * Para onde os links de e-mail do Supabase levam: confirmacao de cadastro e
 * recuperacao de senha. Este endereco precisa estar em "Redirect URLs" no
 * painel do Supabase (Authentication > URL Configuration).
 *
 * O link pode chegar de tres jeitos, e os tres precisam terminar numa tela
 * que orienta - nunca numa pagina em branco:
 *
 *   ?code=...        o Supabase ja confirmou o e-mail e devolve um codigo de
 *                    uso unico, trocado aqui por uma sessao. A troca so
 *                    funciona NO MESMO NAVEGADOR em que a pessoa se
 *                    cadastrou (o segredo da troca fica nele). Quem abre o
 *                    e-mail no celular depois de se cadastrar no computador
 *                    cai no "nao deu": a conta ja esta confirmada, e basta
 *                    entrar com a senha.
 *
 *   ?token_hash=...  o modelo de e-mail recomendado (docs/publicar.md). Vai
 *                    para /confirmar-email, que confirma com um toque e
 *                    funciona em qualquer aparelho.
 *
 *   ?error=...       link vencido ou ja usado (leitores de e-mail de empresa
 *                    costumam "abrir" o link antes da pessoa).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const proximo = destinoSeguro(p.get("proximo"), "/clinicas");
  const ehRecuperacao = proximo.startsWith("/redefinir-senha") || p.get("type") === "recovery";

  const destino = req.nextUrl.clone();
  destino.search = "";

  const tokenHash = p.get("token_hash");
  if (tokenHash) {
    destino.pathname = "/confirmar-email";
    destino.searchParams.set("token_hash", tokenHash);
    destino.searchParams.set("type", p.get("type") ?? "email");
    if (p.get("proximo")) destino.searchParams.set("proximo", proximo);
    return NextResponse.redirect(destino);
  }

  const codigo = p.get("code");
  if (codigo) {
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(codigo);
    if (!error) {
      // `proximo` pode ter "?": montado como URL, e nao como caminho (senao vira %3F e a pagina nao existe).
      return NextResponse.redirect(new URL(proximo, req.nextUrl.origin));
    }
  }

  if (ehRecuperacao) {
    destino.pathname = "/recuperar-senha";
    destino.searchParams.set("erro", "link");
    return NextResponse.redirect(destino);
  }
  // Cadastro: com codigo, o e-mail ja foi confirmado e so a sessao nao abriu
  // neste navegador. Sem codigo (erro do Supabase), o link venceu ou ja foi usado.
  destino.pathname = "/entrar";
  destino.searchParams.set("aviso", codigo ? "confirmado" : "link");
  return NextResponse.redirect(destino);
}
