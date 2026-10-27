import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MedicoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { MarcarConsulta } from "./MarcarConsulta";

export const metadata: Metadata = { title: "Marcar consulta" };

/**
 * Marcar consulta. O paciente marca para si; a recepcao marca em nome de
 * alguem (a API confere quem pode o que).
 */
export default async function PaginaMarcar({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "paciente", "recepcao", "admin_clinica")) notFound();

  const todos = await chamarApi<MedicoResumo[]>("/medicos", { token, clinica: slug });
  // So quem teve o CRM conferido recebe marcacao (ADR-0016).
  const medicos = todos.ok ? { ...todos, dados: todos.dados.filter((m) => m.situacaoCrm === "verificado") } : todos;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl text-tinta sm:text-[1.75rem]">Marcar consulta</h1>
        <p className="text-tinta-suave">Escolha o profissional, o dia e o horario. Horarios em hora local de {clinica.nomeFantasia}.</p>
      </div>

      {!medicos.ok ? (
        <Aviso tipo="erro">{medicos.erro.mensagem}</Aviso>
      ) : medicos.dados.length === 0 ? (
        <Aviso>Nenhum médico atende nesta clínica ainda.</Aviso>
      ) : (
        <MarcarConsulta slug={slug} fuso={clinica.fusoHorario} medicos={medicos.dados} />
      )}
    </div>
  );
}
