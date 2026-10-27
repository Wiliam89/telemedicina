import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { PerfilResposta } from "@tele/shared";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { Aviso } from "@/componentes/Aviso";
import { LinkBotao } from "@/componentes/Botao";
import { Folha } from "@/componentes/Folha";
import { chamarApi } from "@/lib/api";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { tokenAtual } from "@/lib/supabase-servidor";

export const metadata: Metadata = { title: "Minhas clínicas" };

/**
 * A encruzilhada do sistema multi-clinica: escolher onde entrar.
 * Com uma clinica so, nao faz a pessoa clicar - vai direto.
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
