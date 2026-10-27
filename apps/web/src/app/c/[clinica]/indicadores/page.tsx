import { CalendarCheck2, CircleDollarSign, FileCheck2, Siren, UserPlus, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Indicadores } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { GraficoDeBarras } from "@/componentes/GraficoDeBarras";
import { CabecalhoDaPagina, Cartao, Indicador, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Indicadores" };

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const PERIODOS = [7, 30, 90];

/**
 * O PAINEL DA ADMINISTRACAO (ADR-0019): movimento, receita, pronto
 * atendimento e documentos no periodo. So numeros - nenhum dado clinico.
 */
export default async function PaginaIndicadores({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ dias?: string }> }) {
  const { clinica: slug } = await params;
  const { dias: diasTexto } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const dias = PERIODOS.includes(Number(diasTexto)) ? Number(diasTexto) : 30;

  const r = await chamarApi<Indicadores>(`/indicadores?dias=${dias}`, { token, clinica: slug });

  return (
    <div className="space-y-6">
      <CabecalhoDaPagina
        titulo="Indicadores"
        descricao={`Movimento de ${clinica.nomeFantasia} nos últimos ${dias} dias, no fuso horário da clínica.`}
        acoes={
          <nav aria-label="Período" className="flex rounded-lg border border-linha bg-superficie p-1 shadow-cartao">
            {PERIODOS.map((p) => (
              <Link
                key={p}
                href={`/c/${slug}/indicadores?dias=${p}`}
                aria-current={p === dias ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${p === dias ? "bg-selo text-white" : "text-tinta-suave hover:text-tinta"}`}
              >
                {p} dias
              </Link>
            ))}
          </nav>
        }
      />

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Indicador Icone={CalendarCheck2} rotulo="Consultas concluídas" valor={r.dados.consultas.concluidas} detalhe={`${r.dados.consultas.agendadas} agendada(s) ou em andamento`} />
            <Indicador Icone={XCircle} tom="alerta" rotulo="Taxa de cancelamento" valor={pct(r.dados.consultas.taxaCancelamento)} detalhe={`${r.dados.consultas.canceladas} cancelada(s)`} />
            <Indicador Icone={CircleDollarSign} tom="info" rotulo="Receita confirmada" valor={reais(r.dados.receita.brutaCentavos)} detalhe={`${r.dados.receita.pagamentos} pagamento(s) · ticket médio ${reais(r.dados.receita.ticketMedioCentavos)} · líquido clínica ${reais(r.dados.receita.clinicaCentavos)}`} />
            <Indicador Icone={UserPlus} tom="neutro" rotulo="Pacientes" valor={r.dados.pacientes.atendidos} detalhe={`atendidos · ${r.dados.pacientes.novos} novo(s) cadastro(s)`} />
            <Indicador
              Icone={Siren}
              tom="espera"
              rotulo="Pronto atendimento"
              valor={r.dados.prontoAtendimento.atendidos}
              detalhe={`atendidos · espera média ${r.dados.prontoAtendimento.esperaMediaMinutos ?? "—"} min · ${r.dados.prontoAtendimento.desistencias} desistência(s)`}
            />
            <Indicador Icone={FileCheck2} rotulo="Documentos assinados" valor={pct(r.dados.documentos.taxaAssinatura)} detalhe={`${r.dados.documentos.assinados} de ${r.dados.documentos.emitidos} emitidos`} />
          </div>

          <Cartao titulo="Consultas por dia" descricao="Consultas não canceladas, por dia da consulta.">
            {r.dados.consultas.porDia.length === 0 ? (
              <Vazio Icone={CalendarCheck2} titulo="Nenhuma consulta no período" />
            ) : (
              <GraficoDeBarras
                titulo="Consultas por dia"
                dados={r.dados.consultas.porDia.map((d) => ({
                  rotulo: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`,
                  detalhe: new Date(`${d.dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }),
                  valor: d.total,
                }))}
                unidade="consulta(s)"
              />
            )}
          </Cartao>

          <Cartao titulo="Por médico" semPadding>
            {r.dados.consultas.porMedico.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Sem consultas no período.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Consultas por médico no período</caption>
                <thead className="bg-superficie-alt text-left text-xs uppercase tracking-wide text-tinta-suave">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Médico</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Consultas</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Concluídas</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Canceladas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {r.dados.consultas.porMedico.map((m) => (
                    <tr key={m.medico}>
                      <td className="px-5 py-3 font-medium">{m.medico}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{m.total}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{m.concluidas}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{m.canceladas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}
