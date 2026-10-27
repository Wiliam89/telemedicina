"use client";

import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { FichaClinicaResumo } from "@tele/shared";
import { TIPOS_SANGUINEOS } from "@tele/shared/prontuario";
import { Aviso } from "../Aviso";
import { Botao } from "../Botao";
import { CLASSE_CONTROLE } from "../Campo";
import { acaoNaApi } from "@/lib/navegador";

const linhas = (t: string) =>
  t
    .split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean);

function AreaDeTexto({ id, rotulo, ajuda, valor, mudar, linhas: n = 3 }: { id: string; rotulo: string; ajuda?: string; valor: string; mudar: (v: string) => void; linhas?: number }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {rotulo}
      </label>
      <textarea id={id} rows={n} value={valor} onChange={(e) => mudar(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`} aria-describedby={ajuda ? `${id}-ajuda` : undefined} />
      {ajuda ? (
        <p id={`${id}-ajuda`} className="text-xs text-tinta-suave">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Edita a ficha clinica. Salvar NAO sobrescreve: cria a versao seguinte,
 * e a anterior continua no historico (ADR-0015).
 */
export function FormularioFicha({ slug, pacienteId, atual }: { slug: string; pacienteId: string; atual: FichaClinicaResumo | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [alergias, setAlergias] = useState((atual?.alergias ?? []).join("\n"));
  const [negaAlergias, setNega] = useState(atual?.negaAlergias ?? false);
  const [medicamentos, setMedicamentos] = useState((atual?.medicamentosEmUso ?? []).join("\n"));
  const [comorbidades, setComorbidades] = useState(atual?.comorbidades ?? "");
  const [antecedentes, setAntecedentes] = useState(atual?.antecedentesFamiliares ?? "");
  const [cirurgias, setCirurgias] = useState(atual?.cirurgiasInternacoes ?? "");
  const [habitos, setHabitos] = useState(atual?.habitos ?? "");
  const [tipo, setTipo] = useState<string>(atual?.tipoSanguineo ?? "");
  const [observacoes, setObservacoes] = useState(atual?.observacoes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const r = await acaoNaApi<FichaClinicaResumo>(`/pacientes/${pacienteId}/ficha`, {
      metodo: "POST",
      clinica: slug,
      corpo: {
        alergias: negaAlergias ? [] : linhas(alergias),
        negaAlergias,
        medicamentosEmUso: linhas(medicamentos),
        comorbidades,
        antecedentesFamiliares: antecedentes,
        cirurgiasInternacoes: cirurgias,
        habitos,
        tipoSanguineo: tipo || null,
        observacoes,
      },
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro.mensagem);
      return;
    }
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <Botao variante="secundario" tamanho="p" onClick={() => setAberto(true)} icone={<Pencil className="h-4 w-4" aria-hidden="true" />}>
        {atual ? "Atualizar ficha" : "Preencher ficha"}
      </Botao>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-marinho/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="titulo-ficha">
      <form onSubmit={salvar} className="flex h-full w-full max-w-xl flex-col bg-superficie shadow-flutuante" noValidate>
        <div className="flex items-center justify-between border-b border-linha px-6 py-4">
          <div>
            <h2 id="titulo-ficha" className="text-lg">
              Ficha clínica
            </h2>
            <p className="text-xs text-tinta-suave">Salvar cria a versão {(atual?.versao ?? 0) + 1}; a anterior fica no histórico.</p>
          </div>
          <button type="button" onClick={() => setAberto(false)} className="rounded-lg p-2 text-tinta-suave hover:bg-marinho-suave" aria-label="Fechar">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <AreaDeTexto id="alergias" rotulo="Alergias" ajuda="Uma por linha. Ex.: Dipirona, Penicilina, Látex." valor={negaAlergias ? "" : alergias} mudar={setAlergias} linhas={2} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={negaAlergias} onChange={(e) => setNega(e.target.checked)} />
              Paciente nega alergias
            </label>
          </div>
          <AreaDeTexto id="medicamentos" rotulo="Medicamentos em uso" ajuda="Um por linha, com dose. Ex.: Losartana 50 mg - 1x ao dia." valor={medicamentos} mudar={setMedicamentos} />
          <AreaDeTexto id="comorbidades" rotulo="Doenças e condições" ajuda="Hipertensão, diabetes, asma..." valor={comorbidades} mudar={setComorbidades} />
          <AreaDeTexto id="antecedentes" rotulo="Antecedentes familiares" valor={antecedentes} mudar={setAntecedentes} linhas={2} />
          <AreaDeTexto id="cirurgias" rotulo="Cirurgias e internações" valor={cirurgias} mudar={setCirurgias} linhas={2} />
          <AreaDeTexto id="habitos" rotulo="Hábitos" ajuda="Tabagismo, álcool, atividade física, sono." valor={habitos} mudar={setHabitos} linhas={2} />
          <div className="space-y-1.5">
            <label htmlFor="tipo" className="block text-sm font-medium">
              Tipo sanguíneo
            </label>
            <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${CLASSE_CONTROLE} border-linha max-w-40`}>
              <option value="">Não informado</option>
              {TIPOS_SANGUINEOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <AreaDeTexto id="observacoes" rotulo="Observações" valor={observacoes} mudar={setObservacoes} linhas={2} />
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-linha px-6 py-4">
          <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
          <Botao type="submit" carregando={salvando}>
            Salvar nova versão
          </Botao>
        </div>
      </form>
    </div>
  );
}
