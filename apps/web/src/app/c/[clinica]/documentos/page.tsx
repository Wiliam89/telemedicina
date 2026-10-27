import { ChevronDown, FileCheck2, FilePen, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { DocumentoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { nomeDoTipoDeDocumento, StatusDoDocumento } from "@/componentes/EtiquetaDeStatus";
import { CabecalhoDaPagina, Indicador, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { AssinarDocumento } from "./AssinarDocumento";
import { BaixarDocumento } from "./BaixarDocumento";

export const metadata: Metadata = { title: "Documentos" };

/**
 * Os documentos da pessoa logada nesta clinica: o paciente ve os que
 * recebeu, o medico os que emitiu. O texto vem pronto da API - o mesmo
 * texto cujo hash foi guardado, byte a byte.
 */
export default async function PaginaDocumentos({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  const r = await chamarApi<DocumentoResumo[]>("/documentos", { token, clinica: slug });
  const lista = r.ok ? r.dados : [];

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        titulo="Documentos"
        descricao={
          <>
            Receitas, atestados e pedidos de exame. Cada um tem um código que qualquer pessoa confere em{" "}
            <Link href="/validar" className="font-medium text-selo hover:text-selo-forte">
              /validar
            </Link>
            , sem precisar de conta.
          </>
        }
      />

      {r.ok && lista.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Indicador Icone={FileText} tom="neutro" rotulo="Total" valor={lista.length} />
          <Indicador Icone={FileCheck2} rotulo="Assinados" valor={lista.filter((d) => d.status === "assinado").length} />
          <Indicador Icone={FilePen} tom="espera" rotulo="Aguardando assinatura" valor={lista.filter((d) => d.status === "emitido").length} />
        </div>
      ) : null}

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : lista.length === 0 ? (
        <Vazio Icone={FileText} titulo="Nenhum documento ainda">
          {temPapel(clinica, "medico") ? "Os documentos são emitidos durante o atendimento." : "Os documentos emitidos nas suas consultas aparecem aqui."}
        </Vazio>
      ) : (
        <ul className="space-y-4">
          {lista.map((d) => (
            <li key={d.id}>
              <details className={"group rounded-xl border bg-superficie shadow-cartao " + (d.status === "cancelado" ? "border-alerta/30" : "border-linha")}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-marinho-suave text-marinho">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-[12rem] flex-1">
                    <p className="font-medium">
                      {nomeDoTipoDeDocumento(d.tipo)} <span className="font-normal text-tinta-suave">· nº {d.numero}/{d.ano}</span>
                    </p>
                    <p className="text-sm text-tinta-suave">
                      {temPapel(clinica, "medico") ? d.paciente.nomeCompleto : `Dr(a). ${d.medico.nomeCompleto}`} ·{" "}
                      {new Date(d.criadoEm).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <StatusDoDocumento status={d.status} />
                  <ChevronDown className="h-4 w-4 text-tinta-suave transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>

                <div className="space-y-4 border-t border-linha px-5 py-5">
                  {d.status === "cancelado" ? <Aviso tipo="erro">Cancelado: {d.motivoCancelamento}</Aviso> : null}
                  {d.status === "assinado" ? <Aviso tipo="ok">Assinado digitalmente em {new Date(d.assinadoEm!).toLocaleString("pt-BR")}.</Aviso> : null}
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-linha bg-superficie-alt p-4 font-mono text-xs leading-relaxed">
                    {d.textoImpresso}
                  </pre>
                  <p className="break-all font-mono text-xs text-tinta-suave">
                    Código: {d.codigoValidacao} · SHA-256: {d.hash.slice(0, 16)}…
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {d.status === "assinado" ? <BaixarDocumento slug={slug} documentoId={d.id} /> : null}
                    {temPapel(clinica, "medico") ? <AssinarDocumento slug={slug} documento={d} /> : null}
                  </div>
                  {d.status === "emitido" ? (
                    <p className="text-xs text-tinta-suave">
                      Sem assinatura digital, este documento vale como registro interno, mas a farmácia pode recusá-lo.
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
