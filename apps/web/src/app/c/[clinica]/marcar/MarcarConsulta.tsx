"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CartaoResumo, ConsultaResumo, HorarioLivre, LinhaDeAtendimento, MedicoResumo } from "@tele/shared";
import { nomeDaEspecialidade } from "@tele/shared/atendimento";
import { emReais } from "@/lib/dinheiro";
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
export function MarcarConsulta({
  slug,
  fuso,
  medicos,
  linha,
  especialidade,
  cartao = null,
  valorCentavos = null,
  retorno = null,
}: {
  slug: string;
  fuso: string;
  medicos: MedicoResumo[];
  /** ADR-0024: quando o paciente vem de uma linha de atendimento. A recepcao marca sem informar. */
  linha?: LinhaDeAtendimento;
  especialidade?: string;
  /** ADR-0023: com cartao, a consulta e debitada ao final; sem cartao, Pix em seguida. */
  cartao?: CartaoResumo | null;
  valorCentavos?: number | null;
  /** ADR-0027: marcando o RETORNO SEM CUSTO de uma consulta, ate a data-limite. */
  retorno?: { de: string; ate: string } | null;
}) {
  const router = useRouter();
  const [prefiroPix, setPrefiroPix] = useState(false);
  const usaCartao = Boolean(cartao && !cartao.vencido && !prefiroPix);
  // No retorno, os dias vao ate o fim do prazo que o medico liberou.
  const dias = retorno
    ? proximosDias(Math.min(90, Math.max(1, Math.ceil((new Date(retorno.ate).getTime() - Date.now()) / 86400000) + 1)), fuso).filter((d) => d <= new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(retorno.ate)))
    : proximosDias(14, fuso);

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
      if (r.ok) setHorarios(retorno ? r.dados.filter((h) => new Date(h.inicio) <= new Date(retorno.ate)) : r.dados);
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
      corpo: {
        medicoId,
        inicio: horario.inicio,
        motivo: motivo.trim() || undefined,
        ...(linha ? { linha } : {}),
        ...(linha === "teleconsulta" && especialidade ? { especialidade } : {}),
        ...(cartao && prefiroPix ? { cobranca: "pix" } : {}),
        ...(retorno ? { retornoDe: retorno.de } : {}),
      },
    });
    if (r.ok) {
      // Sem cartao: o horario ficou reservado e o Pix vem agora, antes de a consulta existir de fato.
      router.push(r.dados.status === "aguardando_pagamento" ? `/c/${slug}/pagamento/${r.dados.id}` : `/c/${slug}/agenda`);
      router.refresh();
      return;
    }
    if (r.erro.codigo === "PAGAMENTO_PENDENTE") {
      const consultaId = (r.erro.detalhes as { consultaId?: string } | undefined)?.consultaId;
      if (consultaId) router.push(`/c/${slug}/pagamento/${consultaId}`);
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
        <select id="medico" value={medicoId} onChange={(e) => setMedicoId(e.target.value)} className="w-full max-w-md rounded-lg border border-linha bg-superficie px-3 py-2.5 shadow-[inset_0_1px_1px_rgb(15_23_42/0.03)] focus:border-selo focus:outline-none focus:ring-4 focus:ring-selo/15 text-base">
          {medicos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nomeCompleto} — {linha === "teleconsulta" && especialidade ? nomeDaEspecialidade(especialidade) : linha === "pronto_atendimento" ? "Clínico geral" : (m.especialidade ?? "clínica geral")} (CRM {m.crm}-{m.crmUf})
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
                "shrink-0 rounded-lg border px-3 py-2 text-sm " +
                (d === dia ? "border-selo bg-selo-suave font-medium text-selo" : "border-linha bg-superficie")
              }
            >
              {rotuloDoDia(d, fuso)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <span className="block text-sm font-medium">Horários livres</span>
        {horarios === null ? (
          <p className="text-sm text-tinta-suave">Consultando a agenda...</p>
        ) : horarios.length === 0 ? (
          <Aviso>Nenhum horário livre neste dia. Escolha outro dia ou outro profissional.</Aviso>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {horarios.map((h) => (
              <li key={h.inicio}>
                <button
                  onClick={() => marcar(h)}
                  disabled={marcando !== null}
                  className="rounded-xl border border-linha bg-superficie shadow-cartao px-4 py-2 font-mono hover:border-selo hover:bg-selo-suave disabled:opacity-50"
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
        ajuda="Uma linha sobre o que você sente. Não é o prontuário: é só para o profissional se preparar."
      />

      {retorno ? (
        <Aviso tipo="ok">
          Retorno <strong>sem custo</strong>, com o mesmo médico, até{" "}
          {new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "long" }).format(new Date(retorno.ate))}. Se surgir uma queixa nova, o médico pode orientar uma nova consulta.
        </Aviso>
      ) : null}
      {valorCentavos !== null && !retorno ? (
        <div className="max-w-md rounded-xl border border-linha bg-superficie-alt p-4 text-sm">
          {usaCartao ? (
            <>
              <p>
                <strong>{emReais(valorCentavos)}</strong> no cartão final <strong>{cartao!.ultimos4}</strong>, debitado só quando a consulta terminar. Se a consulta for cancelada, nada é cobrado.
              </p>
              <button type="button" onClick={() => setPrefiroPix(true)} className="mt-2 text-selo underline underline-offset-4">
                Prefiro pagar por Pix agora
              </button>
            </>
          ) : (
            <>
              <p>
                <strong>{emReais(valorCentavos)}</strong> por Pix. Ao escolher o horário ele fica reservado por 20 minutos, e o Pix aparece em seguida para confirmar.
              </p>
              {cartao && !cartao.vencido ? (
                <button type="button" onClick={() => setPrefiroPix(false)} className="mt-2 text-selo underline underline-offset-4">
                  Usar o cartão final {cartao.ultimos4}
                </button>
              ) : linha ? (
                <Link href={`/c/${slug}/cartao`} className="mt-2 inline-block text-selo underline underline-offset-4">
                  Cadastrar um cartão e pagar só no final
                </Link>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <p className="text-sm text-tinta-suave">Escolher o horário já marca a consulta.</p>
    </div>
  );
}
