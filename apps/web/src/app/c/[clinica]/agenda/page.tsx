import { CalendarDays, CalendarPlus, Clock3 } from "lucide-react";
import type { Metadata } from "next";
import type { ConsultaResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { LinkBotao } from "@/componentes/Botao";
import { StatusDaConsulta } from "@/componentes/EtiquetaDeStatus";
import { Avatar, CabecalhoDaPagina, Cartao, Etiqueta, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { dataCurta, diaPorExtenso, hora } from "@/lib/datas";
import { AcoesDaConsulta } from "./AcoesDaConsulta";

export const metadata: Metadata = { title: "Agenda" };

/**
 * A agenda, vista de onde a pessoa esta:
 *   paciente -> "minhas consultas"
 *   medico   -> "meus atendimentos"
 *   recepcao -> "a agenda da clinica"
 *
 * Quem ve o que e decidido pela API (que filtra pelo papel). Esta tela
 * apenas escolhe o titulo e quais acoes oferecer.
 */
export default async function PaginaAgenda({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const fuso = clinica.fusoHorario;

  const r = await chamarApi<ConsultaResumo[]>("/consultas", { token, clinica: slug });

  const titulo =
    clinica.papel === "paciente" ? "Minhas consultas" : clinica.papel === "medico" ? "Meus atendimentos" : "Agenda da clínica";

  // Agrupa por dia, para a tela ler como uma agenda de papel.
  const porDia = new Map<string, ConsultaResumo[]>();
  if (r.ok) {
    for (const c of r.dados) {
      const dia = dataCurta(c.inicio, fuso);
      porDia.set(dia, [...(porDia.get(dia) ?? []), c]);
    }
  }
  const ativas = r.ok ? r.dados.filter((c) => c.status !== "cancelada") : [];

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        titulo={titulo}
        descricao="Consultas de ontem até os próximos 30 dias, no fuso horário da clínica."
        acoes={
          <>
            {temPapel(clinica, "medico") ? (
              <LinkBotao href={`/c/${slug}/grade`} variante="secundario" icone={<Clock3 className="h-4 w-4" aria-hidden="true" />}>
                Meus horários
              </LinkBotao>
            ) : null}
            {clinica.papel === "paciente" || clinica.papel === "recepcao" ? (
              <LinkBotao href={`/c/${slug}/marcar`} icone={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}>
                Marcar consulta
              </LinkBotao>
            ) : null}
          </>
        }
      />

      {r.ok ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Etiqueta tom="info">{ativas.filter((c) => c.status === "agendada").length} agendada(s)</Etiqueta>
          <Etiqueta tom="espera">{ativas.filter((c) => c.status === "aguardando_pagamento").length} aguardando pagamento</Etiqueta>
          <Etiqueta tom="neutro">{ativas.filter((c) => c.status === "concluida").length} concluída(s)</Etiqueta>
        </div>
      ) : null}

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : porDia.size === 0 ? (
        <Vazio
          Icone={CalendarDays}
          titulo="Nenhuma consulta nos próximos 30 dias"
          acao={clinica.papel === "paciente" ? <LinkBotao href={`/c/${slug}/marcar`}>Marcar consulta</LinkBotao> : undefined}
        >
          {clinica.papel === "medico" ? "Cadastre seus horários de atendimento para receber marcações." : null}
        </Vazio>
      ) : (
        <div className="space-y-6">
          {[...porDia.entries()].map(([dia, lista]) => (
            <Cartao
              key={dia}
              titulo={<span className="inline-block first-letter:uppercase">{diaPorExtenso(lista[0]!.inicio, fuso)}</span>}
              acoes={<Etiqueta>{lista.length} consulta(s)</Etiqueta>}
              semPadding
            >
              <ul className="divide-y divide-linha">
                {lista.map((c) => {
                  const nome = clinica.papel === "paciente" ? c.medico.nomeCompleto : c.paciente.nomeCompleto;
                  const cancelada = c.status === "cancelada";
                  const detalhe =
                    clinica.papel === "paciente"
                      ? `${c.medico.especialidade ?? "Clínica geral"} · CRM ${c.medico.crm}-${c.medico.crmUf}`
                      : cancelada && c.motivoCancelamento
                        ? `Cancelada: ${c.motivoCancelamento}`
                        : (c.motivo ?? "Sem observação");
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                      <div className="w-14 shrink-0">
                        <p className={"font-titulo text-lg font-semibold leading-none " + (cancelada ? "text-tinta-suave line-through" : "")}>
                          {hora(c.inicio, fuso)}
                        </p>
                        <p className="mt-1 text-xs text-tinta-suave">até {hora(c.fim, fuso)}</p>
                      </div>
                      <Avatar nome={nome} tamanho="p" />
                      <div className="min-w-[12rem] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{nome}</p>
                          <StatusDaConsulta status={c.status} />
                        </div>
                        <p className="mt-0.5 text-sm text-tinta-suave">
                          {detalhe}
                          {clinica.papel === "recepcao" || clinica.papel === "admin_clinica" ? ` · Dr(a). ${c.medico.nomeCompleto}` : ""}
                        </p>
                      </div>
                      <AcoesDaConsulta slug={slug} consulta={c} papel={clinica.papel} souOMedico={c.medico.id === perfil.id} />
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          ))}
        </div>
      )}
    </div>
  );
}
