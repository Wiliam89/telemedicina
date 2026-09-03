import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConsultaResumo } from "@tele/shared";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta, hora } from "@/lib/datas";
import { PagarConsulta } from "./PagarConsulta";

export const metadata: Metadata = { title: "Pagamento" };

/**
 * A tela de pagamento de uma consulta reservada. O horario esta preso
 * enquanto o pagamento nao acontece - e a tela diz isso, com o prazo.
 */
export default async function PaginaPagamento({ params }: { params: Promise<{ clinica: string; consulta: string }> }) {
  const { clinica: slug, consulta: consultaId } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);

  const hoje = new Date();
  const de = new Date(hoje.getTime() - 15 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(hoje.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  const agenda = await chamarApi<ConsultaResumo[]>(`/consultas?de=${de}&ate=${ate}`, { token, clinica: slug });
  const consulta = agenda.ok ? agenda.dados.find((c) => c.id === consultaId) : undefined;
  if (!consulta) notFound();

  const precos = await chamarApi<{ tipo: string; medicoId: string | null; valorCentavos: number }[]>("/precos", { token, clinica: slug });
  const doMedico = precos.ok ? precos.dados.find((p) => p.tipo === "agendada" && p.medicoId === consulta.medico.id) : undefined;
  const padrao = precos.ok ? precos.dados.find((p) => p.tipo === "agendada" && p.medicoId === null) : undefined;
  const valorCentavos = (doMedico ?? padrao)?.valorCentavos ?? null;

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Pagamento da consulta</h1>
        <p className="text-tinta-suave">
          {dataCurta(consulta.inicio, clinica.fusoHorario)} as {hora(consulta.inicio, clinica.fusoHorario)} · CRM{" "}
          {consulta.medico.crm}-{consulta.medico.crmUf}
        </p>
      </div>

      <PagarConsulta slug={slug} consultaId={consultaId} status={consulta.status} valorCentavos={valorCentavos} />
    </div>
  );
}
