import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { MeiosDePagamento, PendenciaDePagamento } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Cartao } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta } from "@/lib/datas";
import { emReais } from "@/lib/dinheiro";
import { temPapel } from "@/lib/papeis";
import { CartaoCadastrado } from "./CartaoCadastrado";

export const metadata: Metadata = { title: "Pagamento" };

/**
 * FORMA DE PAGAMENTO DO PACIENTE (ADR-0023).
 *
 *   Com cartao cadastrado  a consulta e debitada quando termina;
 *   Sem cartao             o Pix aparece antes de cada consulta comecar.
 *
 * Cadastrar e opcional, e da para remover quando quiser.
 */
export default async function PaginaCartao({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "paciente")) notFound();

  const [meios, pendencias] = await Promise.all([
    chamarApi<MeiosDePagamento>("/cartoes", { token, clinica: slug }),
    chamarApi<PendenciaDePagamento[]>("/pagamentos/pendencias", { token, clinica: slug }),
  ]);

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        titulo="Pagamento"
        descricao="Cadastrar um cartão é opcional. Com ele, você não paga antes: o valor é debitado quando a consulta termina. Sem ele, o Pix aparece antes de cada atendimento."
      />

      {pendencias.ok && pendencias.dados.length > 0 ? (
        <Cartao titulo="Pagamentos pendentes" descricao="Consultas realizadas cuja cobrança no cartão não foi aprovada." semPadding>
          <ul className="divide-y divide-linha">
            {pendencias.dados.map((p) => (
              <li key={p.consultaId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span className="text-sm">
                  {dataCurta(p.realizadaEm, clinica.fusoHorario)} · Dr(a). {p.medicoNome} · <strong>{emReais(p.valorCentavos)}</strong>
                </span>
                <Link href={`/c/${slug}/pagamento/${p.consultaId}`} className="text-sm font-medium text-selo underline underline-offset-4">
                  Pagar agora
                </Link>
              </li>
            ))}
          </ul>
        </Cartao>
      ) : null}

      {!meios.ok ? <Aviso tipo="erro">{meios.erro.mensagem}</Aviso> : <CartaoCadastrado slug={slug} inicial={meios.dados} cpf={perfil.cpf} />}
    </div>
  );
}
