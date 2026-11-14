import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdCard } from "lucide-react";
import type { CredenciamentoParaAnalise } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { AnaliseDoPedido } from "./AnaliseDoPedido";

export const metadata: Metadata = { title: "Credenciamentos" };

const FILTROS = [
  { valor: "em_analise", rotulo: "Em análise" },
  { valor: "pendente_de_ajuste", rotulo: "Aguardando ajuste" },
  { valor: "aprovado", rotulo: "Aprovados" },
  { valor: "recusado", rotulo: "Recusados" },
] as const;

/**
 * Os pedidos dos medicos que querem atender pela plataforma (ADR-0022). E
 * aqui que a administracao confere documentos, identidade e CRM - e so aqui
 * nasce o acesso de medico.
 */
export default async function PaginaCredenciamentos({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ status?: string }> }) {
  const { clinica: slug } = await params;
  const { status: pedido } = await searchParams;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();

  const status = FILTROS.find((f) => f.valor === pedido)?.valor ?? "em_analise";
  const r = await chamarApi<CredenciamentoParaAnalise[]>(`/credenciamentos?status=${status}`, { token, clinica: slug });

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        titulo="Credenciamentos"
        descricao="Médicos que pediram para atender. Confira os documentos, a identidade (selfie ao lado do documento) e o CRM antes de aprovar."
      />
      <nav aria-label="Filtrar pedidos" className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.valor}
            href={`/c/${slug}/credenciamentos?status=${f.valor}`}
            aria-current={f.valor === status ? "page" : undefined}
            className={"rounded-full px-3.5 py-1.5 text-sm ring-1 ring-inset " + (f.valor === status ? "bg-selo-suave font-medium text-selo-forte ring-selo/30" : "bg-superficie text-tinta-suave ring-linha hover:text-tinta")}
          >
            {f.rotulo}
          </Link>
        ))}
      </nav>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : r.dados.length === 0 ? (
        <Vazio Icone={IdCard} titulo="Nenhum pedido aqui">
          {status === "em_analise" ? "Quando um médico enviar os documentos, o pedido aparece nesta lista e você recebe um aviso no sino." : null}
        </Vazio>
      ) : (
        <div className="space-y-6">
          {r.dados.map((p) => (
            <AnaliseDoPedido key={`${p.id}:${p.status}:${p.identidade?.id ?? ""}`} slug={slug} pedido={p} meuId={perfil.id} />
          ))}
        </div>
      )}
    </div>
  );
}
