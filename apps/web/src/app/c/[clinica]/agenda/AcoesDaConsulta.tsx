"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsultaResumo, PapelVinculo } from "@tele/shared";
import { podeRegistrarFalta } from "@tele/shared/retorno";
import { decidirEntrada } from "@tele/shared/video";
import { Botao, LinkBotao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

const DIA = 86400000;

/**
 * Os botoes de cada consulta. Quem pode o que ja e decidido pela API - aqui
 * so evitamos oferecer o que certamente sera recusado, para nao frustrar.
 */
export function AcoesDaConsulta({
  slug,
  consulta,
  papel,
  souOMedico,
  souOPaciente = papel === "paciente",
}: {
  slug: string;
  consulta: ConsultaResumo;
  papel: PapelVinculo;
  souOMedico: boolean;
  souOPaciente?: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [diasDeRetorno, setDiasDeRetorno] = useState<string>("");

  const encerrada = consulta.status === "cancelada" || consulta.status === "concluida";
  const equipe = papel === "recepcao" || papel === "admin_clinica";
  const inicio = new Date(consulta.inicio);
  const recente = Date.now() - inicio.getTime() <= 30 * DIA;

  /** A janela da sala de video desta consulta (Modulo 12). */
  const entrada = decidirEntrada({
    status: consulta.status,
    inicio,
    fim: new Date(consulta.fim),
    agora: new Date(),
  });

  async function chamar(rota: string, corpo?: unknown, mensagemOk?: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi(rota, { metodo: "POST", token: data.session?.access_token, clinica: slug, corpo });
    setOcupado(false);
    if (r.ok) {
      if (mensagemOk) setOk(mensagemOk);
      router.refresh();
    } else setErro(r.erro.mensagem);
  }

  async function cancelar() {
    const motivo = window.prompt("Por que esta consulta esta sendo cancelada?\n(fica registrado na auditoria)");
    if (!motivo || motivo.trim().length < 3) return;
    await chamar(`/consultas/${consulta.id}/cancelar`, { motivo: motivo.trim() });
  }

  async function falta(quem: "paciente" | "medico") {
    const texto = quem === "paciente" ? "Confirmar que o paciente NÃO compareceu? A consulta será encerrada como falta." : "Confirmar que o médico NÃO compareceu? A consulta será encerrada e, se você pagou, a devolução será analisada.";
    if (!window.confirm(texto)) return;
    await chamar(`/consultas/${consulta.id}/falta`, { quem });
  }

  const mensagens = (
    <>
      {erro ? <span role="alert" className="w-full text-sm text-alerta">{erro}</span> : null}
      {ok ? <span role="status" className="w-full text-sm text-selo-forte">{ok}</span> : null}
    </>
  );

  // --- O MEDICO LIBERA O RETORNO SEM CUSTO (ADR-0027, Resolucao CFM 1.958/2010) ---
  // "=== false": com a API antiga (sem estes campos), o botao nao aparece.
  const podeLiberarRetorno = souOMedico && !consulta.retornoDe && consulta.retornoMarcado === false && Date.now() - inicio.getTime() <= 90 * DIA && (consulta.status === "concluida" || consulta.status === "em_andamento");
  const liberarRetorno = podeLiberarRetorno ? (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        // Vazio = o prazo sugerido pela plataforma. O prazo e decisao do medico (CFM 1.958/2010).
        const dias = diasDeRetorno === "" ? undefined : Number(diasDeRetorno);
        if (dias !== undefined && (!Number.isInteger(dias) || dias < 1 || dias > 180)) return setErro("Diga em quantos dias o retorno pode ser marcado: de 1 a 180.");
        void chamar(`/consultas/${consulta.id}/retorno`, dias === undefined ? {} : { dias }, "Retorno liberado. O paciente foi avisado.");
      }}
    >
      <label htmlFor={`retorno-${consulta.id}`} className="text-sm text-tinta-suave">
        {consulta.retornoAte ? "Retorno sem custo até " + new Date(consulta.retornoAte).toLocaleDateString("pt-BR") + ". Novo prazo, em dias:" : "Retorno sem custo: prazo em dias (vazio = padrão)"}
      </label>
      <input
        id={`retorno-${consulta.id}`}
        inputMode="numeric"
        placeholder="padrão"
        value={diasDeRetorno}
        onChange={(e) => setDiasDeRetorno(e.target.value.replace(/\D/g, "").slice(0, 3))}
        className="w-16 rounded-lg border border-linha bg-superficie px-2 py-1.5 text-sm"
      />
      <Botao type="submit" variante="secundario" tamanho="p" carregando={ocupado}>
        {consulta.retornoAte ? "Mudar" : "Liberar retorno"}
      </Botao>
    </form>
  ) : null;

  if (encerrada) {
    const podeMarcarRetorno = souOPaciente && consulta.status === "concluida" && consulta.retornoAte && !consulta.retornoMarcado && new Date(consulta.retornoAte) > new Date();
    const podeAvaliar = souOPaciente && consulta.status === "concluida" && consulta.notaDaAvaliacao === null && recente;
    return (
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {mensagens}
        {souOMedico && consulta.status === "concluida" ? (
          <LinkBotao href={`/c/${slug}/atendimento/${consulta.id}`} variante="secundario" tamanho="p">
            Prontuário
          </LinkBotao>
        ) : null}
        {liberarRetorno}
        {podeMarcarRetorno ? (
          <LinkBotao href={`/c/${slug}/retorno/${consulta.id}`} tamanho="p">
            Marcar retorno sem custo
          </LinkBotao>
        ) : null}
        {consulta.retornoMarcado && souOPaciente ? <span className="text-sm text-tinta-suave">Retorno marcado</span> : null}
        {podeAvaliar ? <Avaliar slug={slug} consultaId={consulta.id} /> : null}
        {souOPaciente && typeof consulta.notaDaAvaliacao === "number" ? <span className="text-sm text-tinta-suave">Sua nota: {consulta.notaDaAvaliacao}</span> : null}
      </div>
    );
  }

  // Consulta reservada esperando pagamento: a acao principal e pagar.
  if (consulta.status === "aguardando_pagamento") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <LinkBotao href={`/c/${slug}/pagamento/${consulta.id}`} tamanho="p">
          Pagar
        </LinkBotao>
        <Botao variante="fantasma" tamanho="p" onClick={cancelar} disabled={ocupado} className="text-alerta hover:text-alerta">
          Cancelar
        </Botao>
      </div>
    );
  }

  // ADR-0027: passada a tolerancia, o outro lado (ou a equipe) registra a falta.
  const passouDaHora = podeRegistrarFalta(inicio, new Date());

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mensagens}

      {souOMedico && consulta.status === "agendada" ? (
        <Botao variante="secundario" tamanho="p" carregando={ocupado} onClick={() => chamar(`/consultas/${consulta.id}/status`, { status: "em_andamento" })}>
          Iniciar
        </Botao>
      ) : null}
      {souOMedico ? (
        <LinkBotao href={`/c/${slug}/atendimento/${consulta.id}`} tamanho="p">
          Atender
        </LinkBotao>
      ) : null}

      {/*
        O CAMINHO DO PACIENTE PARA A SALA (Modulo 12).

        A mesma regra que a API usa para liberar a entrada decide o que
        aparece aqui - ela vive em @tele/shared/video justamente para os dois
        lados concordarem. Fora da janela, em vez de um botao que responde
        erro, a tela diz a que horas a sala abre.

        O relogio usado aqui e o do computador da pessoa, que pode estar
        errado; por isso quem decide de verdade continua sendo a API. Esta
        checagem e so para nao oferecer o que vai ser recusado.
      */}
      {papel === "paciente" ? (
        entrada.pode ? (
          <LinkBotao href={`/c/${slug}/consulta/${consulta.id}`} tamanho="p">
            Entrar na consulta
          </LinkBotao>
        ) : entrada.motivo === "cedo_demais" ? (
          <span className="text-sm text-tinta-suave">
            A sala abre às {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(entrada.abreEm)}
          </span>
        ) : null
      ) : null}
      {souOMedico && consulta.status === "em_andamento" ? (
        <Botao tamanho="p" carregando={ocupado} onClick={() => chamar(`/consultas/${consulta.id}/status`, { status: "concluida" })}>
          Concluir
        </Botao>
      ) : null}
      {liberarRetorno}
      {passouDaHora && (souOMedico || equipe) && (consulta.status === "agendada" || consulta.status === "em_andamento") ? (
        <Botao variante="secundario" tamanho="p" disabled={ocupado} onClick={() => falta("paciente")}>
          Paciente faltou
        </Botao>
      ) : null}
      {passouDaHora && (souOPaciente || equipe) && consulta.status === "agendada" ? (
        <Botao variante="secundario" tamanho="p" disabled={ocupado} onClick={() => falta("medico")}>
          Médico não veio
        </Botao>
      ) : null}
      {papel !== "medico" || souOMedico ? (
        <Botao variante="fantasma" tamanho="p" onClick={cancelar} disabled={ocupado} className="text-alerta hover:text-alerta">
          Cancelar
        </Botao>
      ) : null}
    </div>
  );
}

/**
 * "De 0 a 10, quanto voce recomendaria?" (NPS). Uma vez por consulta, opcional.
 * A nota vai para a plataforma; o comentario e curto e sem dado de saude.
 */
function Avaliar({ slug, consultaId }: { slug: string; consultaId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!aberto) {
    return (
      <Botao variante="fantasma" tamanho="p" onClick={() => setAberto(true)}>
        Avaliar atendimento
      </Botao>
    );
  }

  async function enviar() {
    if (nota === null) return setErro("Escolha uma nota de 0 a 10.");
    setOcupado(true);
    setErro(null);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi(`/consultas/${consultaId}/avaliacao`, {
      metodo: "POST",
      token: data.session?.access_token,
      clinica: slug,
      corpo: { nota, ...(comentario.trim() ? { comentario: comentario.trim() } : {}) },
    });
    setOcupado(false);
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
  }

  return (
    <fieldset className="w-full space-y-3 rounded-xl border border-linha bg-superficie-alt p-4">
      <legend className="px-1 text-sm font-medium">De 0 a 10, quanto você recomendaria este atendimento a um amigo?</legend>
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Nota de 0 a 10"
        onKeyDown={(e) => {
          // Setas mudam a nota, como manda o padrao de grupo de opcoes (WAI-ARIA).
          if (!["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"].includes(e.key)) return;
          e.preventDefault();
          const passo = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1;
          const nova = Math.min(10, Math.max(0, (nota ?? (passo > 0 ? -1 : 11)) + passo));
          setNota(nova);
          (e.currentTarget.querySelectorAll("button")[nova] as HTMLButtonElement | undefined)?.focus();
        }}
      >
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={nota === n}
            tabIndex={nota === n || (nota === null && n === 0) ? 0 : -1}
            onClick={() => setNota(n)}
            className={"h-9 w-9 rounded-lg border text-sm font-medium " + (nota === n ? "border-selo bg-selo text-white" : "border-linha bg-superficie hover:border-selo")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <label htmlFor={`comentario-${consultaId}`} className="block text-sm">O que podemos melhorar? (opcional)</label>
        <textarea
          id={`comentario-${consultaId}`}
          value={comentario}
          maxLength={500}
          rows={2}
          onChange={(e) => setComentario(e.target.value)}
          className="w-full rounded-lg border border-linha bg-superficie px-3 py-2 text-sm"
        />
        <p className="text-xs text-tinta-suave">Não escreva informações de saúde aqui: este recado vai para a equipe da plataforma, não para o prontuário.</p>
      </div>
      {erro ? <p role="alert" className="text-sm text-alerta">{erro}</p> : null}
      <div className="flex gap-2">
        <Botao tamanho="p" carregando={ocupado} onClick={enviar}>Enviar avaliação</Botao>
        <Botao variante="fantasma" tamanho="p" onClick={() => setAberto(false)}>Agora não</Botao>
      </div>
    </fieldset>
  );
}
