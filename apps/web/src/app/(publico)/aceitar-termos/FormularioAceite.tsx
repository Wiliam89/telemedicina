"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TipoConsentimento } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CaixasDeAceite } from "@/componentes/CaixasDeAceite";
import { acaoNaApi } from "@/lib/navegador";

export function FormularioAceite({ pendentes, destino }: { pendentes: TipoConsentimento[]; destino: string }) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<TipoConsentimento>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (pendentes.some((t) => !marcados.has(t))) return setErro("Marque todos os itens para continuar.");
    setSalvando(true);
    const r = await acaoNaApi("/lgpd/consentimentos", { metodo: "POST", corpo: { tipos: [...marcados] } });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro.mensagem);
    router.push(destino);
    router.refresh();
  }

  return (
    <form onSubmit={confirmar} className="space-y-5" noValidate>
      <CaixasDeAceite tipos={pendentes} marcados={marcados} aoMudar={setMarcados} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao type="submit" carregando={salvando} className="w-full">
        Confirmar e continuar
      </Botao>
    </form>
  );
}
