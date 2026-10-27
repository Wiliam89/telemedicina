"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { acaoNaApi } from "@/lib/navegador";

interface Item {
  id: string;
  titulo: string;
  corpo: string;
  link: string | null;
  clinica: string | null;
  lida: boolean;
  criadoEm: string;
}

function haQuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

/**
 * A central de notificacoes (ADR-0019). Busca ao abrir a tela e a cada
 * minuto; o numero no sino e o de nao lidas. Clicar num aviso marca como
 * lido e leva ao lugar certo.
 */
export function SinoDeNotificacoes({ claro = false }: { claro?: boolean }) {
  // No menu lateral (claro) o painel abre para a direita; no cabecalho do
  // celular, que fica no canto direito, abre para a esquerda.
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Item[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const r = await acaoNaApi<{ naoLidas: number; itens: Item[] }>("/notificacoes");
    if (r.ok) {
      setItens(r.dados.itens);
      setNaoLidas(r.dados.naoLidas);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => caixa.current && !caixa.current.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  async function abrir(i: Item) {
    if (!i.lida) {
      await acaoNaApi(`/notificacoes/${i.id}/lida`, { metodo: "POST" });
      setItens((xs) => xs.map((x) => (x.id === i.id ? { ...x, lida: true } : x)));
      setNaoLidas((n) => Math.max(0, n - 1));
    }
    setAberto(false);
    if (i.link) router.push(i.link);
  }

  async function lerTodas() {
    await acaoNaApi("/notificacoes/lidas", { metodo: "POST" });
    setItens((xs) => xs.map((x) => ({ ...x, lida: true })));
    setNaoLidas(0);
  }

  return (
    <div className="relative" ref={caixa}>
      <button
        onClick={() => setAberto((a) => !a)}
        aria-label={naoLidas > 0 ? `Notificações: ${naoLidas} não lida(s)` : "Notificações"}
        aria-expanded={aberto}
        className={`relative rounded-lg p-2 ${claro ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-tinta-suave hover:bg-marinho-suave hover:text-tinta"}`}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {naoLidas > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-h-[1.1rem] min-w-[1.1rem] place-items-center rounded-full bg-alerta px-1 text-[0.65rem] font-bold text-white">
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        ) : null}
      </button>

      {aberto ? (
        <div className={`absolute top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-linha bg-superficie text-tinta shadow-flutuante ${claro ? "left-0" : "right-0"}`}>
          <div className="flex items-center justify-between border-b border-linha px-4 py-3">
            <p className="font-medium">Notificações</p>
            {naoLidas > 0 ? (
              <button onClick={lerTodas} className="inline-flex items-center gap-1 text-xs font-medium text-selo hover:text-selo-forte">
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Marcar todas como lidas
              </button>
            ) : null}
          </div>
          {itens.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-tinta-suave">Nenhuma notificação ainda.</p>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-linha overflow-y-auto">
              {itens.map((i) => (
                <li key={i.id}>
                  <button onClick={() => abrir(i)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-superficie-alt ${i.lida ? "" : "bg-selo-suave/40"}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.lida ? "bg-transparent" : "bg-selo"}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{i.titulo}</span>
                      <span className="mt-0.5 block text-sm text-tinta-suave">{i.corpo}</span>
                      <span className="mt-1 block text-xs text-tinta-suave">
                        {haQuanto(i.criadoEm)}
                        {i.clinica ? ` · ${i.clinica}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
