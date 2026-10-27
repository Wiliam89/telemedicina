import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SolicitacaoResumo } from "@tele/shared";
import { TIPOS_DE_SOLICITACAO } from "@tele/shared/lgpd";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Etiqueta, Indicador, Vazio, type Tom } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { ResponderPedido } from "./ResponderPedido";

export const metadata: Metadata = { title: "Pedidos LGPD" };

const STATUS: Record<SolicitacaoResumo["status"], { rotulo: string; tom: Tom }> = {
  aberta: { rotulo: "Aberta", tom: "info" },
  em_andamento: { rotulo: "Em andamento", tom: "espera" },
  concluida: { rotulo: "Concluída", tom: "selo" },
  negada: { rotulo: "Negada", tom: "alerta" },
};

/**
 * A clinica e a CONTROLADORA dos dados dos seus pacientes (ADR-0018): os
 * pedidos do art. 18 dirigidos a ela chegam aqui, com o prazo de 15 dias
 * em destaque.
 */
export default async function PaginaPedidosLgpd({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();

  const r = await chamarApi<SolicitacaoResumo[]>("/lgpd/solicitacoes-da-clinica", { token, clinica: slug });
  const lista = r.ok ? r.dados : [];
  const abertas = lista.filter((s) => s.status === "aberta" || s.status === "em_andamento");
  const vencidas = abertas.filter((s) => new Date(s.prazo).getTime() < Date.now());

  return (
    <div className="space-y-6">
      <CabecalhoDaPagina
        titulo="Pedidos de titulares (LGPD)"
        descricao="Pedidos de acesso, correção, exclusão e portabilidade dos pacientes desta clínica. A lei dá 15 dias para a resposta completa (art. 19). O prontuário não se exclui: ele é guardado por 20 anos (Lei 13.787/2018)."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador Icone={Inbox} rotulo="Em aberto" valor={abertas.length} />
        <Indicador Icone={Inbox} tom="alerta" rotulo="Prazo vencido" valor={vencidas.length} />
        <Indicador Icone={Inbox} tom="neutro" rotulo="Total" valor={lista.length} />
      </div>
      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : lista.length === 0 ? (
        <Vazio Icone={Inbox} titulo="Nenhum pedido recebido">
          Os pacientes fazem pedidos em Minha conta.
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {lista.map((s) => {
            const aberta = s.status === "aberta" || s.status === "em_andamento";
            const vencido = aberta && new Date(s.prazo).getTime() < Date.now();
            return (
              <li key={s.id} className="space-y-2 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{TIPOS_DE_SOLICITACAO[s.tipo]}</p>
                  <Etiqueta tom={STATUS[s.status].tom}>{STATUS[s.status].rotulo}</Etiqueta>
                  {vencido ? <Etiqueta tom="alerta">Prazo vencido</Etiqueta> : null}
                </div>
                <p className="text-sm text-tinta-suave">
                  {s.titular?.nomeCompleto} · aberto em {new Date(s.criadoEm).toLocaleDateString("pt-BR")} · prazo{" "}
                  {new Date(s.prazo).toLocaleDateString("pt-BR")}
                </p>
                <p className="text-sm">{s.descricao}</p>
                {s.resposta ? <p className="rounded-lg bg-selo-suave px-3 py-2 text-sm text-selo-forte">Resposta: {s.resposta}</p> : null}
                {aberta ? <ResponderPedido slug={slug} id={s.id} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
