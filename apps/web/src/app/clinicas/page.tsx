import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { PerfilResposta } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { chamarApi } from "@/lib/api";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { tokenAtual } from "@/lib/supabase-servidor";

export const metadata: Metadata = { title: "Minhas clinicas" };

/**
 * A encruzilhada do sistema multi-clinica: escolher onde entrar.
 * Com uma clinica so, nao faz a pessoa clicar - vai direto.
 */
export default async function PaginaClinicas() {
  const token = await tokenAtual();
  const r = await chamarApi<PerfilResposta>("/perfis/eu", { token });
  if (!r.ok && r.status === 404) redirect("/completar-perfil");
  if (!r.ok) return <Aviso tipo="erro">{r.erro.mensagem}</Aviso>;

  const { clinicas } = r.dados;
  if (clinicas.length === 1) redirect(`/c/${clinicas[0]!.slug}/inicio`);

  return (
    <section className="max-w-lg space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">{clinicas.length === 0 ? "Voce ainda nao esta em nenhuma clinica" : "Onde voce quer entrar?"}</h1>
        <p className="text-tinta-suave">
          {clinicas.length === 0
            ? "Peca um convite a administracao da clinica onde voce atende, ou abra a sua."
            : "Voce tem acesso a mais de uma. Cada uma tem sua propria agenda e seus proprios registros."}
        </p>
      </div>

      {clinicas.length > 0 ? (
        <ul className="divide-y divide-linha overflow-hidden rounded-lg border border-linha bg-superficie">
          {clinicas.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}/inicio`} className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-selo-suave">
                <span>
                  <span className="block font-medium">{c.nomeFantasia}</span>
                  <span className="block text-sm text-tinta-suave">{NOME_DO_PAPEL[c.papel]}</span>
                </span>
                <span aria-hidden="true" className="text-tinta-suave">&rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-lg border border-linha bg-superficie p-4">
        <h2 className="font-medium">Abrir uma clinica</h2>
        <p className="mt-1 text-sm text-tinta-suave">Voce sera a administracao dela e podera convidar a equipe.</p>
        <Link href="/clinicas/nova" className="mt-3 inline-block rounded-md bg-selo px-4 py-2 text-sm font-medium text-white hover:bg-selo/90">
          Criar clinica
        </Link>
      </div>
    </section>
  );
}
