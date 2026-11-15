"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MedicoNaAdministracao } from "@tele/shared";
import { formatarPercentual, lerPercentual } from "@tele/shared/admin";
import { ESPECIALIDADES, nomeDaEspecialidade } from "@tele/shared/atendimento";
import { NOME_DA_SITUACAO_CRM } from "@tele/shared/crm";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { Etiqueta } from "@/componentes/ui";
import { emReais } from "@/lib/dinheiro";
import { acaoNaApi } from "@/lib/navegador";

/**
 * Um medico na tela de gestao: o que ele atende e quanto ele ganha por
 * consulta. As duas mudancas valem para as PROXIMAS consultas; as ja
 * marcadas guardaram a porcentagem do dia.
 */
export function EditorDoMedico({ slug, medico, padraoBps }: { slug: string; medico: MedicoNaAdministracao; padraoBps: number | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [proprio, setProprio] = useState(medico.percentualProprioBps !== null);
  const [texto, setTexto] = useState(medico.percentualProprioBps !== null ? String(medico.percentualProprioBps / 100).replace(".", ",") : "");
  const [pronto, setPronto] = useState(medico.atendeProntoAtendimento);
  const [especialidades, setEspecialidades] = useState(medico.especialidades);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setErro(null);
    setOk(null);
    const bps = proprio ? lerPercentual(texto) : null;
    if (proprio && bps === null) {
      setErro("Porcentagem inválida: use um número de 0 a 100, com até duas casas (ex.: 72,5).");
      return;
    }
    if (!pronto && especialidades.length === 0) {
      setErro("Libere ao menos o pronto atendimento ou uma especialidade.");
      return;
    }
    setOcupado(true);
    // So envia o que mudou: o atendimento de medico suspenso nao se altera (a API recusa).
    const mudouAtendimento = pronto !== medico.atendeProntoAtendimento || especialidades.join() !== medico.especialidades.join();
    const [a, b] = await Promise.all([
      acaoNaApi(`/admin/medicos/${medico.id}/percentual`, { metodo: "PUT", clinica: slug, corpo: { percentualBps: bps } }),
      mudouAtendimento
        ? acaoNaApi(`/medicos/${medico.id}/atendimento`, { metodo: "PUT", clinica: slug, corpo: { especialidades, atendeProntoAtendimento: pronto } })
        : Promise.resolve({ ok: true as const, status: 200, dados: null }),
    ]);
    setOcupado(false);
    if (!a.ok || !b.ok) {
      setErro((!a.ok ? a.erro.mensagem : !b.ok ? b.erro.mensagem : "") || "Não foi possível salvar.");
      return;
    }
    setOk("Salvo. Vale para as próximas consultas.");
    router.refresh();
  }

  const alternar = (c: string) => setEspecialidades((a) => (a.includes(c) ? a.filter((x) => x !== c) : a.length >= 6 ? a : [...a, c]));

  return (
    <li className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {medico.nomeCompleto}
            {medico.online ? <Etiqueta tom="selo">online</Etiqueta> : null}
            {medico.status !== "ativo" ? <Etiqueta tom="alerta">{medico.status}</Etiqueta> : null}
            {medico.situacaoCrm !== "verificado" ? <Etiqueta tom="espera">{NOME_DA_SITUACAO_CRM[medico.situacaoCrm]}</Etiqueta> : null}
          </p>
          <p className="text-sm text-tinta-suave">
            CRM {medico.crm}-{medico.crmUf} · {[medico.atendeProntoAtendimento ? "Pronto atendimento" : null, ...medico.especialidades.map(nomeDaEspecialidade)].filter(Boolean).join(", ") || "nada liberado"}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-right text-sm">
          <div>
            <dt className="text-xs text-tinta-suave">Porcentagem</dt>
            <dd className="font-titulo text-base">
              {formatarPercentual(medico.percentualEmVigorBps)}
              {medico.percentualProprioBps === null ? <span className="block text-[0.7rem] font-normal text-tinta-suave">padrão</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">30 dias</dt>
            <dd className="font-titulo text-base">{emReais(medico.ultimos30dias.repasseCentavos)}</dd>
            <dd className="text-[0.7rem] text-tinta-suave">{medico.ultimos30dias.consultas} consulta(s)</dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">A receber</dt>
            <dd className={"font-titulo text-base " + (medico.saldoCentavos > 0 ? "text-espera" : "")}>{emReais(medico.saldoCentavos)}</dd>
          </div>
        </dl>
      </div>

      {!aberto ? (
        <button type="button" onClick={() => setAberto(true)} className="text-sm text-selo underline underline-offset-4">
          Alterar porcentagem e atendimento
        </button>
      ) : (
        <div className="space-y-4 rounded-lg border border-linha bg-superficie-alt p-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Quanto ele recebe de cada consulta</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`perc-${medico.id}`} checked={!proprio} onChange={() => setProprio(false)} /> Usar a porcentagem padrão ({formatarPercentual(padraoBps)})
            </label>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name={`perc-${medico.id}`} checked={proprio} onChange={() => setProprio(true)} /> Porcentagem própria:
              <input
                aria-label="Porcentagem própria do médico"
                inputMode="decimal"
                value={texto}
                onChange={(e) => {
                  setProprio(true);
                  setTexto(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6));
                }}
                className={`${CLASSE_CONTROLE} w-24 border-linha text-right`}
                placeholder="70"
              />
              %
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">O que ele atende</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pronto} onChange={(e) => setPronto(e.target.checked)} /> Pronto atendimento (clínico geral)
            </label>
            <div className="flex flex-wrap gap-2">
              {especialidades.map((c) => (
                <button key={c} type="button" onClick={() => alternar(c)} className="rounded-full bg-selo-suave px-3 py-1 text-sm text-selo-forte ring-1 ring-inset ring-selo/25" aria-label={`Remover ${nomeDaEspecialidade(c)}`}>
                  {nomeDaEspecialidade(c)} ✕
                </button>
              ))}
            </div>
            <label htmlFor={`esp-${medico.id}`} className="sr-only">Adicionar especialidade</label>
            <select id={`esp-${medico.id}`} value="" onChange={(e) => e.target.value && alternar(e.target.value)} className={`${CLASSE_CONTROLE} max-w-sm border-linha`}>
              <option value="">Adicionar especialidade...</option>
              {ESPECIALIDADES.filter((e) => !especialidades.includes(e.codigo)).map((e) => (
                <option key={e.codigo} value={e.codigo}>{e.nome}</option>
              ))}
            </select>
            <p className="text-xs text-tinta-suave">Só libere especialidade comprovada por título de especialista (veja os documentos em Credenciamentos).</p>
          </fieldset>

          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
          <div className="flex flex-wrap gap-3">
            <Botao type="button" onClick={salvar} carregando={ocupado}>Salvar</Botao>
            <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>Fechar</Botao>
          </div>
        </div>
      )}
    </li>
  );
}
