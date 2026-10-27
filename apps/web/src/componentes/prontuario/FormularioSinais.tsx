"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { SinalVitalResumo } from "@tele/shared";
import { Aviso } from "../Aviso";
import { Botao } from "../Botao";
import { Campo } from "../Campo";
import { acaoNaApi } from "@/lib/navegador";

const CAMPOS = [
  { chave: "pesoKg", rotulo: "Peso", unidade: "kg", passo: "0.1" },
  { chave: "alturaCm", rotulo: "Altura", unidade: "cm", passo: "1" },
  { chave: "pressaoSistolica", rotulo: "PA sistólica", unidade: "mmHg", passo: "1" },
  { chave: "pressaoDiastolica", rotulo: "PA diastólica", unidade: "mmHg", passo: "1" },
  { chave: "frequenciaCardiaca", rotulo: "Freq. cardíaca", unidade: "bpm", passo: "1" },
  { chave: "frequenciaRespiratoria", rotulo: "Freq. respiratória", unidade: "irpm", passo: "1" },
  { chave: "temperaturaC", rotulo: "Temperatura", unidade: "°C", passo: "0.1" },
  { chave: "saturacaoO2", rotulo: "Saturação O₂", unidade: "%", passo: "1" },
  { chave: "glicemiaMgDl", rotulo: "Glicemia", unidade: "mg/dL", passo: "1" },
] as const;

type Chave = (typeof CAMPOS)[number]["chave"];

/**
 * Registrar uma medida. O medico registra durante a consulta; o paciente
 * pode informar o que mediu em casa (pressao, glicemia) - fica marcado
 * como "informado pelo paciente" e o medico sabe a diferenca.
 */
export function FormularioSinais({ slug, pacienteId, consultaId, compacto }: { slug: string; pacienteId: string; consultaId?: string; compacto?: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(Boolean(compacto));
  const [valores, setValores] = useState<Partial<Record<Chave, string>>>({});
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(false);
    setSalvando(true);
    const corpo: Record<string, unknown> = { observacao: observacao || null, ...(consultaId ? { consultaId } : {}) };
    for (const c of CAMPOS) {
      const v = valores[c.chave]?.replace(",", ".").trim();
      corpo[c.chave] = v ? Number(v) : null;
    }
    const r = await acaoNaApi<SinalVitalResumo>(`/pacientes/${pacienteId}/sinais`, { metodo: "POST", clinica: slug, corpo });
    setSalvando(false);
    if (!r.ok) {
      const detalhes = Array.isArray(r.erro.detalhes) ? (r.erro.detalhes as { problema: string }[]).map((d) => d.problema).join(" ") : "";
      setErro(detalhes || r.erro.mensagem);
      return;
    }
    setValores({});
    setObservacao("");
    setOk(true);
    if (!compacto) setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <Botao tamanho="p" onClick={() => setAberto(true)} icone={<Plus className="h-4 w-4" aria-hidden="true" />}>
        Registrar medida
      </Botao>
    );
  }

  return (
    <form onSubmit={salvar} className="space-y-4" noValidate>
      <div className={`grid gap-3 ${compacto ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
        {CAMPOS.map((c) => (
          <Campo
            key={c.chave}
            id={`sv-${c.chave}`}
            rotulo={`${c.rotulo} (${c.unidade})`}
            type="number"
            inputMode="decimal"
            step={c.passo}
            value={valores[c.chave] ?? ""}
            onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
          />
        ))}
      </div>
      <Campo id="sv-obs" rotulo="Observação (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">Medida registrada.</Aviso> : null}
      <div className="flex gap-2">
        <Botao type="submit" carregando={salvando}>
          Salvar medida
        </Botao>
        {!compacto ? (
          <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
        ) : null}
      </div>
    </form>
  );
}
