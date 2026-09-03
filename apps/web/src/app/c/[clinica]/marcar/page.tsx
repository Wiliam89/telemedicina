import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MedicoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { MarcarConsulta } from "./MarcarConsulta";

export const metadata: Metadata = { title: "Marcar consulta" };

/**
 * Marcar consulta. O paciente marca para si; a recepcao marca em nome de
 * alguem (a API confere quem pode o que).
 */
export default async function PaginaMarcar({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (clinica.papel === "medico") notFound();

  const medicos = await chamarApi<MedicoResumo[]>("/medicos", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Marcar consulta</h1>
        <p className="text-tinta-suave">Escolha o profissional, o dia e o horario. Horarios em hora local de {clinica.nomeFantasia}.</p>
      </div>

      {!medicos.ok ? (
        <Aviso tipo="erro">{medicos.erro.mensagem}</Aviso>
      ) : medicos.dados.length === 0 ? (
        <Aviso>Nenhum medico atende nesta clinica ainda.</Aviso>
      ) : (
        <MarcarConsulta slug={slug} fuso={clinica.fusoHorario} medicos={medicos.dados} />
      )}
    </div>
  );
}
