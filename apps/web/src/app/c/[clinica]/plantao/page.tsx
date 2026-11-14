import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { LinhaDeAtendimento, PainelDeChamados } from "@tele/shared";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { PainelDePlantao } from "./PainelDePlantao";

export const metadata: Metadata = { title: "Atendimento imediato" };

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
  lista: { id: string; posicao: number; nome: string; queixa: string | null; status: string; esperandoMinutos: number; linha?: LinhaDeAtendimento; especialidade?: string | null }[];
}

/**
 * O painel do atendimento imediato (ADR-0025): o medico fica online e aceita
 * os pedidos que chegam; a recepcao e a administracao acompanham a fila.
 */
export default async function PaginaPlantao({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "medico", "recepcao", "admin_clinica")) notFound();
  const souMedico = temPapel(clinica, "medico");

  const [plantoes, fila, chamados] = await Promise.all([
    chamarApi<PlantaoResumo[]>("/plantoes", { token, clinica: slug }),
    chamarApi<FilaResumo>("/fila", { token, clinica: slug }),
    souMedico ? chamarApi<PainelDeChamados>("/fila/chamados", { token, clinica: slug }) : null,
  ]);

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        titulo="Atendimento imediato"
        descricao={
          souMedico
            ? "Fique online para receber pacientes do pronto atendimento e das suas especialidades. O primeiro médico que aceita um pedido fica com o atendimento."
            : "Pacientes aguardando atendimento agora e médicos online."
        }
      />
      <PainelDePlantao
        slug={slug}
        souMedico={souMedico}
        meuId={perfil.id}
        plantoes={plantoes.ok ? plantoes.dados : []}
        fila={fila.ok ? fila.dados : { totalAguardando: 0, medicosDePlantao: 0, lista: [] }}
        chamados={chamados?.ok ? chamados.dados : null}
      />
    </div>
  );
}
