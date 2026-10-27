"use client";

import { Cookie } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const CHAVE = "aviso-cookies-visto";

/**
 * A plataforma so usa o cookie de SESSAO (estritamente necessario: sem ele
 * nao ha login). Por isso o aviso informa e nao pede consentimento - e nao
 * existe botao "aceitar todos" para cookies que nao usamos.
 *
 * Lembrar que a pessoa ja viu e conveniencia local (localStorage), e o
 * aviso funciona mesmo se o navegador bloquear o armazenamento.
 */
export function AvisoDeCookies() {
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    try {
      setMostrar(!window.localStorage.getItem(CHAVE));
    } catch {
      setMostrar(true);
    }
  }, []);

  if (!mostrar) return null;

  function fechar() {
    try {
      window.localStorage.setItem(CHAVE, new Date().toISOString());
    } catch {
      /* sem armazenamento: o aviso volta na proxima visita, e tudo bem */
    }
    setMostrar(false);
  }

  return (
    <div role="region" aria-label="Aviso sobre cookies" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-linha bg-superficie p-4 shadow-flutuante sm:inset-x-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Cookie className="hidden h-6 w-6 shrink-0 text-selo sm:block" aria-hidden="true" />
        <p className="flex-1 text-sm text-tinta-suave">
          Usamos apenas o cookie necessário para manter você conectado com segurança. Nada de publicidade ou rastreamento.{" "}
          <Link href="/privacidade#cookies" className="font-medium text-selo hover:text-selo-forte">
            Saiba mais
          </Link>
        </p>
        <button onClick={fechar} className="rounded-lg bg-selo px-4 py-2 text-sm font-medium text-white hover:bg-selo-forte">
          Entendi
        </button>
      </div>
    </div>
  );
}
