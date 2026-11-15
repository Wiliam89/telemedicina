"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Botao } from "@/componentes/Botao";
import { ambiente } from "@/lib/ambiente";
import { tokenDoNavegador } from "@/lib/navegador";

/**
 * ADR-0027: baixa a planilha (CSV) do periodo para a contabilidade. O
 * arquivo vem da API com o login da pessoa; o Excel abre direto.
 */
export function BaixarPlanilha({ slug, de, ate }: { slug: string; de: string; ate: string }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function baixar(tipo: "consultas" | "repasses") {
    setErro(null);
    setOcupado(tipo);
    try {
      const token = await tokenDoNavegador();
      const r = await fetch(`${ambiente.apiUrl}/admin/financeiro/planilha?${new URLSearchParams({ tipo, de, ate })}`, {
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-clinica": slug },
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { erro?: { mensagem?: string } } | null;
        throw new Error(corpo?.erro?.mensagem ?? "Não foi possível gerar a planilha agora. Tente de novo em instantes.");
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tipo === "consultas" ? "consultas" : "repasses-aos-medicos"}-${de}-a-${ate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setErro(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Sem conexão com o servidor. Confira a internet e tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Botao variante="secundario" tamanho="p" carregando={ocupado === "consultas"} disabled={ocupado !== null} icone={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => baixar("consultas")}>
          Planilha das consultas
        </Botao>
        <Botao variante="secundario" tamanho="p" carregando={ocupado === "repasses"} disabled={ocupado !== null} icone={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => baixar("repasses")}>
          Planilha dos repasses
        </Botao>
      </div>
      <p className="text-xs text-tinta-suave">Para o contador: abre no Excel ou no Google Planilhas. Não traz dados de pacientes.</p>
      {erro ? <p role="alert" className="text-sm text-alerta">{erro}</p> : null}
    </div>
  );
}
