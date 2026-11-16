/**
 * PRESENCA NA SALA (ADR-0027)
 *
 * A entrada na sala de video fica na auditoria (`video.entrou`). E ela que diz
 * se alguem esteve no atendimento: quem entrou nao faltou, e consulta paga no
 * cartao ao final so e concluida (e cobrada) se o paciente entrou.
 */
import { and, eq } from "drizzle-orm";
import { auditoria, consultas, type Banco } from "@tele/db";
import { ErroHttp } from "./erros.js";

type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

export async function entrouNaSala(b: Executor, consultaId: string, perfilId: string): Promise<boolean> {
  const [e] = await b
    .select({ id: auditoria.id })
    .from(auditoria)
    .where(and(eq(auditoria.tabela, "salas_de_video"), eq(auditoria.registroId, consultaId), eq(auditoria.acao, "video.entrou"), eq(auditoria.quem, perfilId)))
    .limit(1);
  return Boolean(e);
}

/**
 * Decisao do Wiliam (ADR-0027): consulta com cartao debitado ao final NAO se
 * conclui se o paciente nunca entrou na sala - concluir cobraria quem nao foi
 * atendido. O caminho certo, nesse caso, e registrar a falta.
 */
export async function exigirPacienteParaConcluir(b: Executor, consultaId: string): Promise<void> {
  const [c] = await b.select({ pacienteId: consultas.pacienteId, forma: consultas.formaDeCobranca }).from(consultas).where(eq(consultas.id, consultaId)).limit(1);
  if (!c || c.forma !== "cartao_ao_final") return;
  if (!(await entrouNaSala(b, consultaId, c.pacienteId))) {
    throw new ErroHttp(409, "PACIENTE_NAO_ENTROU", "O paciente não entrou na sala, então a consulta não pode ser concluída (o cartão dele seria cobrado). Se ele não veio, use “Paciente faltou”.");
  }
}
