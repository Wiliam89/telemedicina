/**
 * Situacao do CRM de um medico NUMA clinica (ADR-0016), e a trava que as
 * rotas usam antes de deixar o medico agir como medico: emitir e assinar
 * documento, abrir plantao, aparecer para marcacao.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { verificacoesCrm, type Banco } from "@tele/db";
import type { SituacaoCrm } from "@tele/shared";
import { NOME_DA_SITUACAO_CRM, situacaoDoCrm } from "@tele/shared/crm";
import { ErroHttp } from "./erros.js";

/** Situacao de varios medicos de uma vez (uma consulta so). */
export async function situacoesCrm(banco: Banco, clinicaId: string, medicoIds: string[]): Promise<Map<string, SituacaoCrm>> {
  const mapa = new Map<string, SituacaoCrm>(medicoIds.map((id) => [id, "pendente"]));
  if (medicoIds.length === 0) return mapa;
  const linhas = await banco
    .select({ medicoId: verificacoesCrm.medicoId, resultado: verificacoesCrm.resultado, validoAte: verificacoesCrm.validoAte })
    .from(verificacoesCrm)
    .where(and(eq(verificacoesCrm.clinicaId, clinicaId), inArray(verificacoesCrm.medicoId, medicoIds)))
    .orderBy(desc(verificacoesCrm.criadoEm));
  const vistos = new Set<string>();
  for (const l of linhas) {
    if (vistos.has(l.medicoId)) continue; // so a mais recente de cada um
    vistos.add(l.medicoId);
    mapa.set(l.medicoId, situacaoDoCrm(l));
  }
  return mapa;
}

export async function situacaoCrm(banco: Banco, clinicaId: string, medicoId: string): Promise<SituacaoCrm> {
  return (await situacoesCrm(banco, clinicaId, [medicoId])).get(medicoId)!;
}

const PROXIMO_PASSO: Record<Exclude<SituacaoCrm, "verificado">, string> = {
  pendente: "A administração da clínica precisa conferir o CRM no Conselho (tela Equipe).",
  vencido: "A conferência anual do CRM venceu; a administração precisa conferir de novo (tela Equipe).",
  recusado: "A administração da clínica recusou o CRM informado. Confira o cadastro e fale com ela.",
};

/**
 * Recusa a acao se o CRM do medico nao estiver verificado nesta clinica.
 * `quem` muda a frase: o proprio medico, ou alguem tentando marcar com ele.
 */
export async function exigirCrmVerificado(banco: Banco, clinicaId: string, medicoId: string, quem: "proprio" | "terceiro" = "proprio"): Promise<void> {
  const s = await situacaoCrm(banco, clinicaId, medicoId);
  if (s === "verificado") return;
  throw new ErroHttp(
    403,
    "CRM_NAO_VERIFICADO",
    quem === "proprio"
      ? `${NOME_DA_SITUACAO_CRM[s]}. ${PROXIMO_PASSO[s]}`
      : "Este médico ainda não está disponível para atendimento nesta clínica.",
  );
}
