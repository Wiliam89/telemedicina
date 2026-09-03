"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentoResumo, EvolucaoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import { EmitirDocumento } from "./EmitirDocumento";

const CAMPOS = [
  { chave: "subjetivo", rotulo: "S — Subjetivo", ajuda: "O que o paciente relata: queixa, historia, duracao." },
  { chave: "objetivo", rotulo: "O — Objetivo", ajuda: "O que voce constata: exame fisico, sinais vitais, exames." },
  { chave: "avaliacao", rotulo: "A — Avaliacao", ajuda: "Hipotese diagnostica, raciocinio clinico." },
  { chave: "plano", rotulo: "P — Plano", ajuda: "Conduta: prescricao, exames, orientacoes, retorno." },
] as const;

type Campo = (typeof CAMPOS)[number]["chave"];

/**
 * O prontuario em formato SOAP. Enquanto e rascunho, salva-se a vontade.
 * Ao finalizar, o registro vira imutavel - e a tela deixa isso claro
 * ANTES do clique, nao depois.
 */
export function Atendimento({
  slug,
  consultaId,
  evolucaoId,
  historico,
  documentos,
}: {
  slug: string;
  consultaId: string;
  evolucaoId: string;
  historico: EvolucaoResumo[];
  documentos: DocumentoResumo[];
}) {
  const router = useRouter();
  const atual = historico.find((h) => h.id === evolucaoId);
  const finalizada = atual?.status === "finalizada";

  const [texto, setTexto] = useState<Record<Campo, string>>({
    subjetivo: atual?.subjetivo ?? "",
    objetivo: atual?.objetivo ?? "",
    avaliacao: atual?.avaliacao ?? "",
    plano: atual?.plano ?? "",
  });
  const [cid10, setCid10] = useState(atual?.cid10 ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  async function salvar() {
    setErro(null);
    setOcupado(true);
    const r = await chamarApi(`/evolucoes/${evolucaoId}`, {
      metodo: "PATCH",
      token: await token(),
      clinica: slug,
      corpo: { ...texto, cid10: cid10.trim() || undefined },
    });
    if (r.ok) setAviso("Rascunho salvo.");
    else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  async function finalizar() {
    if (!window.confirm("Finalizar o prontuario?\n\nDepois disso o registro NAO pode mais ser alterado nem apagado — nem por voce, nem pela administracao. Correcoes so por adendo.")) return;
    setErro(null);
    setOcupado(true);
    const r = await chamarApi(`/evolucoes/${evolucaoId}`, { metodo: "PATCH", token: await token(), clinica: slug, corpo: { ...texto, cid10: cid10.trim() || undefined } });
    if (!r.ok) {
      setErro(r.erro.mensagem);
      setOcupado(false);
      return;
    }
    const f = await chamarApi(`/evolucoes/${evolucaoId}/finalizar`, { metodo: "POST", token: await token(), clinica: slug });
    if (f.ok) router.refresh();
    else setErro(f.erro.mensagem);
    setOcupado(false);
  }

  async function adendo() {
    const observacao = window.prompt("O que precisa ser corrigido ou acrescentado?\n(a evolucao original permanece intacta)");
    if (!observacao || observacao.trim().length < 3) return;
    const r = await chamarApi(`/evolucoes/${evolucaoId}/adendo`, { metodo: "POST", token: await token(), clinica: slug, corpo: { objetivo: observacao.trim() } });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
  }

  const outras = historico.filter((h) => h.id !== evolucaoId);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      <section className="space-y-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-titulo text-2xl tracking-tight">Prontuario desta consulta</h2>
          <span className="text-sm text-tinta-suave">{finalizada ? "Finalizado" : "Rascunho"}</span>
        </div>

        {finalizada ? (
          <Aviso>
            Este registro esta finalizado e nao pode ser alterado. Se algo precisa ser corrigido, registre um adendo — a
            evolucao original permanece, e o adendo fica ao lado dela.
          </Aviso>
        ) : null}

        {CAMPOS.map((c) => (
          <div key={c.chave} className="space-y-1.5">
            <label htmlFor={c.chave} className="block text-sm font-medium">{c.rotulo}</label>
            <p className="text-xs text-tinta-suave">{c.ajuda}</p>
            <textarea
              id={c.chave}
              rows={3}
              readOnly={finalizada}
              value={texto[c.chave]}
              onChange={(e) => {
                setAviso(null);
                setTexto((t) => ({ ...t, [c.chave]: e.target.value }));
              }}
              className="w-full rounded-md border border-linha bg-superficie px-3 py-2 text-base read-only:bg-papel read-only:text-tinta-suave"
            />
          </div>
        ))}

        <div className="space-y-1.5">
          <label htmlFor="cid10" className="block text-sm font-medium">CID-10 (opcional)</label>
          <p className="text-xs text-tinta-suave">Formato A00 ou A00.0. So entra em atestado se o paciente autorizar.</p>
          <input
            id="cid10"
            readOnly={finalizada}
            value={cid10}
            onChange={(e) => setCid10(e.target.value.toUpperCase())}
            placeholder="J02"
            className="w-40 rounded-md border border-linha bg-superficie px-3 py-2 font-mono read-only:bg-papel"
          />
        </div>

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}

        <div className="flex flex-wrap gap-3">
          {finalizada ? (
            <Botao variante="secundario" onClick={adendo}>Registrar adendo</Botao>
          ) : (
            <>
              <Botao variante="secundario" onClick={salvar} carregando={ocupado}>Salvar rascunho</Botao>
              <Botao onClick={finalizar} carregando={ocupado}>Finalizar prontuario</Botao>
            </>
          )}
        </div>

        {outras.length > 0 ? (
          <div className="space-y-3 pt-4">
            <h3 className="font-titulo text-lg tracking-tight">Historico do paciente</h3>
            <ul className="space-y-3">
              {outras.map((h) => (
                <li key={h.id} className="rounded-lg border border-linha bg-superficie p-4 text-sm">
                  <p className="mb-2 text-xs uppercase tracking-wide text-tinta-suave">
                    {h.adendoDe ? "Adendo" : "Evolucao"} · {new Date(h.criadoEm).toLocaleDateString("pt-BR")} ·{" "}
                    {h.medico.nomeCompleto} (CRM {h.medico.crm}-{h.medico.crmUf})
                  </p>
                  {h.subjetivo ? <p><strong>S:</strong> {h.subjetivo}</p> : null}
                  {h.objetivo ? <p><strong>O:</strong> {h.objetivo}</p> : null}
                  {h.avaliacao ? <p><strong>A:</strong> {h.avaliacao}</p> : null}
                  {h.plano ? <p><strong>P:</strong> {h.plano}</p> : null}
                  {h.cid10 ? <p className="mt-1 font-mono text-xs">CID {h.cid10}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <EmitirDocumento slug={slug} consultaId={consultaId} emitidos={documentos} />
    </div>
  );
}
