import type { Metadata } from "next";
import type { ResultadoValidacao } from "@tele/shared";
import { chamarApi } from "@/lib/api";
import { FormularioValidacao } from "./FormularioValidacao";

export const metadata: Metadata = {
  title: "Validar documento",
  description: "Confira a autenticidade de um documento medico emitido nesta plataforma.",
  robots: { index: true, follow: true },
};

/**
 * A UNICA pagina publica da plataforma. Existe para a farmacia, o RH ou o
 * laboratorio conferirem um documento em maos - sem conta, sem login.
 *
 * Ela mostra o minimo para provar autenticidade: tipo, numero, data, CRM e
 * as INICIAIS do paciente. Nunca o conteudo clinico: quem tem o papel ja
 * sabe o que esta escrito, e quem nao tem nao vai descobrir aqui.
 */
export default async function PaginaValidar({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const { codigo } = await searchParams;
  const resultado = codigo ? await chamarApi<ResultadoValidacao>(`/validar/${encodeURIComponent(codigo)}`) : null;

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Validar documento</h1>
        <p className="text-tinta-suave">
          Digite o codigo impresso no rodape do documento. Nao e preciso ter conta.
        </p>
      </div>

      <FormularioValidacao codigoInicial={codigo ?? ""} />

      {resultado ? (
        !resultado.ok ? (
          <div role="alert" className="rounded-md border border-alerta/40 bg-alerta-suave px-4 py-3 text-sm text-alerta">
            {resultado.erro.mensagem}
          </div>
        ) : resultado.dados.valido ? (
          <div className="space-y-4 rounded-lg border border-selo/40 bg-selo-suave p-5">
            <p className="font-titulo text-xl text-selo">Documento autentico</p>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-tinta-suave">Tipo</dt>
              <dd>{resultado.dados.tipo}</dd>
              <dt className="text-tinta-suave">Numero</dt>
              <dd>{resultado.dados.numero}</dd>
              <dt className="text-tinta-suave">Emitido em</dt>
              <dd>{new Date(resultado.dados.emitidoEm!).toLocaleString("pt-BR")}</dd>
              <dt className="text-tinta-suave">Paciente</dt>
              <dd>{resultado.dados.pacienteIniciais}</dd>
              <dt className="text-tinta-suave">Medico</dt>
              <dd>
                {resultado.dados.medico?.nomeCompleto} — CRM {resultado.dados.medico?.crm}-{resultado.dados.medico?.crmUf}
              </dd>
              <dt className="text-tinta-suave">Clinica</dt>
              <dd>{resultado.dados.clinica}</dd>
              <dt className="text-tinta-suave">Assinatura digital</dt>
              <dd>{resultado.dados.assinado ? `sim, em ${new Date(resultado.dados.assinadoEm!).toLocaleDateString("pt-BR")}` : "ainda nao assinado"}</dd>
            </dl>
            <p className="break-all font-mono text-xs text-tinta-suave">SHA-256: {resultado.dados.hash}</p>
            <p className="text-xs text-tinta-suave">
              Por privacidade, o conteudo clinico nao e exibido aqui: ele consta apenas no documento em maos do paciente.
            </p>
          </div>
        ) : (
          <div role="alert" className="rounded-lg border border-alerta/40 bg-alerta-suave p-5">
            <p className="font-titulo text-xl text-alerta">Documento nao confere</p>
            <p className="mt-2 text-sm">{resultado.dados.motivo}</p>
            {resultado.dados.numero ? <p className="mt-1 text-sm text-tinta-suave">Documento no {resultado.dados.numero}.</p> : null}
          </div>
        )
      ) : null}
    </section>
  );
}
