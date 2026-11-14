"use client";

import { BellRing, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PainelDeChamados } from "@tele/shared";
import { rotuloDoPedido } from "@tele/shared/atendimento";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Etiqueta } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import type { FilaResumo, PlantaoResumo } from "./page";

/** De quanto em quanto tempo o painel pergunta se ha pedido novo. */
const INTERVALO_MS = 4000;

/** Um toque curto, gerado na hora: nao depende de arquivo de audio. */
function tocarAlerta() {
  try {
    const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const ctx = new Contexto();
    for (const [inicio, frequencia] of [[0, 880], [0.22, 1175]] as const) {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.frequency.value = frequencia;
      osc.connect(ganho);
      ganho.connect(ctx.destination);
      ganho.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
      ganho.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + inicio + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.2);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + 0.21);
    }
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Sem audio (navegador bloqueou): o aviso visual continua valendo.
  }
}

/**
 * O PAINEL DE QUEM ATENDE (ADR-0025).
 *
 * O medico fica ONLINE e passa a receber, ao vivo, os pedidos de atendimento
 * imediato que ele pode atender: os de pronto atendimento, se atende como
 * clinico geral, e os das especialidades dele. O mesmo pedido aparece para
 * todos os colegas aptos; quem aceitar primeiro fica com o paciente, e o
 * pedido some do painel dos demais.
 *
 * A recepcao e a administracao veem a fila inteira, sem a queixa.
 */
export function PainelDePlantao({
  slug,
  souMedico,
  meuId,
  plantoes,
  fila,
  chamados,
}: {
  slug: string;
  souMedico: boolean;
  meuId: string;
  plantoes: PlantaoResumo[];
  fila: FilaResumo;
  chamados: PainelDeChamados | null;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [atual, setAtual] = useState(fila);
  const [painel, setPainel] = useState(chamados);
  const [alertas, setAlertas] = useState<NotificationPermission | "indisponivel">("default");
  const conhecidos = useRef(new Set((chamados?.chamados ?? []).map((c) => c.id)));
  const tituloOriginal = useRef<string | null>(null);

  const meuPlantaoAberto = plantoes.find((p) => p.medicoId === meuId && p.status === "aberto" && new Date(p.fim) > new Date());
  const meuPlantaoEscalado = plantoes.find((p) => p.medicoId === meuId && p.status === "escalado" && new Date(p.fim) > new Date());
  const online = Boolean(painel?.online ?? meuPlantaoAberto);

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  useEffect(() => {
    setAlertas(typeof Notification === "undefined" ? "indisponivel" : Notification.permission);
    tituloOriginal.current = document.title;
    return () => {
      if (tituloOriginal.current) document.title = tituloOriginal.current;
    };
  }, []);

  // O painel e coisa viva: pergunta a API a cada poucos segundos.
  useEffect(() => {
    let parado = false;
    const ciclo = async () => {
      const t = await token();
      if (souMedico) {
        const r = await chamarApi<PainelDeChamados>("/fila/chamados", { token: t, clinica: slug });
        if (!parado && r.ok) {
          const novos = r.dados.chamados.filter((c) => !conhecidos.current.has(c.id));
          conhecidos.current = new Set(r.dados.chamados.map((c) => c.id));
          setPainel(r.dados);
          if (novos.length > 0) {
            tocarAlerta();
            if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
              // Sem nome e sem queixa: a notificacao aparece na tela do computador.
              new Notification("Paciente aguardando atendimento", { body: rotuloDoPedido(novos[0]!.linha, novos[0]!.especialidade), tag: "chamado" });
            }
          }
          if (tituloOriginal.current) document.title = r.dados.chamados.length > 0 ? `(${r.dados.chamados.length}) Paciente aguardando` : tituloOriginal.current;
        }
      } else {
        const r = await chamarApi<FilaResumo>("/fila", { token: t, clinica: slug });
        if (!parado && r.ok) setAtual(r.dados);
      }
    };
    const t = setInterval(ciclo, INTERVALO_MS);
    return () => {
      parado = true;
      clearInterval(t);
    };
  }, [slug, souMedico]);

  async function acao(chave: string, rota: string, corpo?: unknown) {
    setErro(null);
    setOcupado(chave);
    const r = await chamarApi<{ consultaId?: string }>(rota, { metodo: "POST", token: await token(), clinica: slug, corpo });
    setOcupado(null);
    if (!r.ok) setErro(r.erro.mensagem);
    else router.refresh();
    return r;
  }

  async function ficarOnline() {
    if (meuPlantaoEscalado) {
      await acao("online", `/plantoes/${meuPlantaoEscalado.id}/abrir`);
      return;
    }
    const agora = new Date();
    const criado = await chamarApi<{ id: string }>("/plantoes", { metodo: "POST", token: await token(), clinica: slug, corpo: { inicio: agora.toISOString(), fim: new Date(agora.getTime() + 6 * 3600000).toISOString() } });
    if (!criado.ok) {
      setErro(criado.erro.mensagem);
      return;
    }
    await acao("online", `/plantoes/${criado.dados.id}/abrir`);
  }

  async function aceitar(id: string) {
    const r = await acao(id, `/fila/${id}/aceitar`);
    if (r.ok && r.dados.consultaId) {
      router.push(`/c/${slug}/atendimento/${r.dados.consultaId}`);
      return;
    }
    // Outro medico aceitou primeiro: o pedido sai da lista na hora.
    if (!r.ok && r.erro.codigo === "JA_ACEITO") setPainel((p) => (p ? { ...p, chamados: p.chamados.filter((c) => c.id !== id) } : p));
  }

  async function pedirAlertas() {
    if (typeof Notification === "undefined") return;
    setAlertas(await Notification.requestPermission());
    tocarAlerta();
  }

  return (
    <div className="space-y-8">
      {souMedico ? (
        <section className="space-y-4" aria-labelledby="titulo-disponibilidade">
          <h2 id="titulo-disponibilidade" className="text-xl text-tinta">Minha disponibilidade</h2>

          {painel?.emAtendimento ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-espera/40 bg-espera-suave p-4">
              <span className="text-espera">
                Você está atendendo <strong>{painel.emAtendimento.pacienteNome}</strong>.
              </span>
              <Botao onClick={() => router.push(`/c/${slug}/atendimento/${painel.emAtendimento!.consultaId}`)}>Voltar ao atendimento</Botao>
            </div>
          ) : null}

          {online ? (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-selo/40 bg-selo-suave p-4">
              <span className="flex items-center gap-2 text-selo-forte">
                <Radio className="h-5 w-5" aria-hidden="true" />
                <span>
                  Você está <strong>online</strong>
                  {meuPlantaoAberto ? ` até ${new Date(meuPlantaoAberto.fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}. Os pedidos aparecem abaixo.
                </span>
              </span>
              {meuPlantaoAberto ? (
                <button
                  type="button"
                  onClick={() => acao("offline", `/plantoes/${meuPlantaoAberto.id}/encerrar`)}
                  disabled={ocupado !== null}
                  className="ml-auto text-sm text-alerta underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Ficar offline
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-linha bg-superficie p-4 shadow-cartao">
              <span className="text-tinta-suave">Você está offline: nenhum pedido de atendimento imediato chega até você.</span>
              <Botao onClick={ficarOnline} carregando={ocupado === "online"} className="ml-auto">
                Ficar online (6 horas)
              </Botao>
            </div>
          )}

          {online && alertas === "default" ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-tinta-suave">
              <BellRing className="h-4 w-4" aria-hidden="true" />
              Quer ser avisado mesmo com esta aba em segundo plano?
              <button type="button" onClick={pedirAlertas} className="text-selo underline underline-offset-4">
                Ativar alertas
              </button>
            </div>
          ) : null}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        </section>
      ) : null}

      {souMedico && online ? (
        <section className="space-y-3" aria-labelledby="titulo-pedidos">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="titulo-pedidos" className="text-xl text-tinta">Pacientes aguardando você</h2>
            <span className="text-sm text-tinta-suave" aria-live="polite">
              {painel?.chamados.length ?? 0} pedido(s)
            </span>
          </div>
          {!painel || painel.chamados.length === 0 ? (
            <Aviso>Nenhum pedido no momento. Deixe esta tela aberta: quando um paciente entrar na fila, ele aparece aqui com um toque sonoro.</Aviso>
          ) : (
            <ul className="space-y-3">
              {painel.chamados.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-linha bg-superficie p-4 shadow-cartao">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Etiqueta tom={c.linha === "teleconsulta" ? "info" : "selo"}>{rotuloDoPedido(c.linha, c.especialidade)}</Etiqueta>
                      <span className={"text-sm " + (c.esperandoMinutos > 15 ? "text-alerta" : "text-tinta-suave")}>
                        {c.esperandoMinutos < 1 ? "acabou de entrar" : `esperando há ${c.esperandoMinutos} min`}
                      </span>
                    </div>
                    <p className="font-medium">{c.pacienteNome}</p>
                    <p className="text-sm text-tinta-suave">{c.queixa}</p>
                  </div>
                  <Botao onClick={() => aceitar(c.id)} carregando={ocupado === c.id} disabled={ocupado !== null || Boolean(painel.emAtendimento)}>
                    Aceitar
                  </Botao>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-tinta-suave">O mesmo pedido aparece para todos os médicos aptos. Quem aceitar primeiro atende; para os demais, ele desaparece.</p>
        </section>
      ) : null}

      {!souMedico ? (
        <section className="space-y-3" aria-labelledby="titulo-fila">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="titulo-fila" className="text-xl text-tinta">Fila</h2>
            <span className="text-sm text-tinta-suave">
              {atual.totalAguardando} aguardando · {atual.medicosDePlantao} médico(s) online
            </span>
          </div>
          {atual.lista.length === 0 ? (
            <Aviso>Ninguém na fila no momento.</Aviso>
          ) : (
            <ul className="divide-y divide-linha overflow-hidden rounded-xl border border-linha bg-superficie shadow-cartao">
              {atual.lista.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-start gap-4">
                    <span className="font-mono text-lg text-tinta-suave">{f.posicao}</span>
                    <div>
                      <p className="font-medium">{f.nome}</p>
                      <p className="text-sm text-tinta-suave">{rotuloDoPedido(f.linha ?? "pronto_atendimento", f.especialidade ?? null)} · queixa visível apenas para o médico</p>
                    </div>
                  </div>
                  <span className={"text-sm " + (f.esperandoMinutos > 30 ? "text-alerta" : "text-tinta-suave")}>
                    {f.status === "em_atendimento" ? "em atendimento" : `esperando há ${f.esperandoMinutos} min`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="titulo-online">
        <h2 id="titulo-online" className="text-xl text-tinta">Quem está online</h2>
        {plantoes.filter((p) => p.status === "aberto" && new Date(p.fim) > new Date()).length === 0 ? (
          <Aviso>Nenhum médico online agora.</Aviso>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {plantoes
              .filter((p) => p.status === "aberto" && new Date(p.fim) > new Date())
              .map((p) => (
                <li key={p.id}>
                  <Etiqueta tom="selo">
                    {p.medicoNome} · CRM {p.crm}-{p.crmUf}
                  </Etiqueta>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
