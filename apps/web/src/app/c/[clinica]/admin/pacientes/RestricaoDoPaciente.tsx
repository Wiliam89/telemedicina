"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Botao } from "@/componentes/Botao";
import { acaoNaApi } from "@/lib/navegador";

/**
 * Impedir (ou voltar a permitir) que o paciente MARQUE consulta e entre na
 * fila. Ele continua entrando para ver os proprios documentos (LGPD).
 */
export function RestricaoDoPaciente({ slug, pacienteId, restrito, aoMudar }: { slug: string; pacienteId: string; restrito: boolean; /** Recarrega a lista (a busca vive no navegador). */ aoMudar?: (e: { preventDefault(): void }) => void }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(rota: string, corpo?: unknown) {
    setErro(null);
    setOcupado(true);
    const r = await acaoNaApi(rota, { metodo: "POST", clinica: slug, ...(corpo ? { corpo } : {}) });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro.mensagem);
    setAberto(false);
    setMotivo("");
    if (aoMudar) aoMudar({ preventDefault() {} });
    router.refresh();
  }

  if (restrito) {
    return (
      <div className="space-y-1">
        <Botao
          variante="secundario"
          tamanho="p"
          carregando={ocupado}
          onClick={() => {
            if (window.confirm("Voltar a permitir que este paciente marque consultas?")) void enviar(`/admin/pacientes/${pacienteId}/liberar`);
          }}
        >
          Permitir marcar
        </Botao>
        {erro ? <p role="alert" className="text-sm text-alerta">{erro}</p> : null}
      </div>
    );
  }

  if (!aberto) {
    return (
      <Botao variante="fantasma" tamanho="p" className="text-alerta hover:text-alerta" onClick={() => setAberto(true)}>
        Impedir de marcar
      </Botao>
    );
  }

  return (
    <form
      className="w-full max-w-md space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (motivo.trim().length < 5) return setErro("Explique o motivo (ao menos 5 letras). Ele fica registrado na auditoria.");
        void enviar(`/admin/pacientes/${pacienteId}/restringir`, { motivo: motivo.trim() });
      }}
    >
      <label htmlFor={`motivo-${pacienteId}`} className="block text-sm font-medium">Motivo</label>
      <input
        id={`motivo-${pacienteId}`}
        value={motivo}
        maxLength={300}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: pagamentos contestados repetidas vezes"
        className="w-full rounded-lg border border-linha bg-superficie px-3 py-2 text-sm"
      />
      <p className="text-xs text-tinta-suave">O paciente não poderá marcar nem entrar na fila, mas continua vendo as próprias consultas e documentos. Não escreva dado de saúde no motivo.</p>
      {erro ? <p role="alert" className="text-sm text-alerta">{erro}</p> : null}
      <div className="flex gap-2">
        <Botao type="submit" variante="perigo" tamanho="p" carregando={ocupado}>Impedir</Botao>
        <Botao type="button" variante="fantasma" tamanho="p" onClick={() => setAberto(false)}>Voltar</Botao>
      </div>
    </form>
  );
}
