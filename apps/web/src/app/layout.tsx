import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { AvisoDeCookies } from "@/componentes/AvisoDeCookies";
import { TarjaDeAmbiente } from "@/componentes/TarjaDeAmbiente";
import { NOME_DA_PLATAFORMA } from "@/lib/marca";
import "./globals.css";

/**
 * LAYOUT RAIZ - so o que e comum a TODAS as telas: fontes, tarja de
 * ambiente e o atalho de acessibilidade. A moldura muda conforme a area:
 *   (publico)   cabecalho e rodape do site
 *   (acesso)    tela dividida de entrar / criar conta
 *   c/[clinica] o painel com menu lateral
 *
 * lang="pt-BR" nao e enfeite: leitores de tela usam isso para escolher a
 * pronuncia. Acessibilidade em saude e requisito, nao cortesia.
 */
const texto = Inter({ subsets: ["latin"], variable: "--fonte-texto", display: "swap" });
const titulo = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--fonte-titulo", display: "swap" });

export const metadata: Metadata = {
  title: { default: NOME_DA_PLATAFORMA, template: `%s · ${NOME_DA_PLATAFORMA}` },
  description: "Plataforma de telemedicina: agenda, teleconsulta, prontuário eletrônico e documentos com assinatura digital.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b7f7a" };

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${texto.variable} ${titulo.variable}`}>
      <body className="min-h-screen bg-papel font-sans text-tinta antialiased">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-superficie focus:px-3 focus:py-2 focus:shadow-flutuante"
        >
          Pular para o conteúdo
        </a>
        <TarjaDeAmbiente />
        {children}
        <AvisoDeCookies />
      </body>
    </html>
  );
}
