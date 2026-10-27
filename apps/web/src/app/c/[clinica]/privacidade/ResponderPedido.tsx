"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { acaoNaApi } from "@/lib/navegador";

/** Resposta da clinica (controladora) ao titular. Fica na auditoria. */
export function ResponderPedido({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState<"em_andamento" | "concluida" | "negada">("concluida");
  const [resposta, setResposta] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const r = await acaoNaApi(`/lgpd/solicitacoes/${id}/responder`, { metodo: "POST", clinica: slug, corpo: { status, resposta: resposta.trim() || undefined } });
    setSalvando(false);
    if (!r.ok) {
      const det = Array.isArray(r.erro.detalhes) ? (r.erro.detalhes as { problema: string }[]).map((d) => d.problema).join(" ") : "";
      return setErro(det || r.erro.mensagem);
    }
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <Botao tamanho="p" onClick={() => setAberto(true)}>
        Responder
      </Botao>
    );
  }

  return (
    <form onSubmit={enviar} className="w-full space-y-3 rounded-lg border border-linha bg-superficie-alt p-3" noValidate>
      <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${CLASSE_CONTROLE} border-linha`} aria-label="Situação">
        <option value="concluida">Concluir (atendido)</option>
        <option value="em_andamento">Em andamento (avisar que está sendo tratado)</option>
        <option value="negada">Negar (explique o fundamento legal)</option>
      </select>
      <textarea
        rows={3}
        value={resposta}
        onChange={(e) => setResposta(e.target.value)}
        placeholder="Resposta ao titular: o que foi feito, ou por que não pôde ser feito."
        className={`${CLASSE_CONTROLE} border-linha`}
        aria-label="Resposta"
      />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <div className="flex gap-2">
        <Botao type="submit" tamanho="p" carregando={salvando}>
          Enviar resposta
        </Botao>
        <Botao type="button" tamanho="p" variante="fantasma" onClick={() => setAberto(false)}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
