import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeDollarSign, PiggyBank, RotateCcw, Wallet } from "lucide-react";
import type { Financeiro } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { CabecalhoDaPagina, Cartao, Etiqueta, Indicador } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta } from "@/lib/datas";
import { emReais } from "@/lib/dinheiro";
import { temPapel } from "@/lib/papeis";
import { CancelarRepasse, Reembolsar, RegistrarRepasse } from "./AcoesFinanceiras";

export const metadata: Metadata = { title: "Financeiro" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O FINANCEIRO (ADR-0026): quanto entrou no periodo, quanto disso e dos
 * medicos, quanto falta pagar a cada um (desde sempre) e os reembolsos que
 * esperam decisao.
 */
export default async function PaginaFinanceiro({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ de?: string; ate?: string }> }) {
  const { clinica: slug } = await params;
  const { de, ate } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();

  const q = new URLSearchParams({ ...(de && DATA.test(de) ? { de } : {}), ...(ate && DATA.test(ate) ? { ate } : {}) });
  const r = await chamarApi<Financeiro>(`/admin/financeiro?${q}`, { token, clinica: slug });
  const fuso = clinica.fusoHorario;

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina sobretitulo="Administração" titulo="Financeiro" descricao="Receita da plataforma, ganho de cada médico e reembolsos. Valores só de consultas concluídas e pagamentos confirmados." />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <label htmlFor="de" className="block text-sm font-medium">De</label>
          <input id="de" name="de" type="date" defaultValue={r.ok ? r.dados.periodo.de : de} className={`${CLASSE_CONTROLE} border-linha`} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ate" className="block text-sm font-medium">Até</label>
          <input id="ate" name="ate" type="date" defaultValue={r.ok ? r.dados.periodo.ate : ate} className={`${CLASSE_CONTROLE} border-linha`} />
        </div>
        <Botao type="submit" variante="secundario">Ver período</Botao>
      </form>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador Icone={BadgeDollarSign} rotulo="Recebido no período" valor={emReais(r.dados.receitaBrutaCentavos)} />
            <Indicador Icone={Wallet} tom="info" rotulo="Ganho dos médicos" valor={emReais(r.dados.repasseDoPeriodoCentavos)} detalhe="das consultas do período" />
            <Indicador Icone={PiggyBank} tom="selo" rotulo="Fica com a plataforma (estimativa)" valor={emReais(r.dados.margemCentavos)} detalhe="recebido no período menos o ganho dos médicos pelas consultas do período, antes das taxas" />
            <Indicador Icone={RotateCcw} tom="alerta" rotulo="Devolvido (reembolsos)" valor={emReais(r.dados.estornadoCentavos)} />
          </div>

          <Cartao titulo="Repasse aos médicos" descricao="“A receber” é o saldo de sempre: tudo o que o médico ganhou menos o que já foi registrado como pago." semPadding>
            {r.dados.porMedico.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Nenhuma consulta paga no período, e nenhum saldo em aberto.</p>
            ) : (
              <ul className="divide-y divide-linha">
                {r.dados.porMedico.map((m) => (
                  <li key={m.medicoId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{m.medicoNome}</p>
                      <p className="text-sm text-tinta-suave">
                        {m.consultas} consulta(s) no período · faturado {emReais(m.faturadoCentavos)} · ganho {emReais(m.repasseCentavos)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-tinta-suave">A receber</p>
                      <p className={"font-titulo text-lg " + (m.saldoCentavos > 0 ? "text-espera" : "")}>{emReais(m.saldoCentavos)}</p>
                    </div>
                    <RegistrarRepasse slug={slug} medicoId={m.medicoId} medicoNome={m.medicoNome} saldoCentavos={m.saldoCentavos} />
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Pagamentos registrados no período" semPadding>
            {r.dados.repasses.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Nenhum pagamento a médico registrado no período.</p>
            ) : (
              <ul className="divide-y divide-linha">
                {r.dados.repasses.map((p) => (
                  <li key={p.id} className={"flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 " + (p.cancelado ? "opacity-60" : "")}>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className={p.cancelado ? "line-through" : ""}>
                        <strong>{emReais(p.valorCentavos)}</strong> para {p.medicoNome} em {dataCurta(p.pagoEm, fuso)} · {p.referencia}
                      </p>
                      <p className="text-xs text-tinta-suave">
                        Registrado por {p.registradoPor}
                        {p.observacao ? ` · ${p.observacao}` : ""}
                        {p.cancelado ? ` · cancelado por ${p.cancelado.por}: ${p.cancelado.motivo}` : ""}
                      </p>
                    </div>
                    {p.cancelado ? <Etiqueta tom="alerta">cancelado</Etiqueta> : <CancelarRepasse slug={slug} repasseId={p.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <section id="recusadas"><Cartao titulo="Cobranças recusadas no cartão do paciente" descricao="O paciente já foi avisado e não marca nova consulta até pagar por Pix. Se precisar, entre em contato com ele." semPadding>
            {r.dados.cobrancasRecusadas.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Nenhuma cobrança recusada em aberto.</p>
            ) : (
              <ul className="divide-y divide-linha">
                {r.dados.cobrancasRecusadas.map((c) => (
                  <li key={c.consultaId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                    <span>
                      <strong>{emReais(c.valorCentavos)}</strong> · {c.pacienteNome} · consulta de {dataCurta(c.realizadaEm, fuso)}
                    </span>
                    <Etiqueta tom="espera">aguardando o paciente</Etiqueta>
                  </li>
                ))}
              </ul>
            )}
          </Cartao></section>

          <section id="reembolsos">
            <Cartao titulo="Reembolsos a decidir" descricao="Pagamentos recebidos de atendimentos que não aconteceram (consulta cancelada, desistência da fila, pagamento fora do prazo)." semPadding>
              {r.dados.reembolsosPendentes.length === 0 ? (
                <p className="p-5 text-sm text-tinta-suave">Nenhum reembolso pendente.</p>
              ) : (
                <ul className="divide-y divide-linha">
                  {r.dados.reembolsosPendentes.map((p) => (
                    <li key={p.pagamentoId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <strong>{emReais(p.valorCentavos)}</strong> de {p.pacienteNome} ({p.metodo === "pix" ? "Pix" : "cartão"})
                        </p>
                        <p className="text-xs text-tinta-suave">
                          {p.motivo || "sem motivo registrado"} · desde {dataCurta(p.desde, fuso)}
                        </p>
                      </div>
                      <Reembolsar slug={slug} pagamentoId={p.pagamentoId} valorCentavos={p.valorCentavos} />
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          </section>
        </>
      )}
    </div>
  );
}
