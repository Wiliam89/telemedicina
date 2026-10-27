import type { Metadata } from "next";
import { BadgeCheck, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { Aviso } from "@/componentes/Aviso";
import { Folha } from "@/componentes/Folha";
import type { ResultadoValidacao } from "@tele/shared";
import { chamarApi } from "@/lib/api";
import { FormularioValidacao } from "./FormularioValidacao";

export const metadata: Metadata = {
  title: "Validar documento",
  description: "Confira a autenticidade de um documento médico emitido nesta plataforma.",
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
    <Folha
      Icone={BadgeCheck}
      largura="lg"
      semCartao
      titulo="Validar documento"
      descricao="Digite o código impresso no rodapé da receita, atestado ou pedido de exame. Não é preciso ter conta."
    >
      <div className="space-y-6">
      <div className="rounded-2xl border border-linha bg-superficie p-6 shadow-cartao">
        <FormularioValidacao codigoInicial={codigo ?? ""} />
      </div>

      {resultado ? (
        !resultado.ok ? (
          <Aviso tipo="erro">{resultado.erro.mensagem}</Aviso>
        ) : resultado.dados.valido ? (
          <div className="space-y-4 rounded-2xl border border-selo/30 bg-superficie p-6 shadow-cartao">
            <p className="flex items-center gap-2 font-titulo text-xl font-semibold text-selo">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> Documento autêntico
            </p>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2.5 border-t border-linha pt-4 text-sm">
              <dt className="text-tinta-suave">Tipo</dt>
              <dd>{resultado.dados.tipo}</dd>
              <dt className="text-tinta-suave">Número</dt>
              <dd>{resultado.dados.numero}</dd>
              <dt className="text-tinta-suave">Emitido em</dt>
              <dd>{new Date(resultado.dados.emitidoEm!).toLocaleString("pt-BR")}</dd>
              <dt className="text-tinta-suave">Paciente</dt>
              <dd>{resultado.dados.pacienteIniciais}</dd>
              <dt className="text-tinta-suave">Médico</dt>
              <dd>
                {resultado.dados.medico?.nomeCompleto} — CRM {resultado.dados.medico?.crm}-{resultado.dados.medico?.crmUf}
              </dd>
              <dt className="text-tinta-suave">Clínica</dt>
              <dd>{resultado.dados.clinica}</dd>
              <dt className="text-tinta-suave">Assinatura digital</dt>
              <dd>{resultado.dados.assinado ? `sim, em ${new Date(resultado.dados.assinadoEm!).toLocaleDateString("pt-BR")}` : "ainda não assinado"}</dd>
            </dl>
            <p className="break-all font-mono text-xs text-tinta-suave">SHA-256: {resultado.dados.hash}</p>
            <p className="text-xs text-tinta-suave">
              Por privacidade, o conteúdo clínico não é exibido aqui: ele consta apenas no documento em mãos do paciente.
            </p>
          </div>
        ) : (
          <div role="alert" className="rounded-2xl border border-alerta/30 bg-alerta-suave p-6">
            <p className="flex items-center gap-2 font-titulo text-xl font-semibold text-alerta">
              <XCircle className="h-6 w-6" aria-hidden="true" /> Documento não confere
            </p>
            <p className="mt-2 text-sm">{resultado.dados.motivo}</p>
            {resultado.dados.numero ? <p className="mt-1 text-sm text-tinta-suave">Documento no {resultado.dados.numero}.</p> : null}
          </div>
        )
      ) : null}

      <div className="rounded-2xl border border-linha bg-superficie p-5 text-sm text-tinta-suave">
        <p className="font-medium text-tinta">Tem o PDF assinado em mãos?</p>
        <p className="mt-1">
          Além do código, a assinatura digital ICP-Brasil do arquivo pode ser conferida no validador oficial do governo federal (ITI), que também mostra
          se o certificado é de um médico com registro ativo.
        </p>
        <a href="https://validar.iti.gov.br" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-selo hover:text-selo-forte">
          Abrir validar.iti.gov.br <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      </div>
    </Folha>
  );
}
