/**
 * RESTRICAO DE PACIENTE (ADR-0027)
 *
 * A administracao pode impedir um paciente de MARCAR consulta e de entrar na
 * FILA (fraude, abuso, calote repetido). So isso: ele continua entrando para
 * ver os proprios documentos, as consultas ja marcadas e os direitos da LGPD.
 */
import { and, eq, isNull } from "drizzle-orm";
import { restricoesPacientes, type Banco } from "@tele/db";
import { ErroHttp } from "./erros.js";

type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

export async function exigirSemRestricao(b: Executor, clinicaId: string, pacienteId: string): Promise<void> {
  const [r] = await b
    .select({ id: restricoesPacientes.id })
    .from(restricoesPacientes)
    .where(and(eq(restricoesPacientes.clinicaId, clinicaId), eq(restricoesPacientes.pacienteId, pacienteId), isNull(restricoesPacientes.encerradoEm)))
    .limit(1);
  if (r) {
    throw new ErroHttp(403, "PACIENTE_COM_RESTRICAO", "Não é possível marcar novos atendimentos nesta conta no momento. Fale com o suporte da plataforma para entender o motivo.");
  }
}
