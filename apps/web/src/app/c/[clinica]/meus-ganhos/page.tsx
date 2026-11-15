import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarCheck2, HandCoins, Percent, Wallet } from "lucide-react";
import type { MeusGanhos } from "@tele/shared";
import { formatarPercentual } from "@tele/shared/admin";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Cartao, Etiqueta, Indicador } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta } from "@/lib/datas";
import { emReais } from "@/lib/dinheiro";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Meus ganhos" };

/** O medico ve quanto ganhou, quanto ja recebeu e quanto falta receber (ADR-0026). */
export default async function PaginaMeusGanhos({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "medico")) notFound();
  const r = await chamarApi<MeusGanhos>("/meus-ganhos", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina titulo="Meus ganhos" descricao="Quanto você ganhou com as consultas realizadas e quanto a plataforma já transferiu para você." />
      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador Icone={Percent} rotulo="Sua porcentagem hoje" valor={formatarPercentual(r.dados.percentualEmVigorBps)} detalhe="de cada consulta paga" />
            <Indicador Icone={CalendarCheck2} tom="info" rotulo="Este mês" valor={emReais(r.dados.doMes.repasseCentavos)} detalhe={`${r.dados.doMes.consultas} consulta(s) paga(s)`} />
            <Indicador Icone={HandCoins} tom="neutro" rotulo="Já recebido" valor={emReais(r.dados.pagoCentavos)} detalhe={`de ${emReais(r.dados.ganhoTotalCentavos)} ganhos no total`} />
            {r.dados.saldoCentavos >= 0 ? (
              <Indicador Icone={Wallet} tom="espera" rotulo="A receber" valor={emReais(r.dados.saldoCentavos)} />
            ) : (
              // Reembolso de consulta ja repassada: o valor e descontado dos proximos ganhos.
              <Indicador Icone={Wallet} tom="alerta" rotulo="A descontar" valor={emReais(-r.dados.saldoCentavos)} detalhe="de consulta reembolsada; sai dos próximos ganhos" />
            )}
          </div>
          <Aviso>
            Só entram consultas <strong>concluídas e pagas</strong>. Consulta cancelada, reembolsada ou ainda não cobrada não gera ganho. A porcentagem de cada consulta é a do dia em que ela foi marcada.
          </Aviso>
          <Cartao titulo="Pagamentos recebidos" semPadding>
            {r.dados.repasses.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Nenhuma transferência registrada ainda.</p>
            ) : (
              <ul className="divide-y divide-linha">
                {r.dados.repasses.map((p) => (
                  <li key={p.id} className={"flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm " + (p.cancelado ? "opacity-60" : "")}>
                    <span className={p.cancelado ? "line-through" : ""}>
                      <strong>{emReais(p.valorCentavos)}</strong> em {dataCurta(p.pagoEm, clinica.fusoHorario)} · {p.referencia}
                    </span>
                    {p.cancelado ? <Etiqueta tom="alerta">registro cancelado</Etiqueta> : null}
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}
