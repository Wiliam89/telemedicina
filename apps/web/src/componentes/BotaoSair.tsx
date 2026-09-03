"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/** Encerra a sessao no Supabase (apaga o cookie) e volta para a capa. */
export function BotaoSair() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    await criarClienteNavegador().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button onClick={sair} disabled={saindo} className="text-sm text-tinta-suave underline-offset-4 hover:text-tinta hover:underline">
      {saindo ? "Saindo..." : "Sair"}
    </button>
  );
}
