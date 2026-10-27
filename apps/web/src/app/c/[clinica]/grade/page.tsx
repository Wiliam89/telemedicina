import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DisponibilidadeResumo } from "@tele/shared";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { EditorDaGrade } from "./EditorDaGrade";

export const metadata: Metadata = { title: "Meus horários" };

/**
 * A grade semanal do medico NESTA clinica. Quem nao e medico aqui nem sabe
 * que a tela existe.
 */
export default async function PaginaGrade({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "medico")) notFound();

  const r = await chamarApi<DisponibilidadeResumo[]>("/disponibilidades", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl text-tinta sm:text-[1.75rem]">Meus horários de atendimento</h1>
        <p className="text-tinta-suave">
          Esta é a sua semana <strong>nesta clínica</strong>. Os horários que os pacientes veem são calculados a partir
          dela, menos o que já está marcado. Hora local de {clinica.nomeFantasia}.
        </p>
      </div>
      <EditorDaGrade slug={slug} inicial={r.ok ? r.dados : []} />
    </div>
  );
}
