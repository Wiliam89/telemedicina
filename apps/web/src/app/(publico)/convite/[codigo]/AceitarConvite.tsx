"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

interface Aceite {
  clinica: { slug: string; nomeFantasia: string };
  papel: string;
}

export function AceitarConvite({ codigo }: { codigo: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function aceitar() {
    setErro(null);
    setCarregando(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<Aceite>("/convites/aceitar", { metodo: "POST", token: data.session?.access_token, corpo: { codigo } });

    if (r.ok) {
      router.push(`/c/${r.dados.clinica.slug}/inicio`);
      router.refresh();
      return;
    }
    setErro(r.erro.mensagem);
    setCarregando(false);
  }

  return (
    <div className="space-y-4">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao onClick={aceitar} carregando={carregando} className="w-full">
        Aceitar convite
      </Botao>
    </div>
  );
}
