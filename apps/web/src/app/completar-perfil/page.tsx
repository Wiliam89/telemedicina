import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PerfilResposta } from "@tele/shared";
import { chamarApi } from "@/lib/api";
import { tokenAtual } from "@/lib/supabase-servidor";
import { FormularioPerfil } from "./FormularioPerfil";

export const metadata: Metadata = { title: "Completar perfil" };

/**
 * O perfil e da PESSOA: nome, CPF, e - se for medico(a) - o CRM, que
 * acompanha quem o tem para qualquer clinica. Onde a pessoa vai atuar
 * e decidido depois, criando uma clinica ou aceitando um convite.
 */
export default async function PaginaCompletarPerfil({ searchParams }: { searchParams: Promise<{ depois?: string }> }) {
  const { depois } = await searchParams;
  const destino = depois && depois.startsWith("/") ? depois : "/clinicas";

  const token = await tokenAtual();
  const r = await chamarApi<PerfilResposta>("/perfis/eu", { token });
  if (r.ok) redirect(destino);

  return (
    <section className="max-w-lg space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Seus dados</h1>
        <p className="text-tinta-suave">
          Estes dados sao seus, nao de uma clinica: eles acompanham voce em todas onde atuar.
        </p>
      </div>
      <FormularioPerfil destino={destino} />
    </section>
  );
}
