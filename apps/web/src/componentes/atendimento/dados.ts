import type { MedicoResumo, MeiosDePagamento, OpcoesDeAtendimento } from "@tele/shared";
import { chamarApi } from "@/lib/api";
import type { EstadoDaFila } from "@/app/c/[clinica]/pronto-atendimento/ProntoAtendimento";

const FILA_VAZIA: EstadoDaFila = { totalAguardando: 0, medicosDePlantao: 0, minhaPosicao: null, minhaConsultaId: null, minhaSituacao: null, esperaEstimadaMinutos: null };

/** O que as duas telas de atendimento do paciente precisam, numa ida so a API. */
export async function dadosDoAtendimento(slug: string, token: string) {
  const [opcoes, fila, meios] = await Promise.all([
    chamarApi<OpcoesDeAtendimento>("/atendimento/opcoes", { token, clinica: slug }),
    chamarApi<EstadoDaFila>("/fila", { token, clinica: slug }),
    chamarApi<MeiosDePagamento>("/cartoes", { token, clinica: slug }),
  ]);
  return {
    opcoes: opcoes.ok ? opcoes.dados : null,
    erro: opcoes.ok ? null : opcoes.erro.mensagem,
    fila: fila.ok ? fila.dados : FILA_VAZIA,
    cartao: meios.ok ? meios.dados.cartao : null,
  };
}

/** Medicos com CRM conferido que atendem esta linha (e esta especialidade). */
export async function medicosDaLinha(slug: string, token: string, linha: "pronto_atendimento" | "teleconsulta", especialidade?: string): Promise<MedicoResumo[]> {
  const q = new URLSearchParams({ linha, ...(especialidade ? { especialidade } : {}) });
  const r = await chamarApi<MedicoResumo[]>(`/medicos?${q}`, { token, clinica: slug });
  return r.ok ? r.dados.filter((m) => m.situacaoCrm === "verificado") : [];
}
