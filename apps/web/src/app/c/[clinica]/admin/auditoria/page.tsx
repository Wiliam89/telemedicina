import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { EventoDeAuditoria } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Cartao } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Auditoria" };

const GRUPOS = [
  { valor: "todos", rotulo: "Tudo" },
  { valor: "financeiro", rotulo: "Financeiro" },
  { valor: "medicos", rotulo: "Médicos" },
  { valor: "equipe", rotulo: "Equipe" },
  { valor: "configuracoes", rotulo: "Configurações" },
  { valor: "prontuario", rotulo: "Prontuário" },
  { valor: "lgpd", rotulo: "Dados pessoais" },
] as const;

/**
 * A trilha de auditoria (ADR-0005): cada acao importante fica registrada,
 * para sempre, e ninguem consegue apagar. Aqui a administracao ve QUEM fez O
 * QUE e QUANDO - sem o conteudo (nada de dado clinico).
 */
export default async function PaginaAuditoria({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ grupo?: string; antesDe?: string }> }) {
  const { clinica: slug } = await params;
  const { grupo: pedido, antesDe } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();

  const grupo = GRUPOS.find((g) => g.valor === pedido)?.valor ?? "todos";
  const q = new URLSearchParams({ grupo, ...(antesDe && !Number.isNaN(Date.parse(antesDe)) ? { antesDe } : {}) });
  const r = await chamarApi<{ eventos: EventoDeAuditoria[]; temMais: boolean }>(`/admin/auditoria?${q}`, { token, clinica: slug });
  const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: clinica.fusoHorario, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina sobretitulo="Administração" titulo="Auditoria" descricao="Quem fez o quê, e quando. Estes registros não podem ser alterados nem apagados por ninguém." />
      <nav aria-label="Filtrar por assunto" className="flex flex-wrap gap-2">
        {GRUPOS.map((g) => (
          <Link
            key={g.valor}
            href={`/c/${slug}/admin/auditoria?grupo=${g.valor}`}
            aria-current={g.valor === grupo ? "page" : undefined}
            className={"rounded-full px-3.5 py-1.5 text-sm ring-1 ring-inset " + (g.valor === grupo ? "bg-selo-suave font-medium text-selo-forte ring-selo/30" : "bg-superficie text-tinta-suave ring-linha hover:text-tinta")}
          >
            {g.rotulo}
          </Link>
        ))}
      </nav>
      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : r.dados.eventos.length === 0 ? (
        <Aviso>Nenhum registro neste assunto.</Aviso>
      ) : (
        <Cartao semPadding>
          <ul className="divide-y divide-linha">
            {r.dados.eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{e.descricao}</span>
                  <span className="text-tinta-suave"> · {e.quem ?? "pessoa removida"}</span>
                </span>
                <time dateTime={e.quando} className="font-mono text-xs text-tinta-suave">
                  {quando(e.quando)}
                </time>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
      {r.ok && r.dados.temMais ? (
        <Link href={`/c/${slug}/admin/auditoria?grupo=${grupo}&antesDe=${encodeURIComponent(r.dados.eventos.at(-1)!.quando)}`} className="inline-block text-sm text-selo underline underline-offset-4">
          Ver registros mais antigos
        </Link>
      ) : null}
    </div>
  );
}
