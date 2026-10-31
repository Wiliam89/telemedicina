"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { acaoNaApi } from "@/lib/navegador";

/**
 * Suspender e reativar quem trabalha na clinica. A suspensao vale na hora: a
 * pessoa perde o acesso a esta clinica, e o historico dela fica guardado.
 */
export function AcoesDoMembro({ slug, perfilId, nome, suspenso }: { slug: string; perfilId: string; nome: string; suspenso: boolean }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function aplicar() {
    setMsg(null);
    setOcupado(true);
    const r = await acaoNaApi<{ status: string; consultasFuturas?: number }>(`/membros/${perfilId}/${suspenso ? "reativar" : "suspender"}`, { metodo: "POST", clinica: slug });
    setOcupado(false);
    setConfirmando(false);
    if (!r.ok) return setMsg({ tipo: "erro", texto: r.erro.mensagem });
    const futuras = r.dados.consultasFuturas ?? 0;
    if (futuras > 0) setMsg({ tipo: "ok", texto: `${nome} tem ${futuras} consulta(s) marcada(s). Remarque ou cancele na agenda.` });
    router.refresh();
  }

  if (suspenso) {
    return (
      <div className="w-full space-y-2 sm:w-auto">
        <Botao variante="secundario" tamanho="p" onClick={aplicar} carregando={ocupado}>Reativar</Botao>
        {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      </div>
    );
  }

  return (
    <div className="w-full space-y-2 sm:w-auto">
      {confirmando ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm">Suspender o acesso de {nome}?</span>
          <Botao tamanho="p" onClick={aplicar} carregando={ocupado}>Confirmar</Botao>
          <Botao variante="fantasma" tamanho="p" onClick={() => setConfirmando(false)}>Voltar</Botao>
        </div>
      ) : (
        <Botao variante="fantasma" tamanho="p" onClick={() => setConfirmando(true)} className="text-alerta hover:text-alerta">Suspender</Botao>
      )}
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
    </div>
  );
}
