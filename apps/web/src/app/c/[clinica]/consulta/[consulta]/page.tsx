import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ConsultaResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { SalaDeVideo } from "@/componentes/SalaDeVideo";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta, hora } from "@/lib/datas";

export const metadata: Metadata = { title: "Minha consulta" };

/**
 * A SALA DO PACIENTE.
 *
 * Do lado do medico o video fica junto do prontuario, porque ele escreve
 * enquanto conversa. Do lado do paciente nao ha nada para escrever - so a
 * conversa. Por isso esta tela tem uma coisa so, grande, no meio: a sala.
 *
 * O medico tem a tela dele em /atendimento/<id>; esta e a do paciente. Nao
 * sao a mesma tela com um `if`, porque o que cada um faz na consulta e
 * diferente.
 */
export default async function PaginaDaConsulta({
  params,
}: {
  params: Promise<{ clinica: string; consulta: string }>;
}) {
  const { clinica: slug, consulta: consultaId } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);

  // Janela larga: a consulta pode ser de hoje (plantao) ou de semanas atras.
  const hoje = new Date();
  const de = new Date(hoje.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(hoje.getTime() + 60 * 86400000).toISOString().slice(0, 10);

  const agenda = await chamarApi<ConsultaResumo[]>(`/consultas?de=${de}&ate=${ate}`, { token, clinica: slug });
  const consulta = agenda.ok ? agenda.dados.find((c) => c.id === consultaId) : undefined;

  /**
   * `notFound()` e nao uma mensagem de erro: quem nao e desta consulta nao
   * deve nem saber que ela existe. A API responderia 403 de todo jeito - mas
   * a tela nao precisa dar o primeiro passo.
   *
   * A partir do Modulo 12 a API ja devolve so as consultas de quem pergunta,
   * entao esta busca nao enxerga a consulta de outra pessoa.
   */
  if (!consulta) notFound();
  if (consulta.paciente.id !== perfil.id) notFound();

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-tinta-suave">Minha consulta</p>
        <h1 className="font-titulo text-3xl tracking-tight">
          {dataCurta(consulta.inicio, clinica.fusoHorario)} as {hora(consulta.inicio, clinica.fusoHorario)}
        </h1>
        <p className="text-tinta-suave">
          Com o medico CRM {consulta.medico.crm}-{consulta.medico.crmUf}
          {consulta.motivo ? ` · ${consulta.motivo}` : ""}
        </p>
      </header>

      {consulta.status === "aguardando_pagamento" ? (
        <Aviso tipo="info">
          Esta consulta ainda esta aguardando o pagamento. A sala abre depois que o pagamento for confirmado.{" "}
          <Link href={`/c/${slug}/pagamento/${consultaId}`} className="underline">
            Pagar agora
          </Link>
        </Aviso>
      ) : consulta.status === "cancelada" ? (
        <Aviso tipo="erro">Esta consulta foi cancelada.</Aviso>
      ) : consulta.status === "concluida" ? (
        <div className="space-y-4">
          <Aviso tipo="ok">Este atendimento foi encerrado.</Aviso>
          <p className="text-sm text-tinta-suave">
            Receitas, atestados e pedidos de exame emitidos nesta consulta ficam em{" "}
            <Link href={`/c/${slug}/documentos`} className="underline">
              Meus documentos
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <SalaDeVideo slug={slug} consultaId={consultaId} />
          <section className="space-y-2 border-t border-linha pt-6 text-sm text-tinta-suave">
            <h2 className="font-medium text-tinta">Antes de entrar</h2>
            <ul className="list-inside list-disc space-y-1">
              <li>O navegador vai pedir permissao para usar a camera e o microfone. Precisa autorizar as duas.</li>
              <li>Prefira fones de ouvido: sem eles, o som do medico volta pelo seu microfone e vira eco.</li>
              <li>Escolha um lugar fechado. A consulta e sua, e o que for falado ali e sobre a sua saude.</li>
              <li>Esta chamada nao e gravada.</li>
            </ul>
          </section>
        </>
      )}

      <p className="text-sm">
        <Link href={`/c/${slug}/agenda`} className="underline">
          Voltar para minhas consultas
        </Link>
      </p>
    </div>
  );
}
