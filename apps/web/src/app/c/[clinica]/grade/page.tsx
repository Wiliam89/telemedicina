import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DisponibilidadeResumo } from "@tele/shared";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { EditorDaGrade } from "./EditorDaGrade";

export const metadata: Metadata = { title: "Meus horarios" };

/**
 * A grade semanal do medico NESTA clinica. Quem nao e medico aqui nem sabe
 * que a tela existe.
 */
export default async function PaginaGrade({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (clinica.papel !== "medico") notFound();

  const r = await chamarApi<DisponibilidadeResumo[]>("/disponibilidades", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Meus horarios de atendimento</h1>
        <p className="text-tinta-suave">
          Esta e a sua semana <strong>nesta clinica</strong>. Os horarios que os pacientes veem sao calculados a partir
          dela, menos o que ja esta marcado. Hora local de {clinica.nomeFantasia}.
        </p>
      </div>
      <EditorDaGrade slug={slug} inicial={r.ok ? r.dados : []} />
    </div>
  );
}
