import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProntuarioDoPaciente, type Aba } from "@/componentes/prontuario/ProntuarioDoPaciente";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Prontuário" };

export default async function PaginaProntuario({
  params,
  searchParams,
}: {
  params: Promise<{ clinica: string; paciente: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const { clinica: slug, paciente } = await params;
  const { aba } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (clinica.papel === "paciente") notFound();

  return (
    <div className="space-y-5">
      <Link href={`/c/${slug}/pacientes`} className="inline-flex items-center gap-1.5 text-sm text-tinta-suave hover:text-tinta">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Pacientes
      </Link>
      <ProntuarioDoPaciente
        slug={slug}
        token={token}
        pacienteId={paciente}
        aba={(aba as Aba) ?? "resumo"}
        base={`/c/${slug}/pacientes/${paciente}`}
        souMedico={temPapel(clinica, "medico")}
      />
    </div>
  );
}
