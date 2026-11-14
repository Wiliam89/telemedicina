import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Stethoscope } from "lucide-react";
import { nomeDaEspecialidade } from "@tele/shared/atendimento";
import { Aviso } from "@/componentes/Aviso";
import { AvisosDaConta } from "@/componentes/AvisosDaConta";
import { dadosDoAtendimento, medicosDaLinha } from "@/componentes/atendimento/dados";
import { EscolhaDeModo } from "@/componentes/atendimento/EscolhaDeModo";
import { CabecalhoDaPagina, Vazio } from "@/componentes/ui";
import { contextoDaClinica } from "@/lib/clinica";
import { emReais } from "@/lib/dinheiro";
import { temPapel } from "@/lib/papeis";
import { MarcarConsulta } from "../marcar/MarcarConsulta";
import { ProntoAtendimento } from "../pronto-atendimento/ProntoAtendimento";

export const metadata: Metadata = { title: "Teleconsulta" };

/**
 * TELECONSULTA (ADR-0024): atendimento ESPECIALIZADO. O paciente escolhe a
 * especialidade e depois o modo - agora (fila daquela especialidade) ou
 * agendado (com o especialista escolhido).
 *
 * So aparece especialidade que tem medico credenciado: oferecer o que
 * ninguem atende seria prometer o que nao sera cumprido.
 */
export default async function PaginaTeleconsulta({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ especialidade?: string; modo?: string }> }) {
  const { clinica: slug } = await params;
  const { especialidade: pedida, modo } = await searchParams;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "paciente")) notFound();

  const base = `/c/${slug}/teleconsulta`;
  const { opcoes, erro, fila, cartao } = await dadosDoAtendimento(slug, token);
  if (fila.minhaPosicao && fila.minhaLinha === "pronto_atendimento") redirect(`/c/${slug}/pronto-atendimento?modo=agora`);
  const naFila = Boolean(fila.minhaPosicao && fila.minhaLinha === "teleconsulta");

  const codigo = naFila ? fila.minhaEspecialidade : pedida;
  const escolhida = opcoes?.especialidades.find((e) => e.codigo === codigo) ?? null;
  // Especialidade na URL que nao existe aqui: volta para a lista, sem erro tecnico.
  if (pedida && opcoes && !escolhida && !naFila) redirect(base);

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo={escolhida ? "Teleconsulta" : "Atendimento especializado"}
        titulo={escolhida ? escolhida.nome : "Teleconsulta"}
        descricao={escolhida ? "Seja atendido agora por um especialista online ou agende um horário." : "Consulta com médico especialista. Escolha a especialidade para ver quem atende e os valores."}
      />
      {escolhida && !naFila ? (
        <Link href={modo ? `${base}?especialidade=${escolhida.codigo}` : base} className="inline-flex items-center gap-1.5 text-sm text-selo hover:text-selo-forte">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {modo ? "Voltar" : "Outras especialidades"}
        </Link>
      ) : null}

      {erro || !opcoes ? (
        <Aviso tipo="erro">{erro ?? "Não foi possível carregar as especialidades."}</Aviso>
      ) : naFila || (escolhida && modo === "agora") ? (
        <ProntoAtendimento
          slug={slug}
          estado={fila}
          linha="teleconsulta"
          especialidade={codigo ?? null}
          valorCentavos={escolhida?.valorImediatoCentavos ?? null}
          cartao={cartao}
          medicosOnline={escolhida?.online ?? 0}
        />
      ) : escolhida && modo === "agendar" ? (
        await (async () => {
          const medicos = await medicosDaLinha(slug, token, "teleconsulta", escolhida.codigo);
          return medicos.length === 0 ? (
            <Aviso>Nenhum especialista com agenda aberta agora. Tente o atendimento imediato ou volte mais tarde.</Aviso>
          ) : (
            <MarcarConsulta slug={slug} fuso={clinica.fusoHorario} medicos={medicos} linha="teleconsulta" especialidade={escolhida.codigo} cartao={cartao} valorCentavos={escolhida.valorAgendadoCentavos} />
          );
        })()
      ) : escolhida ? (
        <EscolhaDeModo
          base={`${base}?especialidade=${escolhida.codigo}`}
          online={escolhida.online}
          medicos={escolhida.medicos}
          valorImediatoCentavos={escolhida.valorImediatoCentavos}
          valorAgendadoCentavos={escolhida.valorAgendadoCentavos}
        />
      ) : (
        <>
          <AvisosDaConta slug={slug} token={token} perfil={perfil} souPaciente souMedico={temPapel(clinica, "medico")} />
          {opcoes.especialidades.length === 0 ? (
            <Vazio Icone={Stethoscope} titulo="Ainda não há especialistas credenciados">
              Enquanto isso, o pronto atendimento com clínico geral pode ajudar.{" "}
              <Link href={`/c/${slug}/pronto-atendimento`} className="text-selo underline underline-offset-4">
                Ir para o pronto atendimento
              </Link>
            </Vazio>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {opcoes.especialidades.map((e) => {
                const menor = [e.valorImediatoCentavos, e.valorAgendadoCentavos].filter((v): v is number => v !== null).sort((a, b) => a - b)[0];
                return (
                  <li key={e.codigo}>
                    <Link
                      href={`${base}?especialidade=${e.codigo}`}
                      className="flex h-full flex-col gap-2 rounded-xl border border-linha bg-superficie p-4 shadow-cartao transition-colors hover:border-selo/60 hover:bg-selo-suave/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-selo/20"
                    >
                      <span className="font-medium text-tinta">{nomeDaEspecialidade(e.codigo)}</span>
                      <span className="text-xs text-tinta-suave">
                        {e.online > 0 ? (
                          <>
                            <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-selo align-middle" />
                            {e.online} online agora
                          </>
                        ) : (
                          `${e.medicos} médico(s)`
                        )}
                      </span>
                      {menor !== undefined ? <span className="mt-auto pt-1 text-sm text-tinta-suave">a partir de <strong className="text-tinta">{emReais(menor)}</strong></span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
