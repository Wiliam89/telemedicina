import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ConsultaResumo, DocumentoResumo, EvolucaoResumo, FichaClinicaResumo, SinalVitalResumo } from "@tele/shared";
import { AlertTriangle, FolderHeart } from "lucide-react";
import { Aviso } from "@/componentes/Aviso";
import { LinkBotao } from "@/componentes/Botao";
import { FormularioFicha } from "@/componentes/prontuario/FormularioFicha";
import { FormularioSinais } from "@/componentes/prontuario/FormularioSinais";
import { ResumoSinais } from "@/componentes/prontuario/ProntuarioDoPaciente";
import { CabecalhoDaPagina, Cartao } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { dataCurta, hora } from "@/lib/datas";
import { Atendimento } from "./Atendimento";

export const metadata: Metadata = { title: "Atendimento" };

/**
 * A tela onde o medico atende: prontuario a esquerda, documentos a
 * direita, historico do paciente embaixo. So o medico da consulta entra.
 */
export default async function PaginaAtendimento({
  params,
}: {
  params: Promise<{ clinica: string; consulta: string }>;
}) {
  const { clinica: slug, consulta: consultaId } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "medico")) notFound();

  const hoje = new Date();
  const de = new Date(hoje.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(hoje.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const agenda = await chamarApi<ConsultaResumo[]>(`/consultas?de=${de}&ate=${ate}`, { token, clinica: slug });
  const consulta = agenda.ok ? agenda.dados.find((c) => c.id === consultaId) : undefined;
  if (!consulta) notFound();
  if (consulta.medico.id !== perfil.id) notFound();

  // Abre (ou reaproveita) o rascunho da evolucao desta consulta.
  const abertura = await chamarApi<{ id: string }>(`/consultas/${consultaId}/evolucao`, { metodo: "POST", token, clinica: slug });
  const historico = await chamarApi<EvolucaoResumo[]>(`/pacientes/${consulta.paciente.id}/prontuario`, { token, clinica: slug });
  const documentos = await chamarApi<DocumentoResumo[]>("/documentos", { token, clinica: slug });
  const [ficha, sinais] = await Promise.all([
    chamarApi<FichaClinicaResumo | null>(`/pacientes/${consulta.paciente.id}/ficha`, { token, clinica: slug }),
    chamarApi<SinalVitalResumo[]>(`/pacientes/${consulta.paciente.id}/sinais`, { token, clinica: slug }),
  ]);
  const f = ficha.ok ? ficha.dados : null;
  const prontuario = `/c/${slug}/pacientes/${consulta.paciente.id}`;

  return (
    <div className="space-y-8">

      <CabecalhoDaPagina
        sobretitulo="Atendimento"
        titulo={consulta.paciente.nomeCompleto}
        descricao={`${dataCurta(consulta.inicio, clinica.fusoHorario)} às ${hora(consulta.inicio, clinica.fusoHorario)}${consulta.motivo ? ` · ${consulta.motivo}` : ""}`}
        acoes={
          <LinkBotao href={prontuario} variante="secundario" icone={<FolderHeart className="h-4 w-4" aria-hidden="true" />}>
            Prontuário completo
          </LinkBotao>
        }
      />

      {/* O que o medico precisa saber ANTES de prescrever, sempre a vista. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao titulo="Alergias">
          {f && f.alergias.length > 0 ? (
            <p className="flex items-start gap-2 font-medium text-alerta">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {f.alergias.join(" · ")}
            </p>
          ) : f?.negaAlergias ? (
            <p className="text-sm text-selo-forte">Nega alergias.</p>
          ) : (
            <p className="text-sm text-espera">Não registradas - pergunte e registre na ficha.</p>
          )}
        </Cartao>
        <Cartao titulo="Medicamentos em uso">
          {f && f.medicamentosEmUso.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {f.medicamentosEmUso.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-tinta-suave">Nenhum registrado.</p>
          )}
          <div className="mt-3">
            <FormularioFicha slug={slug} pacienteId={consulta.paciente.id} atual={f} />
          </div>
        </Cartao>
        <Cartao titulo="Últimos sinais vitais">
          {sinais.ok ? <ResumoSinais sinais={sinais.dados} /> : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-selo">Registrar sinais desta consulta</summary>
            <div className="mt-3">
              <FormularioSinais slug={slug} pacienteId={consulta.paciente.id} consultaId={consultaId} compacto />
            </div>
          </details>
        </Cartao>
      </div>

      {!abertura.ok ? (
        <Aviso tipo="erro">{abertura.erro.mensagem}</Aviso>
      ) : (
        <Atendimento
          slug={slug}
          consultaId={consultaId}
          evolucaoId={abertura.dados.id}
          historico={historico.ok ? historico.dados : []}
          documentos={documentos.ok ? documentos.dados.filter((d) => d.status !== "cancelado") : []}
        />
      )}
    </div>
  );
}
