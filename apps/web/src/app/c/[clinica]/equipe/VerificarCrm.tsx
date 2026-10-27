"use client";

import { ExternalLink, ShieldCheck, ShieldX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { MedicoComCrm } from "@tele/shared";
import { BUSCA_CFM } from "@tele/shared/crm";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { acaoNaApi } from "@/lib/navegador";

/**
 * Conferencia do CRM pela administracao (ADR-0016).
 *
 * O passo a passo e o mesmo que qualquer farmacia ou RH faz: abrir a busca
 * publica do CFM, procurar pelo CRM e UF, e comparar NOME e SITUACAO. O
 * que foi visto fica registrado - com quem conferiu e quando - e vale por
 * um ano.
 */
export function VerificarCrm({ slug, medico }: { slug: string; medico: MedicoComCrm }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [resultado, setResultado] = useState<"verificado" | "recusado">("verificado");
  const [nome, setNome] = useState("");
  const [situacao, setSituacao] = useState("Ativo");
  const [especialidades, setEspecialidades] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const r = await acaoNaApi(`/medicos/${medico.id}/crm`, {
      metodo: "POST",
      clinica: slug,
      corpo: {
        resultado,
        ...(resultado === "verificado" ? { nomeNoConselho: nome, situacaoNoConselho: situacao, especialidadesNoConselho: especialidades || undefined } : {}),
        ...(observacao ? { observacao } : {}),
      },
    });
    setSalvando(false);
    if (!r.ok) {
      const detalhes = Array.isArray(r.erro.detalhes) ? (r.erro.detalhes as { problema: string }[]).map((d) => d.problema).join(" ") : "";
      return setErro(detalhes || r.erro.mensagem);
    }
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <Botao tamanho="p" variante={medico.situacao === "verificado" ? "secundario" : "principal"} onClick={() => setAberto(true)} icone={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
        {medico.situacao === "verificado" ? "Conferir de novo" : "Verificar CRM"}
      </Botao>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-marinho/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={`crm-${medico.id}`}>
      <form onSubmit={salvar} className="flex h-full w-full max-w-lg flex-col bg-superficie shadow-flutuante" noValidate>
        <div className="flex items-start justify-between border-b border-linha px-6 py-4">
          <div>
            <h2 id={`crm-${medico.id}`} className="text-lg">
              Verificar CRM
            </h2>
            <p className="text-sm text-tinta-suave">
              {medico.nomeCompleto} · CRM {medico.crm}-{medico.crmUf}
            </p>
          </div>
          <button type="button" onClick={() => setAberto(false)} className="rounded-lg p-2 text-tinta-suave hover:bg-marinho-suave" aria-label="Fechar">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <ol className="space-y-2 rounded-xl border border-linha bg-superficie-alt p-4 text-sm">
            <li>
              <strong>1.</strong> Abra a busca oficial do Conselho Federal de Medicina:{" "}
              <a href={BUSCA_CFM} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-selo hover:text-selo-forte">
                portal.cfm.org.br/busca-medicos <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </li>
            <li>
              <strong>2.</strong> Pesquise o CRM <span className="font-mono font-semibold">{medico.crm}</span>, UF <span className="font-mono font-semibold">{medico.crmUf}</span>.
            </li>
            <li>
              <strong>3.</strong> Confira se o <strong>nome</strong> é o mesmo do cadastro e se a <strong>situação</strong> está como <strong>Ativo</strong>.
            </li>
            <li>
              <strong>4.</strong> Registre abaixo o que o Conselho mostrou.
            </li>
          </ol>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Resultado da conferência</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="resultado" checked={resultado === "verificado"} onChange={() => setResultado("verificado")} />
              <ShieldCheck className="h-4 w-4 text-selo" aria-hidden="true" /> Confere: registro ativo e do mesmo médico
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="resultado" checked={resultado === "recusado"} onChange={() => setResultado("recusado")} />
              <ShieldX className="h-4 w-4 text-alerta" aria-hidden="true" /> Não confere: inexistente, inativo ou de outra pessoa
            </label>
          </fieldset>

          {resultado === "verificado" ? (
            <>
              <Campo id="crm-nome" rotulo="Nome como aparece no Conselho" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={medico.nomeCompleto} />
              <div className="space-y-1.5">
                <label htmlFor="crm-situacao" className="block text-sm font-medium">
                  Situação mostrada
                </label>
                <select id="crm-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`}>
                  <option>Ativo</option>
                  <option>Inativo</option>
                  <option>Suspenso</option>
                  <option>Cassado</option>
                  <option>Falecido</option>
                </select>
              </div>
              <Campo id="crm-esp" rotulo="Especialidades registradas (opcional)" value={especialidades} onChange={(e) => setEspecialidades(e.target.value)} placeholder="Clínica médica (RQE 12345)" />
            </>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="crm-obs" className="block text-sm font-medium">
              {resultado === "recusado" ? "Motivo da recusa" : "Observação (opcional)"}
            </label>
            <textarea id="crm-obs" rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`} />
          </div>

          <p className="text-xs text-tinta-suave">
            Fica registrado quem conferiu e quando. A verificação vale por 12 meses; depois o sistema pede uma nova conferência. Com o CRM
            verificado o médico passa a emitir documentos, abrir plantão e receber marcações nesta clínica.
          </p>
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-linha px-6 py-4">
          <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
          <Botao type="submit" variante={resultado === "recusado" ? "perigo" : "principal"} carregando={salvando}>
            {resultado === "recusado" ? "Registrar recusa" : "Registrar verificação"}
          </Botao>
        </div>
      </form>
    </div>
  );
}
