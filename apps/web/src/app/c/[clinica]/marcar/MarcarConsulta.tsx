"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ConsultaResumo, HorarioLivre, MedicoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { proximosDias, rotuloDoDia } from "@/lib/datas";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * Tres passos: medico, dia, horario. A lista de horarios vem SEMPRE da API
 * - o site nao calcula nada por conta propria, para nao oferecer horario
 * que o servidor recusaria.
 */
export function MarcarConsulta({ slug, fuso, medicos }: { slug: string; fuso: string; medicos: MedicoResumo[] }) {
  const router = useRouter();
  const dias = proximosDias(14, fuso);

  const [medicoId, setMedicoId] = useState(medicos[0]!.id);
  const [dia, setDia] = useState(dias[0]!);
  const [horarios, setHorarios] = useState<HorarioLivre[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setHorarios(null);
    setErro(null);

    (async () => {
      const { data } = await criarClienteNavegador().auth.getSession();
      const r = await chamarApi<HorarioLivre[]>(`/horarios?medicoId=${medicoId}&data=${dia}`, {
        token: data.session?.access_token,
        clinica: slug,
      });
      if (cancelado) return;
      if (r.ok) setHorarios(r.dados);
      else {
        setHorarios([]);
        setErro(r.erro.mensagem);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [medicoId, dia, slug]);

  async function marcar(horario: HorarioLivre) {
    setErro(null);
    setMarcando(horario.inicio);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<ConsultaResumo>("/consultas", {
      metodo: "POST",
      token: data.session?.access_token,
      clinica: slug,
      corpo: { medicoId, inicio: horario.inicio, motivo: motivo.trim() || undefined },
    });

    if (r.ok) {
      router.push(`/c/${slug}/agenda`);
      router.refresh();
      return;
    }
    setErro(r.erro.mensagem);
    setMarcando(null);
    // Alguem pode ter ocupado o horario enquanto a tela estava aberta:
    // recarregamos a lista para a pessoa ver o que sobrou.
    if (r.status === 409) {
      const { data: s } = await criarClienteNavegador().auth.getSession();
      const novos = await chamarApi<HorarioLivre[]>(`/horarios?medicoId=${medicoId}&data=${dia}`, { token: s.session?.access_token, clinica: slug });
      if (novos.ok) setHorarios(novos.dados);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <label htmlFor="medico" className="block text-sm font-medium">Com quem</label>
        <select id="medico" value={medicoId} onChange={(e) => setMedicoId(e.target.value)} className="w-full max-w-md rounded-md border border-linha bg-superficie px-3 py-2 text-base">
          {medicos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nomeCompleto} — {m.especialidade ?? "clinica geral"} (CRM {m.crm}-{m.crmUf})
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-2">
        <span className="block text-sm font-medium">Quando</span>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {dias.map((d) => (
            <button
              key={d}
              onClick={() => setDia(d)}
              aria-pressed={d === dia}
              className={
                "shrink-0 rounded-md border px-3 py-2 text-sm " +
                (d === dia ? "border-selo bg-selo-suave font-medium text-selo" : "border-linha bg-superficie")
              }
            >
              {rotuloDoDia(d, fuso)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <span className="block text-sm font-medium">Horarios livres</span>
        {horarios === null ? (
          <p className="text-sm text-tinta-suave">Consultando a agenda...</p>
        ) : horarios.length === 0 ? (
          <Aviso>Nenhum horario livre neste dia. Escolha outro dia ou outro profissional.</Aviso>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {horarios.map((h) => (
              <li key={h.inicio}>
                <button
                  onClick={() => marcar(h)}
                  disabled={marcando !== null}
                  className="rounded-md border border-linha bg-superficie px-4 py-2 font-mono hover:border-selo hover:bg-selo-suave disabled:opacity-50"
                >
                  {marcando === h.inicio ? "..." : h.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Campo
        id="motivo"
        rotulo="Motivo (opcional)"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        ajuda="Uma linha sobre o que voce sente. Nao e o prontuario: e so para o profissional se preparar."
      />

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <p className="text-sm text-tinta-suave">Escolher o horario ja marca a consulta.</p>
    </div>
  );
}
