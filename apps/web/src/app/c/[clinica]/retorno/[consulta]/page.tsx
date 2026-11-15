import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConsultaResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { LinkBotao } from "@/componentes/Botao";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { MarcarConsulta } from "../../marcar/MarcarConsulta";

export const metadata: Metadata = { title: "Marcar retorno" };

/**
 * RETORNO SEM CUSTO (ADR-0027). O paciente marca a continuacao de uma
 * consulta concluida: com o mesmo medico, ate o prazo que ele liberou, sem
 * pagar. Quem confere tudo de verdade e a API; esta tela so mostra o caminho.
 */
export default async function PaginaRetorno({ params }: { params: Promise<{ clinica: string; consulta: string }> }) {
  const { clinica: slug, consulta: consultaId } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const fuso = clinica.fusoHorario;
  const desde = new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(Date.now() - 60 * 86400000));
  const ate = new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(Date.now() + 1 * 86400000));
  const r = await chamarApi<ConsultaResumo[]>(`/consultas?de=${desde}&ate=${ate}`, { token, clinica: slug });
  const original = r.ok ? r.dados.find((c) => c.id === consultaId && c.paciente.id === perfil.id) : undefined;
  if (r.ok && !original) notFound();

  const disponivel = original && original.status === "concluida" && original.retornoAte && !original.retornoMarcado && new Date(original.retornoAte) > new Date();

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Retorno sem custo"
        titulo={original ? `Retorno com Dr(a). ${original.medico.nomeCompleto}` : "Marcar retorno"}
        descricao="O retorno continua a sua consulta: é para mostrar exames ou contar como o tratamento está indo. Não é cobrado."
      />
      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : !disponivel ? (
        <div className="space-y-4">
          <Aviso>
            {original?.retornoMarcado ? "Este retorno já foi marcado. Veja em Minhas consultas." : "Esta consulta não tem retorno sem custo disponível (o prazo pode ter acabado)."}
          </Aviso>
          <LinkBotao href={`/c/${slug}/agenda`} variante="secundario">Ver minhas consultas</LinkBotao>
        </div>
      ) : (
        <MarcarConsulta
          slug={slug}
          fuso={fuso}
          medicos={[{ ...original!.medico, situacaoCrm: "verificado" }]}
          {...(original!.linha ? { linha: original!.linha } : {})}
          {...(original!.especialidadeDaConsulta ? { especialidade: original!.especialidadeDaConsulta } : {})}
          retorno={{ de: original!.id, ate: original!.retornoAte! }}
        />
      )}
    </div>
  );
}
