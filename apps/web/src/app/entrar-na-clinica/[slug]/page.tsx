import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PerfilResposta } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { chamarApi } from "@/lib/api";
import { tokenAtual, usuarioAtual } from "@/lib/supabase-servidor";
import { EntrarComoPaciente } from "./EntrarComoPaciente";

/**
 * A porta de entrada do paciente numa clinica.
 *
 * E o endereco que a clinica divulga: no site dela, num QR Code na
 * recepcao, num link de WhatsApp. Quem chega aqui vira paciente daquela
 * clinica - e so isso: medico e recepcao continuam entrando por convite.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await chamarApi<{ nomeFantasia: string }>(`/clinicas/${slug}/publico`);
  return { title: r.ok ? `Atendimento em ${r.dados.nomeFantasia}` : "Clinica" };
}

export default async function PaginaEntrarNaClinica({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publico = await chamarApi<{ slug: string; nomeFantasia: string; aceitandoPacientes: boolean }>(`/clinicas/${slug}/publico`);

  if (!publico.ok) {
    return (
      <section className="mx-auto max-w-md space-y-4">
        <h1 className="font-titulo text-3xl tracking-tight">Clinica nao encontrada</h1>
        <Aviso tipo="erro">Confira o endereco que voce recebeu.</Aviso>
      </section>
    );
  }

  const destino = `/entrar-na-clinica/${slug}`;
  if (!(await usuarioAtual())) redirect(`/entrar?depois=${encodeURIComponent(destino)}`);

  const perfil = await chamarApi<PerfilResposta>("/perfis/eu", { token: await tokenAtual() });
  if (!perfil.ok && perfil.status === 404) redirect(`/completar-perfil?depois=${encodeURIComponent(destino)}`);

  // Ja e paciente aqui? Entao segue direto para a clinica.
  if (perfil.ok && perfil.dados.clinicas.some((c) => c.slug === slug)) redirect(`/c/${slug}/inicio`);

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-tinta-suave">Atendimento</p>
        <h1 className="font-titulo text-3xl tracking-tight">{publico.dados.nomeFantasia}</h1>
      </div>

      {!publico.dados.aceitandoPacientes ? (
        <Aviso tipo="erro">Esta clinica nao esta aceitando novos pacientes no momento.</Aviso>
      ) : (
        <>
          <p className="text-tinta-suave">
            Ao entrar, voce passa a poder marcar consultas nesta clinica. Seus dados de cadastro sao seus e ja
            acompanham voce; o que muda e onde voce sera atendido.
          </p>
          <EntrarComoPaciente slug={slug} nome={publico.dados.nomeFantasia} />
        </>
      )}
    </section>
  );
}
