import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConviteResumo, MedicoComCrm, MembroResumo, SituacaoCrm } from "@tele/shared";
import { NOME_DA_SITUACAO_CRM } from "@tele/shared/crm";
import { Aviso } from "@/componentes/Aviso";
import { Avatar, CabecalhoDaPagina, Cartao, Etiqueta, type Tom } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { NOME_DO_PAPEL, temPapel } from "@/lib/papeis";
import { PainelConvites } from "./PainelConvites";
import { SituacaoDaClinica } from "./SituacaoDaClinica";
import { VerificarCrm } from "./VerificarCrm";

const TOM_CRM: Record<SituacaoCrm, Tom> = { pendente: "espera", verificado: "selo", recusado: "alerta", vencido: "espera" };

export const metadata: Metadata = { title: "Equipe" };

export default async function PaginaEquipe({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  // Quem nao administra nao ve que esta tela existe.
  if (!temPapel(clinica, "admin_clinica")) notFound();

  const [membros, convites, crm] = await Promise.all([
    chamarApi<MembroResumo[]>("/membros", { token, clinica: slug }),
    chamarApi<ConviteResumo[]>("/convites", { token, clinica: slug }),
    chamarApi<MedicoComCrm[]>("/crm/verificacoes", { token, clinica: slug }),
  ]);
  const pendentesCrm = crm.ok ? crm.dados.filter((m) => m.situacao !== "verificado").length : 0;

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina titulo="Equipe e clínica" descricao="Quem trabalha aqui, convites pendentes e a porta de entrada dos pacientes." />

      <Cartao titulo="Situação da clínica">
        <SituacaoDaClinica slug={slug} status={clinica.status} />
      </Cartao>

      <Cartao
        titulo="Verificação de CRM"
        descricao="Médico só emite documentos, abre plantão e recebe marcações depois que o CRM é conferido no Conselho."
        acoes={pendentesCrm > 0 ? <Etiqueta tom="espera">{pendentesCrm} pendente(s)</Etiqueta> : crm.ok && crm.dados.length > 0 ? <Etiqueta tom="selo">Todos verificados</Etiqueta> : undefined}
        semPadding
      >
        {!crm.ok ? (
          <div className="p-5">
            <Aviso tipo="erro">{crm.erro.mensagem}</Aviso>
          </div>
        ) : crm.dados.length === 0 ? (
          <p className="p-5 text-sm text-tinta-suave">Nenhum médico na equipe ainda. Convide abaixo.</p>
        ) : (
          <ul className="divide-y divide-linha">
            {crm.dados.map((m) => {
              const ultima = m.historico[0];
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <Avatar nome={m.nomeCompleto} tamanho="p" />
                  <div className="min-w-[14rem] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{m.nomeCompleto}</p>
                      <Etiqueta tom={TOM_CRM[m.situacao]}>{NOME_DA_SITUACAO_CRM[m.situacao]}</Etiqueta>
                    </div>
                    <p className="text-sm text-tinta-suave">
                      CRM {m.crm}-{m.crmUf}
                      {m.especialidade ? ` · ${m.especialidade}` : ""}
                    </p>
                    {ultima ? (
                      <p className="mt-0.5 text-xs text-tinta-suave">
                        {ultima.resultado === "verificado"
                          ? `Conferido por ${ultima.verificadoPor ?? "serviço automático"} em ${new Date(ultima.criadoEm).toLocaleDateString("pt-BR")} · Conselho: ${ultima.nomeNoConselho} (${ultima.situacaoNoConselho}) · vale até ${new Date(ultima.validoAte!).toLocaleDateString("pt-BR")}`
                          : `Recusado por ${ultima.verificadoPor} em ${new Date(ultima.criadoEm).toLocaleDateString("pt-BR")}: ${ultima.observacao}`}
                      </p>
                    ) : null}
                  </div>
                  <VerificarCrm slug={slug} medico={m} />
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Cartao titulo="Membros" acoes={membros.ok ? <Etiqueta>{membros.dados.length}</Etiqueta> : undefined} semPadding>
          {!membros.ok ? (
            <div className="p-5">
              <Aviso tipo="erro">{membros.erro.mensagem}</Aviso>
            </div>
          ) : (
            <ul className="divide-y divide-linha">
              {membros.dados.map((m) => (
                <li key={m.vinculoId} className="flex items-center gap-3 px-5 py-3.5">
                  <Avatar nome={m.nomeCompleto} tamanho="p" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.nomeCompleto}</p>
                    <p className="text-sm text-tinta-suave">desde {new Date(m.desde).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {m.papeis.map((p) => (
                      <Etiqueta key={p} tom={p === "medico" ? "selo" : p === "admin_clinica" ? "info" : "neutro"}>
                        {NOME_DO_PAPEL[p]}
                      </Etiqueta>
                    ))}
                    {m.status !== "ativo" ? <Etiqueta tom="alerta">{m.status}</Etiqueta> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Convidar">
          <PainelConvites slug={slug} pendentes={convites.ok ? convites.dados : []} />
        </Cartao>
      </div>
    </div>
  );
}
