"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIAS_DA_SEMANA, type DisponibilidadeResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

interface Bloco {
  diaSemana: number;
  horaInicio: string;
  horaFim: string;
  duracaoMinutos: number;
}

/** Quantas consultas cabem no bloco - o numero que o medico quer conferir. */
function vagas(b: Bloco): number {
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const total = min(b.horaFim) - min(b.horaInicio);
  return total > 0 ? Math.floor(total / b.duracaoMinutos) : 0;
}

function seCruzam(a: Bloco, b: Bloco): boolean {
  return a.diaSemana === b.diaSemana && a.horaInicio < b.horaFim && b.horaInicio < a.horaFim;
}

export function EditorDaGrade({ slug, inicial }: { slug: string; inicial: DisponibilidadeResumo[] }) {
  const router = useRouter();
  const [blocos, setBlocos] = useState<Bloco[]>(
    inicial.map((d) => ({ diaSemana: d.diaSemana, horaInicio: d.horaInicio, horaFim: d.horaFim, duracaoMinutos: d.duracaoMinutos })),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const alterar = (i: number, campo: keyof Bloco, valor: string | number) => {
    setSalvo(false);
    setBlocos((atual) => atual.map((b, j) => (i === j ? { ...b, [campo]: valor } : b)));
  };

  const adicionar = () => {
    setSalvo(false);
    setBlocos((atual) => [...atual, { diaSemana: 1, horaInicio: "08:00", horaFim: "12:00", duracaoMinutos: 30 }]);
  };

  const remover = (i: number) => {
    setSalvo(false);
    setBlocos((atual) => atual.filter((_, j) => j !== i));
  };

  async function salvar() {
    setErro(null);

    for (const b of blocos) {
      if (b.horaFim <= b.horaInicio) {
        setErro(`Em ${DIAS_DA_SEMANA[b.diaSemana]}, o fim (${b.horaFim}) precisa ser depois do inicio (${b.horaInicio}).`);
        return;
      }
      if (vagas(b) === 0) {
        setErro(`Em ${DIAS_DA_SEMANA[b.diaSemana]}, o bloco ${b.horaInicio}-${b.horaFim} nao comporta nenhuma consulta de ${b.duracaoMinutos} minutos.`);
        return;
      }
    }
    for (let i = 0; i < blocos.length; i++) {
      for (let j = i + 1; j < blocos.length; j++) {
        if (seCruzam(blocos[i]!, blocos[j]!)) {
          setErro(`Dois blocos de ${DIAS_DA_SEMANA[blocos[i]!.diaSemana]} se sobrepoem.`);
          return;
        }
      }
    }

    setSalvando(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<{ blocos: number }>("/disponibilidades", {
      metodo: "PUT",
      token: data.session?.access_token,
      clinica: slug,
      corpo: { blocos },
    });
    if (r.ok) {
      setSalvo(true);
      router.refresh();
    } else setErro(r.erro.mensagem);
    setSalvando(false);
  }

  return (
    <div className="space-y-5">
      {blocos.length === 0 ? (
        <Aviso>
          Sua semana esta vazia: nenhum paciente consegue marcar com voce nesta clinica. Adicione ao menos um bloco.
        </Aviso>
      ) : (
        <ul className="space-y-3">
          {blocos.map((b, i) => (
            <li key={i} className="grid gap-3 rounded-lg border border-linha bg-superficie p-4 sm:grid-cols-[10rem_7rem_7rem_9rem_auto] sm:items-end">
              <div className="space-y-1.5">
                <label htmlFor={`dia-${i}`} className="block text-sm font-medium">Dia</label>
                <select id={`dia-${i}`} value={b.diaSemana} onChange={(e) => alterar(i, "diaSemana", Number(e.target.value))} className="w-full rounded-md border border-linha bg-superficie px-3 py-2">
                  {DIAS_DA_SEMANA.map((nome, d) => (
                    <option key={d} value={d}>{nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`de-${i}`} className="block text-sm font-medium">Das</label>
                <input id={`de-${i}`} type="time" value={b.horaInicio} step={300} onChange={(e) => alterar(i, "horaInicio", e.target.value)} className="w-full rounded-md border border-linha bg-superficie px-3 py-2" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`ate-${i}`} className="block text-sm font-medium">as</label>
                <input id={`ate-${i}`} type="time" value={b.horaFim} step={300} onChange={(e) => alterar(i, "horaFim", e.target.value)} className="w-full rounded-md border border-linha bg-superficie px-3 py-2" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`dur-${i}`} className="block text-sm font-medium">Consulta de</label>
                <select id={`dur-${i}`} value={b.duracaoMinutos} onChange={(e) => alterar(i, "duracaoMinutos", Number(e.target.value))} className="w-full rounded-md border border-linha bg-superficie px-3 py-2">
                  {[15, 20, 30, 40, 45, 60].map((m) => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-sm text-tinta-suave">{vagas(b)} vaga(s)</span>
                <button onClick={() => remover(i)} className="text-sm text-alerta underline-offset-4 hover:underline">
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {salvo ? <Aviso tipo="ok">Grade salva. Os horarios ja aparecem para os pacientes.</Aviso> : null}

      <div className="flex flex-wrap gap-3">
        <Botao variante="secundario" onClick={adicionar}>Adicionar bloco</Botao>
        <Botao onClick={salvar} carregando={salvando}>Salvar grade</Botao>
      </div>
      <p className="text-sm text-tinta-suave">
        Salvar substitui a semana inteira. Consultas ja marcadas nao sao afetadas: elas continuam de pe mesmo que o
        horario saia da grade.
      </p>
    </div>
  );
}
