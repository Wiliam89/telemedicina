import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { PainelDePlantao } from "./PainelDePlantao";

export const metadata: Metadata = { title: "Plantao" };

export interface PlantaoResumo {
  id: string;
  inicio: string;
  fim: string;
  status: string;
  medicoId: string;
  medicoNome: string;
  crm: string;
  crmUf: string;
}

export interface FilaResumo {
  totalAguardando: number;
  medicosDePlantao: number;
  lista: { id: string; posicao: number; nome: string; queixa: string | null; status: string; esperandoMinutos: number }[];
}

/** O painel de quem atende: escala, fila e o botao de chamar o proximo. */
export default async function PaginaPlantao({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!["medico", "recepcao", "admin_clinica"].includes(clinica.papel)) notFound();

  const [plantoes, fila] = await Promise.all([
    chamarApi<PlantaoResumo[]>("/plantoes", { token, clinica: slug }),
    chamarApi<FilaResumo>("/fila", { token, clinica: slug }),
  ]);

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Plantao</h1>
        <p className="text-tinta-suave">Pronto atendimento: os pacientes entram na fila e sao chamados por ordem de chegada.</p>
      </div>

      <PainelDePlantao
        slug={slug}
        souMedico={clinica.papel === "medico"}
        meuId={perfil.id}
        plantoes={plantoes.ok ? plantoes.dados : []}
        fila={fila.ok ? fila.dados : { totalAguardando: 0, medicosDePlantao: 0, lista: [] }}
      />
    </div>
  );
}
