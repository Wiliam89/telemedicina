/**
 * =====================================================================
 * MANUTENCAO DA AGENDA E DA FILA
 * =====================================================================
 *
 * Roda no agendador (a cada minuto) e antes de marcar uma consulta. Tudo aqui
 * e seguro com varias copias da API: cada UPDATE tem a condicao de estado no
 * proprio WHERE, entao so uma copia "ganha" cada linha.
 *
 * POR QUE A RESERVA PRECISA SER LIBERADA DE VERDADE: a trava de exclusao do
 * banco conta toda consulta em aguardando_pagamento, vencida ou nao. Sem
 * cancelar a vencida, a agenda mostra o horario livre, mas marcar falha para
 * sempre com "acabou de ser ocupado".
 *
 * ESTORNO NAO E AUTOMATICO (ADR-0012): a politica e da clinica. Quando ha
 * dinheiro envolvido, o que acontece aqui e registrar a pendencia e avisar.
 */
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { auditoria, consultas, filaAtendimento, vinculos, type Banco } from "@tele/db";
import { registrarAuditoria } from "./auditoria.js";
import { notificar } from "./notificacoes/index.js";

export type Transacao = Parameters<Parameters<Banco["transaction"]>[0]>[0];

/** O mesmo texto marca a reserva vencida e permite reativa-la num pagamento tardio. */
export const MOTIVO_RESERVA_VENCIDA = "pagamento nao confirmado";

const MINUTOS_ATE_EXPIRAR_NA_FILA = 120;
const HORAS_ATE_ENCERRAR_ATENDIMENTO = 6;

/** Cancela as reservas vencidas: todas, ou so as que envolvem este medico ou paciente. */
export async function liberarReservasVencidas(banco: Banco | Transacao, escopo?: { medicoId: string; pacienteId: string }): Promise<number> {
  // Tudo junto: se o processo cair no meio, o aviso nao se perde.
  return banco.transaction(async (b) => {
  const agora = new Date();
  const liberadas = await b
    .update(consultas)
    .set({ status: "cancelada", canceladoEm: agora, motivoCancelamento: MOTIVO_RESERVA_VENCIDA, expiraReservaEm: null, atualizadoEm: agora })
    .where(
      and(
        eq(consultas.status, "aguardando_pagamento"),
        lt(consultas.expiraReservaEm, agora),
        escopo ? or(eq(consultas.medicoId, escopo.medicoId), eq(consultas.pacienteId, escopo.pacienteId)) : undefined,
      ),
    )
    .returning({ id: consultas.id, clinicaId: consultas.clinicaId, pacienteId: consultas.pacienteId });

  for (const c of liberadas) {
    await registrarAuditoria(b, { quem: null, clinicaId: c.clinicaId, acao: "consulta.reserva_vencida", tabela: "consultas", registroId: c.id });
    await notificar(b, {
      perfilId: c.pacienteId,
      clinicaId: c.clinicaId,
      tipo: "consulta_cancelada",
      titulo: "Sua reserva de horário venceu",
      corpo: "O pagamento não foi confirmado a tempo e o horário voltou a ficar livre. Você pode marcar novamente.",
      link: null,
      chave: `reserva_vencida:${c.id}`,
    });
  }
  return liberadas.length;
  });
}

/** Dinheiro recebido sem atendimento: fica registrado e a administracao e avisada. */
export async function registrarPendenciaDeEstorno(
  b: Banco | Transacao,
  d: { clinicaId: string; pagamentoId: string; pacienteId: string; motivo: string; consultaId?: string; ip?: string },
): Promise<void> {
  // O mesmo aviso do provedor chega varias vezes: a pendencia e uma so.
  const [existente] = await b
    .select({ id: auditoria.id })
    .from(auditoria)
    .where(and(eq(auditoria.acao, "pagamento.pendente_de_estorno"), eq(auditoria.registroId, d.pagamentoId)))
    .limit(1);
  if (existente) return;

  await registrarAuditoria(b, {
    quem: null,
    clinicaId: d.clinicaId,
    acao: "pagamento.pendente_de_estorno",
    tabela: "pagamentos",
    registroId: d.pagamentoId,
    detalhes: { motivo: d.motivo, consultaId: d.consultaId ?? null, paciente: d.pacienteId, pendenteDeEstorno: true },
    ...(d.ip ? { ip: d.ip } : {}),
  });
  const administradores = await b
    .select({ perfilId: vinculos.perfilId })
    .from(vinculos)
    .where(and(eq(vinculos.clinicaId, d.clinicaId), eq(vinculos.papel, "admin_clinica"), eq(vinculos.status, "ativo")));
  await notificar(b, [
    {
      perfilId: d.pacienteId,
      clinicaId: d.clinicaId,
      tipo: "consulta_cancelada",
      titulo: "Seu pagamento precisa de atenção",
      corpo: "Recebemos seu pagamento, mas o atendimento não está mais marcado. A clínica foi avisada e vai falar com você sobre o reembolso.",
      link: null,
      chave: `pendente_de_estorno:${d.pagamentoId}`,
    },
    ...administradores.map((a) => ({
      perfilId: a.perfilId,
      clinicaId: d.clinicaId,
      tipo: "consulta_cancelada" as const,
      titulo: "Reembolso pendente",
      corpo: "Um pagamento foi recebido para um atendimento que não vai acontecer. Fale com o paciente sobre o reembolso.",
      link: null,
      chave: `pendente_de_estorno:${d.pagamentoId}`,
    })),
  ]);
}

/** Quem entrou e nunca foi chamado nao pode ficar esperando para sempre. */
export async function expirarEsquecidosDaFila(banco: Banco, clinicaId?: string): Promise<number> {
  return banco.transaction(async (b) => {
  const limite = new Date(Date.now() - MINUTOS_ATE_EXPIRAR_NA_FILA * 60000);
  const expirados = await b
    .update(filaAtendimento)
    .set({ status: "expirado", encerradoEm: new Date(), observacao: "tempo de espera excedido" })
    .where(and(eq(filaAtendimento.status, "aguardando"), lt(filaAtendimento.entrouEm, limite), clinicaId ? eq(filaAtendimento.clinicaId, clinicaId) : undefined))
    .returning({ id: filaAtendimento.id, clinicaId: filaAtendimento.clinicaId, pacienteId: filaAtendimento.pacienteId, pagamentoId: filaAtendimento.pagamentoId });

  for (const f of expirados) {
    await registrarPendenciaDeEstorno(b, { clinicaId: f.clinicaId, pagamentoId: f.pagamentoId, pacienteId: f.pacienteId, motivo: "fila: tempo de espera excedido" });
  }
  return expirados.length;
  });
}

/**
 * Atendimento de plantao sem desfecho: consulta ja encerrada, ou tempo demais
 * sem ninguem concluir. Preso aqui, o paciente nao volta para a fila
 * (JA_NA_FILA) e o medico nao fecha o plantao (ATENDIMENTO_EM_CURSO).
 */
export async function encerrarAtendimentosAbandonados(b: Banco): Promise<number> {
  const limite = new Date(Date.now() - HORAS_ATE_ENCERRAR_ATENDIMENTO * 3600000);
  const encerrados = await b
    .update(filaAtendimento)
    .set({ status: "atendido", encerradoEm: new Date(), observacao: "encerrado automaticamente" })
    .where(
      and(
        eq(filaAtendimento.status, "em_atendimento"),
        or(
          lt(filaAtendimento.chamadoEm, limite),
          inArray(filaAtendimento.consultaId, sql`(select id from consultas where status = 'concluida')`),
        ),
      ),
    )
    .returning({ id: filaAtendimento.id, clinicaId: filaAtendimento.clinicaId });

  for (const f of encerrados) {
    await registrarAuditoria(b, { quem: null, clinicaId: f.clinicaId, acao: "fila.encerrada_automaticamente", tabela: "fila_atendimento", registroId: f.id });
  }
  return encerrados.length;
}

/** O que o agendador roda a cada minuto, alem dos avisos. */
export async function rodarManutencao(b: Banco): Promise<{ reservas: number; fila: number; atendimentos: number }> {
  return {
    reservas: await liberarReservasVencidas(b),
    fila: await expirarEsquecidosDaFila(b),
    atendimentos: await encerrarAtendimentosAbandonados(b),
  };
}
