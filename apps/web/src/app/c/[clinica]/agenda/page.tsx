import type { Metadata } from "next";
import Link from "next/link";
import type { ConsultaResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta, diaPorExtenso, hora } from "@/lib/datas";
import { AcoesDaConsulta } from "./AcoesDaConsulta";

export const metadata: Metadata = { title: "Agenda" };

/**
 * A agenda, vista de onde a pessoa esta:
 *   paciente -> "minhas consultas"
 *   medico   -> "meus atendimentos"
 *   recepcao -> "a agenda da clinica"
 *
 * Quem ve o que nao e decidido aqui: o RLS ja devolve so o permitido. Esta
 * tela apenas escolhe o titulo e quais acoes oferecer.
 */
export default async function PaginaAgenda({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const fuso = clinica.fusoHorario;

  const r = await chamarApi<ConsultaResumo[]>("/consultas", { token, clinica: slug });

  const titulo =
    clinica.papel === "paciente" ? "Minhas consultas" : clinica.papel === "medico" ? "Meus atendimentos" : "Agenda da clinica";

  // Agrupa por dia, para a tela ler como uma agenda de papel.
  const porDia = new Map<string, ConsultaResumo[]>();
  if (r.ok) {
    for (const c of r.dados) {
      const dia = dataCurta(c.inicio, fuso);
      porDia.set(dia, [...(porDia.get(dia) ?? []), c]);
    }
  }

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-titulo text-3xl tracking-tight">{titulo}</h1>
        {clinica.papel === "paciente" ? (
          <Link href={`/c/${slug}/marcar`} className="rounded-md bg-selo px-4 py-2 text-sm font-medium text-white hover:bg-selo/90">
            Marcar consulta
          </Link>
        ) : null}
        {clinica.papel === "medico" ? (
          <Link href={`/c/${slug}/grade`} className="text-sm text-selo underline-offset-4 hover:underline">
            Meus horarios de atendimento
          </Link>
        ) : null}
      </div>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : porDia.size === 0 ? (
        <Aviso>
          Nenhuma consulta nos proximos 30 dias.
          {clinica.papel === "paciente" ? " Use \u201cMarcar consulta\u201d para agendar." : null}
        </Aviso>
      ) : (
        <div className="space-y-8">
          {[...porDia.entries()].map(([dia, lista]) => (
            <section key={dia} className="space-y-3">
              <h2 className="font-titulo text-lg capitalize text-tinta-suave">{diaPorExtenso(lista[0]!.inicio, fuso)}</h2>
              <ul className="divide-y divide-linha overflow-hidden rounded-lg border border-linha bg-superficie">
                {lista.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                    <div className="flex items-center gap-4">
                      <span className={"font-mono text-lg " + (c.status === "cancelada" ? "text-tinta-suave line-through" : "")}>
                        {hora(c.inicio, fuso)}
                      </span>
                      <div>
                        <p className="font-medium">
                          {clinica.papel === "paciente" ? `CRM ${c.medico.crm}-${c.medico.crmUf}` : c.paciente.nomeCompleto}
                        </p>
                        <p className="text-sm text-tinta-suave">
                          {c.status === "cancelada" && c.motivoCancelamento ? `Cancelada: ${c.motivoCancelamento}` : (c.motivo ?? "sem observacao")}
                        </p>
                      </div>
                    </div>
                    <AcoesDaConsulta slug={slug} consulta={c} papel={clinica.papel} souOMedico={c.medico.id === perfil.id} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
