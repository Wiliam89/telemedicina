import Link from "next/link";
import type { ReactNode } from "react";
import { BotaoSair } from "@/componentes/BotaoSair";
import { LinkBotao } from "@/componentes/Botao";
import { Marca } from "@/componentes/Marca";
import { ENCARREGADO } from "@/lib/marca";
import { usuarioAtual } from "@/lib/supabase-servidor";

/**
 * Moldura das paginas publicas e das de "antes da clinica" (escolher
 * clinica, completar perfil, aceitar convite). Server Component: pergunta
 * ao Supabase quem esta logado e monta o cabecalho certo.
 */
export default async function LayoutPublico({ children }: { children: ReactNode }) {
  const usuario = await usuarioAtual();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-linha/80 bg-superficie/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Marca href={usuario ? "/clinicas" : "/"} />
          <nav aria-label="Principal" className="flex items-center gap-2 text-sm sm:gap-4">
            <Link href="/validar" className="hidden rounded-lg px-3 py-2 text-tinta-suave hover:bg-marinho-suave hover:text-tinta sm:inline-block">
              Validar documento
            </Link>
            {usuario ? (
              <>
                <Link href="/clinicas" className="rounded-lg px-3 py-2 text-tinta-suave hover:bg-marinho-suave hover:text-tinta">
                  Minhas clínicas
                </Link>
                <Link href="/conta" className="hidden rounded-lg px-3 py-2 text-tinta-suave hover:bg-marinho-suave hover:text-tinta sm:inline-block">
                  Minha conta
                </Link>
                <BotaoSair />
              </>
            ) : (
              <>
                <Link href="/entrar" className="rounded-lg px-3 py-2 font-medium text-tinta hover:bg-marinho-suave">
                  Entrar
                </Link>
                <LinkBotao href="/criar-conta" tamanho="p">
                  Criar conta
                </LinkBotao>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="conteudo" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-linha bg-superficie">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-tinta-suave sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1">
            <Marca />
            <p>Dados hospedados no Brasil (São Paulo). Resolução CFM 2.314/2022 e LGPD.</p>
          </div>
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/validar" className="hover:text-tinta">Validar documento</Link>
            <Link href="/termos" className="hover:text-tinta">Termos de uso</Link>
            <Link href="/privacidade" className="hover:text-tinta">Privacidade</Link>
            <a href={"mailto:" + ENCARREGADO.email} className="hover:text-tinta">Encarregado de dados</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
