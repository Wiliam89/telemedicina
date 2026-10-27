import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProntuarioDoPaciente, type Aba } from "@/componentes/prontuario/ProntuarioDoPaciente";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { contextoDaClinica } from "@/lib/clinica";

export const metadata: Metadata = { title: "Minha saúde" };

/**
 * O prontuario visto pelo proprio paciente: ficha, sinais vitais (pode
 * informar o que mediu em casa), exames (pode enviar) e a linha do tempo.
 * Ter acesso ao proprio prontuario e direito do paciente (Codigo de Etica
 * Medica, art. 88; LGPD, art. 18).
 */
export default async function PaginaMinhaSaude({
  params,
  searchParams,
}: {
  params: Promise<{ clinica: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const { clinica: slug } = await params;
  const { aba } = await searchParams;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (clinica.papel !== "paciente") notFound();

  return (
    <div className="space-y-6">
      <CabecalhoDaPagina titulo="Minha saúde" descricao={`Seu prontuário em ${clinica.nomeFantasia}. Você pode enviar exames e registrar medidas feitas em casa.`} />
      <ProntuarioDoPaciente slug={slug} token={token} pacienteId={perfil.id} aba={(aba as Aba) ?? "resumo"} base={`/c/${slug}/minha-saude`} souMedico={false} />
    </div>
  );
}
