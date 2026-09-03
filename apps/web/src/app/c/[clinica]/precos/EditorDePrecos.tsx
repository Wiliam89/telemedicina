"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MedicoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { emReais, paraCentavos } from "@/lib/dinheiro";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

interface Item {
  tipo: "agendada" | "pronto_atendimento";
  medicoId: string | null;
  texto: string;
}

const NOME_DO_TIPO = { agendada: "Consulta agendada", pronto_atendimento: "Pronto atendimento" } as const;

export function EditorDePrecos({
  slug,
  inicial,
  medicos,
}: {
  slug: string;
  inicial: { tipo: string; medicoId: string | null; valorCentavos: number }[];
  medicos: MedicoResumo[];
}) {
  const router = useRouter();
  const [itens, setItens] = useState<Item[]>(
    inicial.map((p) => ({ tipo: p.tipo as Item["tipo"], medicoId: p.medicoId, texto: (p.valorCentavos / 100).toFixed(2).replace(".", ",") })),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    const convertidos: { tipo: string; medicoId: string | null; valorCentavos: number; comissaoPlataformaBps: number }[] = [];

    for (const i of itens) {
      const centavos = paraCentavos(i.texto);
      if (centavos === null || centavos < 100) {
        setErro(`Valor invalido em "${NOME_DO_TIPO[i.tipo]}". O minimo e R$ 1,00.`);
        return;
      }
      convertidos.push({ tipo: i.tipo, medicoId: i.medicoId, valorCentavos: centavos, comissaoPlataformaBps: 0 });
    }

    setSalvando(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi("/precos", { metodo: "PUT", token: data.session?.access_token, clinica: slug, corpo: { itens: convertidos } });
    if (r.ok) {
      setSalvo(true);
      router.refresh();
    } else setErro(r.erro.mensagem);
    setSalvando(false);
  }

  return (
    <div className="max-w-2xl space-y-5">
      {itens.length === 0 ? (
        <Aviso>Nenhum valor definido: as consultas nao sao cobradas pela plataforma.</Aviso>
      ) : (
        <ul className="space-y-3">
          {itens.map((item, i) => (
            <li key={i} className="grid gap-3 rounded-lg border border-linha bg-superficie p-4 sm:grid-cols-[12rem_1fr_8rem_auto] sm:items-end">
              <div className="space-y-1.5">
                <label htmlFor={`tipo-${i}`} className="block text-sm font-medium">Tipo</label>
                <select
                  id={`tipo-${i}`}
                  value={item.tipo}
                  onChange={(e) => setItens((a) => a.map((x, j) => (i === j ? { ...x, tipo: e.target.value as Item["tipo"] } : x)))}
                  className="w-full rounded-md border border-linha bg-superficie px-3 py-2"
                >
                  {Object.entries(NOME_DO_TIPO).map(([v, n]) => (
                    <option key={v} value={v}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`med-${i}`} className="block text-sm font-medium">Profissional</label>
                <select
                  id={`med-${i}`}
                  value={item.medicoId ?? ""}
                  onChange={(e) => setItens((a) => a.map((x, j) => (i === j ? { ...x, medicoId: e.target.value || null } : x)))}
                  className="w-full rounded-md border border-linha bg-superficie px-3 py-2"
                >
                  <option value="">Todos (valor padrao)</option>
                  {medicos.map((m) => (
                    <option key={m.id} value={m.id}>{m.nomeCompleto}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`valor-${i}`} className="block text-sm font-medium">Valor</label>
                <input
                  id={`valor-${i}`}
                  inputMode="decimal"
                  value={item.texto}
                  onChange={(e) => {
                    setSalvo(false);
                    setItens((a) => a.map((x, j) => (i === j ? { ...x, texto: e.target.value } : x)));
                  }}
                  placeholder="150,00"
                  className="w-full rounded-md border border-linha bg-superficie px-3 py-2 text-right font-mono"
                />
              </div>
              <button onClick={() => setItens((a) => a.filter((_, j) => j !== i))} className="text-sm text-alerta underline-offset-4 hover:underline">
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {salvo ? <Aviso tipo="ok">Valores salvos.</Aviso> : null}

      <div className="flex flex-wrap gap-3">
        <Botao variante="secundario" onClick={() => setItens((a) => [...a, { tipo: "agendada", medicoId: null, texto: "150,00" }])}>
          Adicionar valor
        </Botao>
        <Botao onClick={salvar} carregando={salvando}>Salvar</Botao>
      </div>
      <p className="text-sm text-tinta-suave">
        O valor de um profissional especifico tem preferencia sobre o valor padrao. Consultas ja marcadas nao mudam de
        preco: o valor e congelado no momento da cobranca.
      </p>
    </div>
  );
}
