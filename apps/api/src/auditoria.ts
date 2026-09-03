/**
 * Trilha de auditoria (ADR-0005): toda acao relevante grava uma linha em
 * `auditoria`. A API escreve com a chave secreta (ignora o RLS), por isso
 * ela e a unica que pode registrar em nome do sistema (quem = null).
 *
 * Regra: nunca coloque dado clinico em `detalhes`. So o que mudou em termos
 * de campos nao sensiveis (ex.: { papel: "paciente" }).
 */
import { auditoria, type Banco } from "@tele/db";

export interface RegistroAuditoria {
  quem: string | null;
  /** Em qual clinica. Nulo so para acoes fora de clinica (criar perfil). */
  clinicaId: string | null;
  /** Sempre "coisa.acao": perfil.criado, consulta.cancelada, prontuario.lido */
  acao: `${string}.${string}`;
  tabela: string;
  registroId: string;
  detalhes?: Record<string, unknown>;
  ip?: string;
}

/** `tx` pode ser o banco ou uma transacao - assim o registro entra junto com a acao. */
export async function registrarAuditoria(tx: Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0], r: RegistroAuditoria): Promise<void> {
  await tx.insert(auditoria).values({
    quem: r.quem,
    clinicaId: r.clinicaId,
    acao: r.acao,
    tabela: r.tabela,
    registroId: r.registroId,
    detalhes: r.detalhes ?? null,
    ip: r.ip ?? null,
  });
}
