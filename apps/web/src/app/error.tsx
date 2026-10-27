"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Botao, LinkBotao } from "@/componentes/Botao";

/**
 * Erro inesperado numa tela. Em vez da pagina branca do Next, uma
 * explicacao e dois caminhos. O detalhe tecnico fica no log do servidor
 * (com o codigo abaixo para achar), nunca na tela - pode conter dado.
 */
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const apiFora = /API.*(nao|não) respondeu|falar com a API/i.test(error.message);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-espera-suave text-espera">
        <RefreshCw className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="text-2xl">{apiFora ? "Serviço temporariamente indisponível" : "Algo deu errado"}</h1>
      <p className="text-sm text-tinta-suave">
        {apiFora
          ? "Não conseguimos falar com o servidor agora. Isso costuma se resolver em alguns segundos."
          : "Tivemos um problema ao carregar esta tela. Nada do que você já salvou foi perdido."}
      </p>
      <div className="flex gap-2">
        <Botao onClick={reset}>Tentar de novo</Botao>
        <LinkBotao href="/clinicas" variante="secundario">
          Ir para o início
        </LinkBotao>
      </div>
      {error.digest ? <p className="font-mono text-xs text-tinta-suave">Código: {error.digest}</p> : null}
    </div>
  );
}
