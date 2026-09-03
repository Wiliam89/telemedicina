import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PerfilResposta } from "@tele/shared";
import { chamarApi } from "@/lib/api";
import { tokenAtual, usuarioAtual } from "@/lib/supabase-servidor";
import { AceitarConvite } from "./AceitarConvite";

export const metadata: Metadata = { title: "Convite" };

/**
 * A pessoa clicou no link do convite. Tres caminhos:
 *   nao esta logada  -> entra (ou cria conta) e volta para ca
 *   sem perfil       -> completa o perfil e volta para ca
 *   pronta           -> ve o botao de aceitar
 *
 * O codigo viaja na URL, nunca em cookie ou estado: se a pessoa fechar e
 * reabrir o link, funciona igual.
 */
export default async function PaginaConvite({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;

  if (!(await usuarioAtual())) redirect(`/entrar?depois=${encodeURIComponent(`/convite/${codigo}`)}`);

  const token = await tokenAtual();
  const perfil = await chamarApi<PerfilResposta>("/perfis/eu", { token });
  if (!perfil.ok && perfil.status === 404) redirect(`/completar-perfil?depois=${encodeURIComponent(`/convite/${codigo}`)}`);

  return (
    <section className="max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Voce foi convidado(a)</h1>
        <p className="text-tinta-suave">Ao aceitar, voce passa a fazer parte da equipe desta clinica.</p>
      </div>
      <AceitarConvite codigo={codigo} />
    </section>
  );
}
