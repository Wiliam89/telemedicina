import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { Folha } from "@/componentes/Folha";
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
    <Folha
      Icone={UserRound}
      largura="lg"
      sobretitulo="Passo 2 de 2"
      titulo="Seus dados"
      descricao="Estes dados são seus, não de uma clínica: eles acompanham você em todas onde atuar."
    >
      <FormularioPerfil destino={destino} />
    </Folha>
  );
}
