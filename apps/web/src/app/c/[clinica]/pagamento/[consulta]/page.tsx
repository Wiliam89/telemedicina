import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConsultaResumo, MeiosDePagamento, PendenciaDePagamento } from "@tele/shared";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta, hora } from "@/lib/datas";
import { PagarConsulta } from "./PagarConsulta";

export const metadata: Metadata = { title: "Pagamento" };

/**
 * A tela de pagamento de uma consulta (ADR-0023). Dois casos:
 *
 *   RESERVA    consulta marcada por quem nao tem cartao: o horario esta preso
 *              enquanto o Pix nao acontece - e a tela diz isso, com o prazo;
 *   PENDENCIA  consulta ja realizada cuja cobranca no cartao nao passou.
 *
 * O valor e sempre o COMBINADO quando a consulta foi marcada, nao o que a
 * tabela de precos diz hoje.
 */
export default async function PaginaPagamento({ params }: { params: Promise<{ clinica: string; consulta: string }> }) {
  const { clinica: slug, consulta: consultaId } = await params;
  const { token, clinica } = await contextoDaClinica(slug);

  const hoje = new Date();
  const de = new Date(hoje.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(hoje.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  const [agenda, pendencias, meios] = await Promise.all([
    chamarApi<ConsultaResumo[]>(`/consultas?de=${de}&ate=${ate}`, { token, clinica: slug }),
    chamarApi<PendenciaDePagamento[]>("/pagamentos/pendencias", { token, clinica: slug }),
    chamarApi<MeiosDePagamento>("/cartoes", { token, clinica: slug }),
  ]);
  const consulta = agenda.ok ? agenda.dados.find((c) => c.id === consultaId) : undefined;
  const pendencia = pendencias.ok ? pendencias.dados.find((p) => p.consultaId === consultaId) : undefined;
  // Pendencia antiga pode estar fora da janela da agenda: ela basta para pagar.
  if (!consulta && !pendencia) notFound();

  const quando = consulta?.inicio ?? pendencia!.realizadaEm;
  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        titulo={pendencia ? "Pagamento pendente" : "Pagamento da consulta"}
        descricao={
          <>
            Consulta de {dataCurta(quando, clinica.fusoHorario)} às {hora(quando, clinica.fusoHorario)}
            {consulta ? ` · Dr(a). ${consulta.medico.nomeCompleto}` : pendencia ? ` · Dr(a). ${pendencia.medicoNome}` : ""}
          </>
        }
      />
      <PagarConsulta
        slug={slug}
        consultaId={consultaId}
        status={consulta?.status ?? "concluida"}
        valorCentavos={pendencia?.valorCentavos ?? consulta?.valorCombinadoCentavos ?? null}
        pendencia={Boolean(pendencia)}
        cartao={meios.ok ? meios.dados.cartao : null}
      />
    </div>
  );
}
