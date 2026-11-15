import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarX2, HeartHandshake, RotateCcw, Siren, Smile, UserX } from "lucide-react";
import type { IndicadoresDeQualidade } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { CabecalhoDaPagina, Cartao, Indicador } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta } from "@/lib/datas";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Qualidade e faltas" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O que o NPS quer dizer, em palavras. */
function leituraDoNps(nps: number | null): string {
  if (nps === null) return "ainda sem respostas";
  if (nps >= 75) return "excelente";
  if (nps >= 50) return "muito bom";
  if (nps >= 0) return "razoável: dá para melhorar";
  return "ruim: há mais pacientes insatisfeitos do que satisfeitos";
}

/**
 * QUALIDADE (ADR-0027): faltas (do paciente e do medico), desistencia na
 * fila, retornos e a satisfacao dos pacientes (NPS). So numeros e os
 * comentarios que o paciente escreveu para a plataforma.
 */
export default async function PaginaQualidade({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ de?: string; ate?: string }> }) {
  const { clinica: slug } = await params;
  const { de, ate } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const q = new URLSearchParams({ ...(de && DATA.test(de) ? { de } : {}), ...(ate && DATA.test(ate) ? { ate } : {}) });
  const r = await chamarApi<IndicadoresDeQualidade>(`/admin/indicadores?${q}`, { token, clinica: slug });

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Administração"
        titulo="Qualidade e faltas"
        descricao="Como os pacientes avaliam o atendimento, quantos faltam e quantos desistem da fila. Sem padrão, os últimos 30 dias."
      />

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
          <section aria-labelledby="t-satisfacao" className="space-y-3">
            <h2 id="t-satisfacao" className="text-lg text-tinta">Satisfação dos pacientes</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador Icone={HeartHandshake} rotulo="NPS" valor={r.dados.satisfacao.nps ?? "—"} detalhe={leituraDoNps(r.dados.satisfacao.nps)} />
              <Indicador Icone={Smile} tom="info" rotulo="Nota média" valor={r.dados.satisfacao.media === null ? "—" : String(r.dados.satisfacao.media).replace(".", ",")} detalhe={`${r.dados.satisfacao.respostas} avaliação(ões)`} />
              <Indicador Icone={Smile} tom="selo" rotulo="Promotores (9 e 10)" valor={r.dados.satisfacao.promotores} detalhe={`${r.dados.satisfacao.neutros} neutro(s), notas 7 e 8`} />
              <Indicador Icone={Smile} tom="alerta" rotulo="Detratores (0 a 6)" valor={r.dados.satisfacao.detratores} />
            </div>
            <p className="text-sm text-tinta-suave">
              NPS = % de quem deu 9 ou 10, menos % de quem deu de 0 a 6. Vai de -100 a 100. Acima de 50 é muito bom.
            </p>
          </section>

          <section aria-labelledby="t-faltas" className="space-y-3">
            <h2 id="t-faltas" className="text-lg text-tinta">Faltas e desistências</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador Icone={UserX} tom="espera" rotulo="Faltas de pacientes" valor={`${String(r.dados.taxaDeFaltaDoPaciente).replace(".", ",")}%`} detalhe={`${r.dados.faltasDoPaciente} de ${r.dados.consultasQueDeviamAcontecer} consulta(s)`} />
              <Indicador Icone={UserX} tom="alerta" rotulo="Faltas de médicos" valor={`${String(r.dados.taxaDeFaltaDoMedico).replace(".", ",")}%`} detalhe={`${r.dados.faltasDoMedico} consulta(s)`} />
              <Indicador Icone={Siren} tom="info" rotulo="Desistiram da fila" valor={`${String(r.dados.fila.taxaDeDesistencia).replace(".", ",")}%`} detalhe={`${r.dados.fila.desistencias} de ${r.dados.fila.entradas} entrada(s)`} />
              <Indicador Icone={CalendarX2} tom="neutro" rotulo="Canceladas" valor={r.dados.canceladas} detalhe="sem contar as faltas" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Indicador Icone={RotateCcw} tom="selo" rotulo="Retornos liberados" valor={r.dados.retornos.liberados} detalhe={`${r.dados.retornos.marcados} marcado(s) no período`} />
            </div>
          </section>

          <Cartao titulo="Por médico" descricao="Só aparecem médicos com avaliação ou falta no período." semPadding>
            {r.dados.porMedico.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Nada no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-superficie-alt text-left text-tinta-suave">
                    <tr>
                      <th scope="col" className="px-5 py-2.5 font-medium">Médico</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Avaliações</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">NPS</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Faltas do médico</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-linha">
                    {r.dados.porMedico.map((m) => (
                      <tr key={m.medicoId}>
                        <td className="px-5 py-3">{m.nome}</td>
                        <td className="px-5 py-3">{m.respostas}</td>
                        <td className="px-5 py-3">{m.nps ?? "—"}</td>
                        <td className="px-5 py-3">{m.faltasDoMedico}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Cartao>

          <Cartao titulo="O que os pacientes escreveram" descricao="Os 50 comentários mais recentes. Sem o nome do paciente." semPadding>
            {r.dados.comentarios.length === 0 ? (
              <p className="p-5 text-sm text-tinta-suave">Nenhum comentário no período.</p>
            ) : (
              <ul className="divide-y divide-linha">
                {r.dados.comentarios.map((c, i) => (
                  <li key={i} className="flex gap-4 px-5 py-3.5">
                    <span className={"grid h-9 w-9 shrink-0 place-items-center rounded-lg font-titulo font-semibold " + (c.nota >= 9 ? "bg-selo-suave text-selo-forte" : c.nota <= 6 ? "bg-alerta-suave text-alerta" : "bg-espera-suave text-espera")}>
                      {c.nota}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm">{c.comentario}</p>
                      <p className="mt-0.5 text-xs text-tinta-suave">{dataCurta(c.criadoEm, clinica.fusoHorario)}</p>
                    </div>
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
