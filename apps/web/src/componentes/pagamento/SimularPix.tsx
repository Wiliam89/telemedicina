"use client";

import { useEffect, useState } from "react";
import { acaoNaApi } from "@/lib/navegador";

/**
 * SO EM AMBIENTE DE TESTE. Com o gateway simulado nao existe banco do outro
 * lado para pagar o Pix; este botao faz o papel dele, para dar para percorrer
 * o fluxo inteiro. A API so o oferece (e so o aceita) fora de producao, e
 * apenas para cobrancas do provedor simulado.
 */
export function SimularPix({ slug, pagamentoId }: { slug: string; pagamentoId: string }) {
  const [simulavel, setSimulavel] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    void acaoNaApi<{ simulavel?: boolean }>(`/pagamentos/${pagamentoId}`, { clinica: slug }).then((r) => {
      if (!cancelado && r.ok) setSimulavel(Boolean(r.dados.simulavel));
    });
    return () => {
      cancelado = true;
    };
  }, [slug, pagamentoId]);

  if (!simulavel) return null;
  return (
    <div className="rounded-lg border border-dashed border-espera/50 bg-espera-suave px-4 py-3 text-sm text-espera">
      <p>
        <strong>Ambiente de teste:</strong> este Pix é simulado e não movimenta dinheiro.
      </p>
      <button
        type="button"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          const r = await acaoNaApi(`/pagamentos/${pagamentoId}/simular`, { metodo: "POST", clinica: slug });
          if (r.ok) setSimulavel(false);
          setOcupado(false);
        }}
        className="mt-1 font-medium underline underline-offset-4 disabled:opacity-50"
      >
        {ocupado ? "Simulando..." : "Simular o pagamento"}
      </button>
    </div>
  );
}
