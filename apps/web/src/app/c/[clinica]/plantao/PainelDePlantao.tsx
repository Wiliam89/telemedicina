"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import type { FilaResumo, PlantaoResumo } from "./page";

/**
 * O painel de quem atende. Duas coisas acontecem aqui: o medico abre e
 * encerra o proprio plantao, e chama o proximo da fila.
 *
 * A lista se atualiza sozinha a cada 10 segundos - fila e coisa viva.
 */
export function PainelDePlantao({
  slug,
  souMedico,
  meuId,
  plantoes,
  fila,
}: {
  slug: string;
  souMedico: boolean;
  meuId: string;
  plantoes: PlantaoResumo[];
  fila: FilaResumo;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [atual, setAtual] = useState(fila);

  const meuPlantaoAberto = plantoes.find((p) => p.medicoId === meuId && p.status === "aberto");
  const meuPlantaoEscalado = plantoes.find((p) => p.medicoId === meuId && p.status === "escalado" && new Date(p.fim) > new Date());

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  useEffect(() => {
    const t = setInterval(async () => {
      const r = await chamarApi<FilaResumo>("/fila", { token: await token(), clinica: slug });
      if (r.ok) setAtual(r.dados);
    }, 10000);
    return () => clearInterval(t);
  }, [slug]);

  async function acao(rota: string, corpo?: unknown) {
    setErro(null);
    setOcupado(true);
    const r = await chamarApi(rota, { metodo: "POST", token: await token(), clinica: slug, corpo });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
    setOcupado(false);
    return r;
  }

  async function escalar() {
    const agora = new Date();
    await acao("/plantoes", { inicio: agora.toISOString(), fim: new Date(agora.getTime() + 6 * 3600000).toISOString() });
  }

  async function chamarProximo() {
    const r = (await acao("/fila/proximo")) as { ok: boolean; dados?: { chamou: boolean; consultaId?: string } };
    if (r.ok && r.dados?.chamou && r.dados.consultaId) {
      router.push(`/c/${slug}/atendimento/${r.dados.consultaId}`);
    }
  }

  return (
    <div className="space-y-8">
      {souMedico ? (
        <section className="space-y-3">
          <h2 className="font-titulo text-2xl tracking-tight">Meu plantao</h2>
          {meuPlantaoAberto ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-selo/40 bg-selo-suave p-4">
              <span className="text-selo">
                Plantao <strong>aberto</strong> ate {new Date(meuPlantaoAberto.fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <Botao onClick={chamarProximo} carregando={ocupado} disabled={atual.totalAguardando === 0}>
                {atual.totalAguardando > 0 ? `Chamar proximo (${atual.totalAguardando} na fila)` : "Fila vazia"}
              </Botao>
              <button
                onClick={() => acao(`/plantoes/${meuPlantaoAberto.id}/encerrar`)}
                disabled={ocupado}
                className="text-sm text-alerta underline-offset-4 hover:underline disabled:opacity-50"
              >
                Encerrar plantao
              </button>
            </div>
          ) : meuPlantaoEscalado ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-linha bg-superficie p-4">
              <span className="text-tinta-suave">Voce esta escalado, mas o plantao ainda nao foi aberto.</span>
              <Botao onClick={() => acao(`/plantoes/${meuPlantaoEscalado.id}/abrir`)} carregando={ocupado}>
                Abrir plantao
              </Botao>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-linha bg-superficie p-4">
              <span className="text-tinta-suave">Voce nao esta de plantao.</span>
              <Botao variante="secundario" onClick={escalar} carregando={ocupado}>
                Entrar de plantao agora (6 horas)
              </Botao>
            </div>
          )}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-titulo text-2xl tracking-tight">Fila</h2>
          <span className="text-sm text-tinta-suave">
            {atual.totalAguardando} aguardando · {atual.medicosDePlantao} de plantao
          </span>
        </div>

        {atual.lista.length === 0 ? (
          <Aviso>Ninguem na fila no momento.</Aviso>
        ) : (
          <ul className="divide-y divide-linha overflow-hidden rounded-lg border border-linha bg-superficie">
            {atual.lista.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-start gap-4">
                  <span className="font-mono text-lg text-tinta-suave">{f.posicao}</span>
                  <div>
                    <p className="font-medium">{f.nome}</p>
                    <p className="text-sm text-tinta-suave">{f.queixa ?? "sem queixa informada"}</p>
                  </div>
                </div>
                <span className={"text-sm " + (f.esperandoMinutos > 30 ? "text-alerta" : "text-tinta-suave")}>
                  {f.status === "em_atendimento" ? "em atendimento" : `esperando ha ${f.esperandoMinutos} min`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
