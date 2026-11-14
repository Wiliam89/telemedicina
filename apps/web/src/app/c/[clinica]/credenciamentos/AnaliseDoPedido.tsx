"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CredenciamentoParaAnalise } from "@tele/shared";
import { nomeDaEspecialidade } from "@tele/shared/atendimento";
import { NOME_DO_DOCUMENTO_DO_MEDICO, NOME_DO_STATUS_DA_IDENTIDADE, NOME_DO_STATUS_DO_CREDENCIAMENTO } from "@tele/shared/credenciamento";
import { BUSCA_CFM, NOME_DA_SITUACAO_CRM } from "@tele/shared/crm";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { Cartao, Etiqueta } from "@/componentes/ui";
import { acaoNaApi } from "@/lib/navegador";

/**
 * A ANALISE DE UM PEDIDO (ADR-0022), na ordem em que se confere:
 *   1. os documentos;
 *   2. a identidade - a selfie ao lado da foto do documento;
 *   3. o CRM no Conselho;
 *   4. a decisao: o que liberar, pedir ajuste ou recusar.
 *
 * Os arquivos so saem por link temporario, e cada abertura fica registrada.
 */
export function AnaliseDoPedido({ slug, pedido, meuId }: { slug: string; pedido: CredenciamentoParaAnalise; meuId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [fotos, setFotos] = useState<{ selfie: string; documento: string } | null>(null);
  const [observacao, setObservacao] = useState("");
  const [liberadas, setLiberadas] = useState<string[]>(pedido.especialidadesSolicitadas);
  const [pronto, setPronto] = useState(pedido.querProntoAtendimento);
  const [nomeNoConselho, setNomeNoConselho] = useState("");
  const [situacao, setSituacao] = useState("Ativo");
  const [motivo, setMotivo] = useState("");

  const emAnalise = pedido.status === "em_analise";
  const proprio = pedido.medico.id === meuId;
  const identidadeOk = pedido.identidade?.status === "aprovada";
  const crmOk = pedido.situacaoCrm === "verificado";
  const documento = (tipo: string) => pedido.documentos.find((d) => d.tipo === tipo);

  async function linkDe(id: string): Promise<string | null> {
    const r = await acaoNaApi<{ url: string }>(`/credenciamentos/documentos/${id}/arquivo`, { clinica: slug });
    if (!r.ok) {
      setErro(r.erro.mensagem);
      return null;
    }
    return r.dados.url;
  }

  async function abrir(id: string) {
    setErro(null);
    // A janela abre no clique (senao o navegador bloqueia) e recebe o endereco depois.
    const janela = window.open("", "_blank");
    const url = await linkDe(id);
    if (url && janela) {
      janela.opener = null;
      janela.location.href = url;
    } else janela?.close();
  }

  async function compararFotos() {
    setErro(null);
    const selfie = documento("selfie");
    const frente = documento("identidade_frente");
    if (!selfie || !frente) {
      setErro("Faltam a selfie ou a foto do documento neste pedido.");
      return;
    }
    setOcupado("fotos");
    const [a, b] = await Promise.all([linkDe(selfie.id), linkDe(frente.id)]);
    setOcupado(null);
    if (a && b) setFotos({ selfie: a, documento: b });
  }

  async function enviar(chave: string, rota: string, corpo: unknown) {
    setErro(null);
    setOcupado(chave);
    const r = await acaoNaApi(rota, { metodo: "POST", clinica: slug, corpo });
    setOcupado(null);
    if (!r.ok) {
      const detalhes = Array.isArray(r.erro.detalhes) ? (r.erro.detalhes as { problema: string }[]).map((d) => d.problema).join(" ") : "";
      setErro(detalhes || r.erro.mensagem);
      return false;
    }
    router.refresh();
    return true;
  }

  const conferirIdentidade = (resultado: "aprovada" | "reprovada") => enviar(`id-${resultado}`, `/credenciamentos/${pedido.id}/identidade`, { resultado, observacao: observacao.trim() || undefined });

  function decidir(decisao: "aprovar" | "recusar" | "pedir_ajuste") {
    if (decisao !== "aprovar" && motivo.trim().length < 5) {
      setErro("Explique o motivo: o médico vai ler esta mensagem.");
      return;
    }
    return enviar(decisao, `/credenciamentos/${pedido.id}/decidir`, {
      decisao,
      ...(decisao === "aprovar"
        ? { especialidades: liberadas, atendeProntoAtendimento: pronto, ...(!crmOk && nomeNoConselho.trim() ? { crm: { nomeNoConselho: nomeNoConselho.trim(), situacaoNoConselho: situacao.trim() } } : {}) }
        : { motivo: motivo.trim() }),
    });
  }

  return (
    <Cartao
      titulo={pedido.medico.nomeCompleto}
      descricao={`CRM ${pedido.medico.crm}-${pedido.medico.crmUf}${pedido.medico.cpfMascarado ? ` · CPF ${pedido.medico.cpfMascarado}` : ""}${pedido.enviadoEm ? ` · enviado em ${new Date(pedido.enviadoEm).toLocaleDateString("pt-BR")}` : ""}`}
      acoes={<Etiqueta tom={pedido.status === "aprovado" ? "selo" : emAnalise ? "espera" : "alerta"}>{NOME_DO_STATUS_DO_CREDENCIAMENTO[pedido.status]}</Etiqueta>}
    >
      <div className="space-y-6">
        {proprio ? <Aviso tipo="espera">Este pedido é seu. Outra pessoa da administração precisa conferi-lo e decidir.</Aviso> : null}
        {pedido.motivo && !emAnalise ? <p className="text-sm text-tinta-suave">Mensagem enviada ao médico: {pedido.motivo}</p> : null}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-tinta">O que o médico pediu</h3>
          <p className="text-sm text-tinta-suave">
            {pedido.querProntoAtendimento ? "Pronto atendimento (clínico geral)" : "Sem pronto atendimento"}
            {pedido.especialidadesSolicitadas.length > 0 ? ` · ${pedido.especialidadesSolicitadas.map(nomeDaEspecialidade).join(", ")}` : ""}
            {pedido.rqe ? ` · RQE ${pedido.rqe}` : ""}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-tinta">1. Documentos</h3>
          <ul className="flex flex-wrap gap-2">
            {pedido.documentos.filter((d) => d.tipo !== "selfie").map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => abrir(d.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-linha bg-superficie px-3 py-1.5 text-sm hover:border-selo/50 hover:bg-selo-suave">
                  {NOME_DO_DOCUMENTO_DO_MEDICO[d.tipo]} <ExternalLink className="h-3.5 w-3.5 text-tinta-suave" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-tinta">2. Identidade</h3>
            <Etiqueta tom={identidadeOk ? "selo" : pedido.identidade?.status === "reprovada" ? "alerta" : "espera"}>
              {NOME_DO_STATUS_DA_IDENTIDADE[pedido.identidade?.status ?? "nao_iniciada"]}
            </Etiqueta>
            {pedido.identidade ? (
              <span className="text-xs text-tinta-suave">
                {pedido.identidade.provedor === "manual" ? `conferência manual${pedido.identidade.verificadoPor ? ` por ${pedido.identidade.verificadoPor}` : ""}` : `serviço: ${pedido.identidade.provedor}`}
                {pedido.identidade.pontuacao !== null ? ` · semelhança ${pedido.identidade.pontuacao}%` : ""}
              </span>
            ) : null}
          </div>

          {!fotos ? (
            <Botao type="button" variante="secundario" tamanho="p" onClick={compararFotos} carregando={ocupado === "fotos"}>
              Ver a selfie ao lado do documento
            </Botao>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { rotulo: "Selfie enviada agora", url: fotos.selfie },
                { rotulo: "Foto do documento", url: fotos.documento },
              ].map((f) => (
                <figure key={f.rotulo} className="overflow-hidden rounded-lg border border-linha bg-superficie-alt">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.rotulo} className="h-64 w-full object-contain" />
                  <figcaption className="border-t border-linha px-3 py-2 text-xs text-tinta-suave">{f.rotulo}</figcaption>
                </figure>
              ))}
            </div>
          )}

          {emAnalise && !identidadeOk && !proprio ? (
            <div className="space-y-3 rounded-lg border border-linha bg-superficie-alt p-4">
              <p className="text-sm text-tinta-suave">É a mesma pessoa nas duas fotos? O nome do documento é o do cadastro?</p>
              <label htmlFor={`obs-${pedido.id}`} className="block text-sm font-medium">Observação (obrigatória para não confirmar)</label>
              <textarea id={`obs-${pedido.id}`} rows={2} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`} />
              <div className="flex flex-wrap gap-3">
                <Botao type="button" tamanho="p" onClick={() => conferirIdentidade("aprovada")} carregando={ocupado === "id-aprovada"} disabled={ocupado !== null}>
                  É a mesma pessoa
                </Botao>
                <Botao type="button" tamanho="p" variante="perigo" onClick={() => conferirIdentidade("reprovada")} carregando={ocupado === "id-reprovada"} disabled={ocupado !== null}>
                  Não confirmo
                </Botao>
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-tinta">3. CRM no Conselho</h3>
            <Etiqueta tom={crmOk ? "selo" : "espera"}>{NOME_DA_SITUACAO_CRM[pedido.situacaoCrm]}</Etiqueta>
            <a href={BUSCA_CFM} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-selo underline underline-offset-4">
              Abrir a busca do CFM <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
          {emAnalise && !crmOk ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id={`nome-${pedido.id}`} rotulo="Nome como aparece no Conselho" value={nomeNoConselho} onChange={(e) => setNomeNoConselho(e.target.value)} ajuda="Preencha para registrar a conferência junto com a aprovação." />
              <Campo id={`sit-${pedido.id}`} rotulo="Situação no Conselho" value={situacao} onChange={(e) => setSituacao(e.target.value)} ajuda="Só se aprova com situação Ativo." />
            </div>
          ) : null}
        </section>

        {emAnalise && !proprio ? (
          <section className="space-y-4 border-t border-linha pt-5">
            <h3 className="text-sm font-semibold text-tinta">4. Decisão</h3>
            <fieldset className="space-y-2">
              <legend className="text-sm text-tinta-suave">O que liberar (só o que foi pedido e comprovado):</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pronto} disabled={!pedido.querProntoAtendimento} onChange={(e) => setPronto(e.target.checked)} /> Pronto atendimento (clínico geral)
              </label>
              {pedido.especialidadesSolicitadas.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={liberadas.includes(c)} onChange={(e) => setLiberadas((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))} /> {nomeDaEspecialidade(c)}
                </label>
              ))}
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor={`motivo-${pedido.id}`} className="block text-sm font-medium">Mensagem ao médico (para pedir ajuste ou recusar)</label>
              <textarea id={`motivo-${pedido.id}`} rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`} placeholder="Ex.: a foto do documento está ilegível; envie outra." />
            </div>

            {!identidadeOk ? <Aviso tipo="espera">Confirme a identidade (passo 2) antes de aprovar.</Aviso> : null}
            <div className="flex flex-wrap gap-3">
              <Botao type="button" onClick={() => decidir("aprovar")} carregando={ocupado === "aprovar"} disabled={ocupado !== null || !identidadeOk}>
                Aprovar
              </Botao>
              <Botao type="button" variante="secundario" onClick={() => decidir("pedir_ajuste")} carregando={ocupado === "pedir_ajuste"} disabled={ocupado !== null}>
                Pedir ajuste
              </Botao>
              <Botao type="button" variante="perigo" onClick={() => decidir("recusar")} carregando={ocupado === "recusar"} disabled={ocupado !== null}>
                Recusar
              </Botao>
            </div>
          </section>
        ) : null}

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      </div>
    </Cartao>
  );
}
