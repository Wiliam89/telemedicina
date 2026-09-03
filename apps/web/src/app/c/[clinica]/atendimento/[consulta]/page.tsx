import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConsultaResumo, DocumentoResumo, EvolucaoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta, hora } from "@/lib/datas";
import { Atendimento } from "./Atendimento";

export const metadata: Metadata = { title: "Atendimento" };

/**
 * A tela onde o medico atende: prontuario a esquerda, documentos a
 * direita, historico do paciente embaixo. So o medico da consulta entra.
 */
export default async function PaginaAtendimento({
  params,
}: {
  params: Promise<{ clinica: string; consulta: string }>;
}) {
  const { clinica: slug, consulta: consultaId } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (clinica.papel !== "medico") notFound();

  const hoje = new Date();
  const de = new Date(hoje.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(hoje.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const agenda = await chamarApi<ConsultaResumo[]>(`/consultas?de=${de}&ate=${ate}`, { token, clinica: slug });
  const consulta = agenda.ok ? agenda.dados.find((c) => c.id === consultaId) : undefined;
  if (!consulta) notFound();
  if (consulta.medico.id !== perfil.id) notFound();

  // Abre (ou reaproveita) o rascunho da evolucao desta consulta.
  const abertura = await chamarApi<{ id: string }>(`/consultas/${consultaId}/evolucao`, { metodo: "POST", token, clinica: slug });
  const historico = await chamarApi<EvolucaoResumo[]>(`/pacientes/${consulta.paciente.id}/prontuario`, { token, clinica: slug });
  const documentos = await chamarApi<DocumentoResumo[]>("/documentos", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-tinta-suave">Atendimento</p>
        <h1 className="font-titulo text-3xl tracking-tight">{consulta.paciente.nomeCompleto}</h1>
        <p className="text-tinta-suave">
          {dataCurta(consulta.inicio, clinica.fusoHorario)} as {hora(consulta.inicio, clinica.fusoHorario)}
          {consulta.motivo ? ` · ${consulta.motivo}` : ""}
        </p>
      </header>

      {!abertura.ok ? (
        <Aviso tipo="erro">{abertura.erro.mensagem}</Aviso>
      ) : (
        <Atendimento
          slug={slug}
          consultaId={consultaId}
          evolucaoId={abertura.dados.id}
          historico={historico.ok ? historico.dados : []}
          documentos={documentos.ok ? documentos.dados.filter((d) => d.status !== "cancelado") : []}
        />
      )}
    </div>
  );
}
