import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { ProntoAtendimento } from "./ProntoAtendimento";

export const metadata: Metadata = { title: "Pronto atendimento" };

interface EstadoDaFila {
  totalAguardando: number;
  medicosDePlantao: number;
  minhaPosicao: number | null;
  minhaSituacao: string | null;
  esperaEstimadaMinutos: number | null;
}

/**
 * O segundo modo de atendimento: sem escolher horario nem profissional.
 * Paga, aceita o termo, entra na fila e e chamado pelo proximo medico
 * disponivel.
 */
export default async function PaginaProntoAtendimento({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (clinica.papel !== "paciente") notFound();

  const [fila, precos] = await Promise.all([
    chamarApi<EstadoDaFila>("/fila", { token, clinica: slug }),
    chamarApi<{ tipo: string; medicoId: string | null; valorCentavos: number }[]>("/precos", { token, clinica: slug }),
  ]);
  const preco = precos.ok ? precos.dados.find((p) => p.tipo === "pronto_atendimento" && p.medicoId === null) : undefined;

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Pronto atendimento</h1>
        <p className="text-tinta-suave">
          Sem agendamento: voce entra na fila e e atendido pelo proximo profissional disponivel.
        </p>
      </div>

      <ProntoAtendimento
        slug={slug}
        estado={fila.ok ? fila.dados : { totalAguardando: 0, medicosDePlantao: 0, minhaPosicao: null, minhaSituacao: null, esperaEstimadaMinutos: null }}
        valorCentavos={preco?.valorCentavos ?? null}
      />
    </div>
  );
}
