"use client";

import { useState } from "react";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * O link de download nao vem pronto na pagina: e pedido na hora do clique
 * e vale poucos minutos. Assim um endereco copiado por engano (histórico,
 * mensagem encaminhada) nao vira acesso permanente ao documento.
 */
export function BaixarDocumento({ slug, documentoId }: { slug: string; documentoId: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function baixar() {
    setErro(null);
    setOcupado(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<{ url: string }>(`/documentos/${documentoId}/arquivo`, {
      token: data.session?.access_token,
      clinica: slug,
    });
    if (r.ok) window.open(r.dados.url, "_blank", "noopener");
    else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={baixar} disabled={ocupado} className="text-sm text-selo underline-offset-4 hover:underline disabled:opacity-50">
        {ocupado ? "Preparando..." : "Baixar PDF assinado"}
      </button>
      {erro ? <span className="text-sm text-alerta">{erro}</span> : null}
    </span>
  );
}
