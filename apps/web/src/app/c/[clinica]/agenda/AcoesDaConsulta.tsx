"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsultaResumo, PapelVinculo } from "@tele/shared";
import Link from "next/link";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { NOME_DO_STATUS } from "@/lib/datas";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * Os botoes de cada consulta. Quem pode o que ja e decidido pela API - aqui
 * so evitamos oferecer o que certamente sera recusado, para nao frustrar.
 */
export function AcoesDaConsulta({
  slug,
  consulta,
  papel,
  souOMedico,
}: {
  slug: string;
  consulta: ConsultaResumo;
  papel: PapelVinculo;
  souOMedico: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const encerrada = consulta.status === "cancelada" || consulta.status === "concluida";

  async function chamar(rota: string, corpo?: unknown) {
    setErro(null);
    setOcupado(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi(rota, { metodo: "POST", token: data.session?.access_token, clinica: slug, corpo });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  async function cancelar() {
    const motivo = window.prompt("Por que esta consulta esta sendo cancelada?\n(fica registrado na auditoria)");
    if (!motivo || motivo.trim().length < 3) return;
    await chamar(`/consultas/${consulta.id}/cancelar`, { motivo: motivo.trim() });
  }

  if (encerrada) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-tinta-suave">{NOME_DO_STATUS[consulta.status]}</span>
        {souOMedico && consulta.status === "concluida" ? (
          <Link href={`/c/${slug}/atendimento/${consulta.id}`} className="text-sm text-selo underline-offset-4 hover:underline">
            Prontuario
          </Link>
        ) : null}
      </div>
    );
  }

  // Consulta reservada esperando pagamento: a acao principal e pagar.
  if (consulta.status === "aguardando_pagamento") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-alerta">Aguardando pagamento</span>
        <Link href={`/c/${slug}/pagamento/${consulta.id}`} className="rounded-md bg-selo px-3 py-1.5 text-sm font-medium text-white hover:bg-selo/90">
          Pagar
        </Link>
        <button onClick={cancelar} disabled={ocupado} className="text-sm text-alerta underline-offset-4 hover:underline disabled:opacity-50">
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {erro ? <span className="text-sm text-alerta">{erro}</span> : null}
      <span className="text-sm text-tinta-suave">{NOME_DO_STATUS[consulta.status]}</span>

      {souOMedico && consulta.status === "agendada" ? (
        <Botao variante="secundario" carregando={ocupado} onClick={() => chamar(`/consultas/${consulta.id}/status`, { status: "em_andamento" })} className="px-3 py-1.5 text-sm">
          Iniciar
        </Botao>
      ) : null}
      {souOMedico ? (
        <Link href={`/c/${slug}/atendimento/${consulta.id}`} className="text-sm text-selo underline-offset-4 hover:underline">
          Atender
        </Link>
      ) : null}
      {souOMedico && consulta.status === "em_andamento" ? (
        <Botao carregando={ocupado} onClick={() => chamar(`/consultas/${consulta.id}/status`, { status: "concluida" })} className="px-3 py-1.5 text-sm">
          Concluir
        </Botao>
      ) : null}
      {papel !== "medico" || souOMedico ? (
        <button onClick={cancelar} disabled={ocupado} className="text-sm text-alerta underline-offset-4 hover:underline disabled:opacity-50">
          Cancelar
        </button>
      ) : null}
    </div>
  );
}
