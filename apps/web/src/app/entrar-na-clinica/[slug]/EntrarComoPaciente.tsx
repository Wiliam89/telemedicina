"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

export function EntrarComoPaciente({ slug, nome }: { slug: string; nome: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar() {
    setErro(null);
    setEntrando(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi(`/clinicas/${slug}/entrar`, { metodo: "POST", token: data.session?.access_token });
    if (r.ok) {
      router.push(`/c/${slug}/inicio`);
      router.refresh();
      return;
    }
    setErro(r.erro.mensagem);
    setEntrando(false);
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao onClick={entrar} carregando={entrando} className="w-full">
        Quero ser atendido em {nome}
      </Botao>
    </div>
  );
}
