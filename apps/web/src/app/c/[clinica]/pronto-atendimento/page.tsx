import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Aviso } from "@/componentes/Aviso";
import { AvisosDaConta } from "@/componentes/AvisosDaConta";
import { dadosDoAtendimento, medicosDaLinha } from "@/componentes/atendimento/dados";
import { EscolhaDeModo } from "@/componentes/atendimento/EscolhaDeModo";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { MarcarConsulta } from "../marcar/MarcarConsulta";
import { ProntoAtendimento } from "./ProntoAtendimento";

export const metadata: Metadata = { title: "Pronto atendimento" };

/**
 * PRONTO ATENDIMENTO (ADR-0024): clinico geral, sem escolher especialidade.
 * Dois modos: ser atendido agora (fila) ou agendar um horario.
 */
export default async function PaginaProntoAtendimento({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ modo?: string }> }) {
  const { clinica: slug } = await params;
  const { modo } = await searchParams;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "paciente")) notFound();

  const base = `/c/${slug}/pronto-atendimento`;
  const { opcoes, erro, fila, cartao } = await dadosDoAtendimento(slug, token);
  // Ja esta numa fila: a tela de espera vale mais que qualquer escolha.
  if (fila.minhaPosicao && fila.minhaLinha === "teleconsulta") redirect(`/c/${slug}/teleconsulta?especialidade=${fila.minhaEspecialidade}&modo=agora`);
  const naFila = Boolean(fila.minhaPosicao);
  const pronto = opcoes?.prontoAtendimento ?? null;

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Clínico geral"
        titulo="Pronto atendimento"
        descricao="Para queixas do dia a dia, sem precisar escolher especialidade. Seja atendido agora ou agende um horário."
      />
      {modo && !naFila ? (
        <Link href={base} className="inline-flex items-center gap-1.5 text-sm text-selo hover:text-selo-forte">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar
        </Link>
      ) : null}

      {erro || !pronto ? (
        <Aviso tipo="erro">{erro ?? "Não foi possível carregar o pronto atendimento."}</Aviso>
      ) : naFila || modo === "agora" ? (
        <ProntoAtendimento slug={slug} estado={fila} valorCentavos={pronto.valorImediatoCentavos} cartao={cartao} medicosOnline={pronto.online} />
      ) : modo === "agendar" ? (
        await (async () => {
          const medicos = await medicosDaLinha(slug, token, "pronto_atendimento");
          return medicos.length === 0 ? (
            <Aviso>Ainda não há clínico geral com agenda aberta. Tente o atendimento agora ou volte mais tarde.</Aviso>
          ) : (
            <MarcarConsulta slug={slug} fuso={clinica.fusoHorario} medicos={medicos} linha="pronto_atendimento" cartao={cartao} valorCentavos={pronto.valorAgendadoCentavos} />
          );
        })()
      ) : (
        <>
          <AvisosDaConta slug={slug} token={token} perfil={perfil} souPaciente souMedico={temPapel(clinica, "medico")} />
          {pronto.medicos === 0 ? <Aviso tipo="espera">Ainda não há clínico geral credenciado. Volte em breve.</Aviso> : null}
          <EscolhaDeModo base={base} online={pronto.online} medicos={pronto.medicos} valorImediatoCentavos={pronto.valorImediatoCentavos} valorAgendadoCentavos={pronto.valorAgendadoCentavos} />
        </>
      )}
    </div>
  );
}
