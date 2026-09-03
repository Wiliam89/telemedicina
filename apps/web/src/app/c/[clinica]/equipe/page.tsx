import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConviteResumo, MembroResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { PainelConvites } from "./PainelConvites";

export const metadata: Metadata = { title: "Equipe" };

export default async function PaginaEquipe({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  // Quem nao administra nao ve que esta tela existe.
  if (clinica.papel !== "admin_clinica") notFound();

  const [membros, convites] = await Promise.all([
    chamarApi<MembroResumo[]>("/membros", { token, clinica: slug }),
    chamarApi<ConviteResumo[]>("/convites", { token, clinica: slug }),
  ]);

  return (
    <div className="space-y-10">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />

      <section className="space-y-3">
        <h1 className="font-titulo text-3xl tracking-tight">Equipe</h1>
        {!membros.ok ? (
          <Aviso tipo="erro">{membros.erro.mensagem}</Aviso>
        ) : (
          <ul className="divide-y divide-linha overflow-hidden rounded-lg border border-linha bg-superficie">
            {membros.dados.map((m) => (
              <li key={m.vinculoId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium">{m.nomeCompleto}</p>
                  <p className="text-sm text-tinta-suave">
                    {m.papeis.map((p) => NOME_DO_PAPEL[p]).join(", ")} · desde {new Date(m.desde).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                {m.status !== "ativo" ? <span className="text-sm text-alerta">{m.status}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PainelConvites slug={slug} pendentes={convites.ok ? convites.dados : []} />
    </div>
  );
}
