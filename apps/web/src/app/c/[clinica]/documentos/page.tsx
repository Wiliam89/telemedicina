import type { Metadata } from "next";
import Link from "next/link";
import type { DocumentoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
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
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const r = await chamarApi<DocumentoResumo[]>("/documentos", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Documentos</h1>
        <p className="text-tinta-suave">
          Cada documento tem um codigo que qualquer pessoa pode conferir em{" "}
          <Link href="/validar" className="text-selo underline underline-offset-4">/validar</Link>, sem precisar de conta.
        </p>
      </div>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : r.dados.length === 0 ? (
        <Aviso>Nenhum documento ainda.</Aviso>
      ) : (
        <ul className="space-y-4">
          {r.dados.map((d) => (
            <li key={d.id} className={"rounded-lg border bg-superficie p-5 " + (d.status === "cancelado" ? "border-alerta/40" : "border-linha")}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-titulo text-lg capitalize">
                  {d.tipo.replace(/_/g, " ")} · n<span className="lowercase">o</span> {d.numero}/{d.ano}
                </h2>
                <span className={"text-sm " + (d.status === "cancelado" ? "text-alerta" : d.status === "assinado" ? "text-selo" : "text-tinta-suave")}>
                  {d.status === "cancelado"
                    ? `Cancelado: ${d.motivoCancelamento}`
                    : d.status === "assinado"
                      ? `Assinado digitalmente em ${new Date(d.assinadoEm!).toLocaleString("pt-BR")}`
                      : "Emitido — ainda sem assinatura digital"}
                </span>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-papel p-4 font-mono text-xs leading-relaxed">{d.textoImpresso}</pre>
              <p className="mt-3 break-all font-mono text-xs text-tinta-suave">
                Codigo: {d.codigoValidacao} · impressao digital (SHA-256): {d.hash.slice(0, 16)}...
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                {d.status === "assinado" ? <BaixarDocumento slug={slug} documentoId={d.id} /> : null}
                {clinica.papel === "medico" ? <AssinarDocumento slug={slug} documento={d} /> : null}
              </div>

              {d.status === "emitido" ? (
                <p className="mt-2 text-xs text-tinta-suave">
                  Sem assinatura digital, este documento vale como registro interno, mas a farmacia pode recusa-lo.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
