import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { PainelDePlantao } from "./PainelDePlantao";

export const metadata: Metadata = { title: "Plantão" };

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
      <div className="space-y-1">
        <h1 className="text-2xl text-tinta sm:text-[1.75rem]">Plantão</h1>
        <p className="text-tinta-suave">Pronto atendimento: os pacientes entram na fila e são chamados por ordem de chegada.</p>
      </div>

      <PainelDePlantao
        slug={slug}
        souMedico={temPapel(clinica, "medico")}
        meuId={perfil.id}
        plantoes={plantoes.ok ? plantoes.dados : []}
        fila={fila.ok ? fila.dados : { totalAguardando: 0, medicosDePlantao: 0, lista: [] }}
      />
    </div>
  );
}
