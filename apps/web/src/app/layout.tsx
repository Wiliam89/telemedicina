import { TarjaDeAmbiente } from "@/componentes/TarjaDeAmbiente";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BotaoSair } from "@/componentes/BotaoSair";
import { usuarioAtual } from "@/lib/supabase-servidor";
import "./globals.css";

/**
 * LAYOUT RAIZ - a moldura de todas as telas.
 *
 * E um Server Component: pergunta ao Supabase quem esta logado (pelo cookie)
 * e monta o cabecalho certo - "Entrar / Criar conta" ou "Inicio / Sair".
 *
 * lang="pt-BR" nao e enfeite: leitores de tela usam isso para escolher a
 * pronuncia. Acessibilidade em saude e requisito, nao cortesia.
 */
export const metadata: Metadata = {
  title: { default: "Telemedicina", template: "%s - Telemedicina" },
  description: "Atendimento medico a distancia",
  robots: { index: false, follow: false },
};

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const usuario = await usuarioAtual();

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-papel font-sans text-tinta antialiased">
        <TarjaDeAmbiente />
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-superficie focus:px-3 focus:py-2">
          Pular para o conteudo
        </a>
        <header className="border-b border-linha bg-superficie">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href={usuario ? "/clinicas" : "/"} className="font-titulo text-xl tracking-tight text-tinta">
              Telemedicina
            </Link>
            <nav aria-label="Principal" className="flex items-center gap-5 text-sm">
              {usuario ? (
                <>
                  <Link href="/clinicas" className="hover:underline underline-offset-4">Minhas clinicas</Link>
                  <BotaoSair />
                </>
              ) : (
                <>
                  <Link href="/entrar" className="hover:underline underline-offset-4">Entrar</Link>
                  <Link href="/criar-conta" className="rounded-md bg-selo px-3 py-1.5 text-white hover:bg-selo/90">Criar conta</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main id="conteudo" className="mx-auto max-w-3xl px-4 py-10">
          {children}
        </main>
      </body>
    </html>
  );
}
