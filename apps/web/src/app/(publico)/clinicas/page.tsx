import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ClinicaResumo, PerfilResposta, PlataformaPublica } from "@tele/shared";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { Aviso } from "@/componentes/Aviso";
import { LinkBotao } from "@/componentes/Botao";
import { Folha } from "@/componentes/Folha";
import { chamarApi } from "@/lib/api";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { tokenAtual } from "@/lib/supabase-servidor";

export const metadata: Metadata = { title: "Entrando" };

/**
 * A porta de entrada de quem esta logado.
 *
 * PLATAFORMA UNICA (ADR-0022): a plataforma e a propria clinica. Ninguem
 * escolhe, cria ou e convidado para clinica nenhuma para ser atendido - esta
 * pagina so leva a pessoa para dentro. Quem ainda nao e paciente (conta
 * antiga) passa a ser, aqui mesmo.
 *
 * VARIAS CLINICAS (modo antigo): a encruzilhada de escolher onde entrar.
 */
export default async function PaginaClinicas() {
  const token = await tokenAtual();
  const r = await chamarApi<PerfilResposta>("/perfis/eu", { token });
  if (!r.ok && r.status === 404) redirect("/completar-perfil");
  if (!r.ok)
    return (
      <Folha Icone={Building2} titulo="Não foi possível carregar">
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      </Folha>
    );

  if ((r.dados.consentimentosPendentes ?? []).length > 0) redirect("/aceitar-termos?depois=/clinicas");
  const { clinicas } = r.dados;

  const plataforma = await chamarApi<PlataformaPublica>("/plataforma");
  if (plataforma.ok && plataforma.dados.unica) {
    const { slug, configurada } = plataforma.dados;
    // Ainda sem a clinica da plataforma: so a administracao consegue cria-la.
    if (!configurada) redirect("/clinicas/nova");

    let dentro = clinicas.some((c) => c.slug === slug);
    if (!dentro) {
      const entrada = await chamarApi<ClinicaResumo>("/plataforma/entrar", { metodo: "POST", token });
      if (!entrada.ok) {
        return (
          <Folha Icone={Building2} titulo="Quase lá">
            <div className="space-y-4">
              <Aviso tipo="erro">{entrada.erro.mensagem}</Aviso>
              {entrada.erro.codigo === "DADOS_DE_PACIENTE_NECESSARIOS" ? <LinkBotao href="/conta">Abrir Minha conta</LinkBotao> : null}
            </div>
          </Folha>
        );
      }
      dentro = true;
    }
    // Medico que acabou de se cadastrar: o proximo passo dele e o credenciamento.
    const atende = clinicas.find((c) => c.slug === slug)?.papeis?.includes("medico");
    if (r.dados.medico && !atende && !r.dados.credenciamento) redirect(`/c/${slug}/credenciamento`);
    redirect(`/c/${slug}/inicio`);
  }

  if (clinicas.length === 1) redirect(`/c/${clinicas[0]!.slug}/inicio`);

  return (
    <Folha
      Icone={Building2}
      largura="lg"
      semCartao
      titulo={clinicas.length === 0 ? "Você ainda não está em nenhuma clínica" : "Onde você quer entrar?"}
      descricao={
        clinicas.length === 0
          ? "Peça um convite à administração da clínica onde você atende, use o link de entrada que a clínica divulga ou abra a sua."
          : "Você tem acesso a mais de uma. Cada uma tem sua própria agenda e seus próprios registros."
      }
    >
      <div className="space-y-5">
        {clinicas.length > 0 ? (
          <ul className="overflow-hidden rounded-2xl border border-linha bg-superficie shadow-cartao">
            {clinicas.map((c) => (
              <li key={c.id} className="border-b border-linha last:border-b-0">
                <Link href={`/c/${c.slug}/inicio`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-superficie-alt">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-marinho font-titulo font-semibold text-white">
                    {c.nomeFantasia.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.nomeFantasia}</span>
                    <span className="block text-sm text-tinta-suave">{NOME_DO_PAPEL[c.papel]}</span>
                  </span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4 text-tinta-suave transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-linha-forte bg-superficie-alt p-5">
          <div>
            <h2 className="text-base">Abrir uma clínica</h2>
            <p className="mt-1 text-sm text-tinta-suave">Você será a administração dela e poderá convidar a equipe.</p>
          </div>
          <LinkBotao href="/clinicas/nova" icone={<Plus className="h-4 w-4" aria-hidden="true" />}>
            Criar clínica
          </LinkBotao>
        </div>
      </div>
    </Folha>
  );
}
