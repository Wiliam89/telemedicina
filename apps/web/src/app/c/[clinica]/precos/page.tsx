import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MedicoResumo } from "@tele/shared";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { EditorDePrecos } from "./EditorDePrecos";

export const metadata: Metadata = { title: "Valores" };

export default async function PaginaPrecos({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (clinica.papel !== "admin_clinica") notFound();

  const [precos, medicos] = await Promise.all([
    chamarApi<{ tipo: string; medicoId: string | null; valorCentavos: number }[]>("/precos", { token, clinica: slug }),
    chamarApi<MedicoResumo[]>("/medicos", { token, clinica: slug }),
  ]);

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Valores</h1>
        <p className="text-tinta-suave">
          Enquanto nao houver valor definido, os pacientes marcam consulta sem pagar — util para quem cobra por fora da
          plataforma.
        </p>
      </div>
      <EditorDePrecos
        slug={slug}
        inicial={precos.ok ? precos.dados : []}
        medicos={medicos.ok ? medicos.dados : []}
      />
    </div>
  );
}
