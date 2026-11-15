/**
 * =====================================================================
 * RETORNO, FALTA E AVALIACAO (ADR-0027)
 * =====================================================================
 *
 *   POST /consultas/:id/retorno    o medico libera o retorno sem custo (prazo em dias)
 *   POST /consultas/:id/falta      registra que o paciente ou o medico faltou
 *   POST /consultas/:id/avaliacao  o paciente da a nota (0 a 10) da consulta
 *   POST /consultas/:id/avaliacao/apagar-comentario   o paciente apaga o proprio comentario (LGPD)
 *
 * O retorno em si e marcado em POST /consultas, com `retornoDe` (agenda.ts).
 */
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditoria, avaliacoesConsulta, clinicas, consultas, filaAtendimento, pagamentos, perfis, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { PRAZO_DE_RETORNO_TETO_DIAS, PRAZO_SUGERIDO_SEM_CONFIGURACAO, podeRegistrarFalta, prazoDeRetornoValido, retornoAte, TOLERANCIA_DE_FALTA_MINUTOS } from "@tele/shared/retorno";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";
import { fusoDaClinica, notificar } from "../notificacoes/index.js";
import { registrarPendenciaDeEstorno } from "../reservas.js";

/** Ate quantos dias depois da consulta o medico ainda pode liberar o retorno (exames demoram). */
const DIAS_PARA_LIBERAR_RETORNO = 90;
/** Ate quantos dias depois da consulta o paciente ainda pode avaliar. */
const DIAS_PARA_AVALIAR = 30;
const DIA = 86400000;

const idDaRota = z.object({ id: z.string().uuid("id inválido") });

export async function rotasRetorno(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];

  async function consulta(id: string, clinicaId: string) {
    const [c] = await banco
      .select({
        id: consultas.id,
        status: consultas.status,
        inicio: consultas.inicio,
        medicoId: consultas.medicoId,
        pacienteId: consultas.pacienteId,
        retornoDe: consultas.retornoDe,
        retornoAte: consultas.retornoAte,
      })
      .from(consultas)
      .where(and(eq(consultas.id, id), eq(consultas.clinicaId, clinicaId)))
      .limit(1);
    if (!c) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta não encontrada.");
    return c;
  }

  // --- retorno sem custo -----------------------------------------------------------

  app.post("/consultas/:id/retorno", { preHandler: soMedico }, async (req): Promise<Resposta<{ retornoAte: string }>> => {
    const { id } = idDaRota.parse(req.params);
    // Sem "dias", vale o prazo sugerido pela plataforma. Quem decide e o medico.
    const corpo = z.object({ dias: z.number().int("o prazo é em dias inteiros").optional() }).strict().parse(req.body ?? {});
    const c = await consulta(id, req.contexto.clinicaId);

    if (c.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU_ATENDIMENTO", "Só o médico que atendeu libera o retorno.");
    // Resolucao CFM 1.958/2010, art. 2: sinal ou sintoma novo no retorno e consulta nova.
    if (c.retornoDe) throw new ErroHttp(409, "RETORNO_DE_RETORNO", "Esta consulta já é um retorno. Se houver queixa nova, o paciente marca uma nova consulta.");
    if (c.status !== "em_andamento" && c.status !== "concluida") throw new ErroHttp(409, "CONSULTA_NAO_REALIZADA", "O retorno só pode ser liberado numa consulta em andamento ou concluída.");
    if (Date.now() - c.inicio.getTime() > DIAS_PARA_LIBERAR_RETORNO * DIA) {
      throw new ErroHttp(409, "PRAZO_PARA_LIBERAR", `O retorno só pode ser liberado até ${DIAS_PARA_LIBERAR_RETORNO} dias depois da consulta.`);
    }

    /**
     * O prazo e do MEDICO (Resolucao CFM 1.958/2010, art. 1, par. 1; art. 4).
     * A plataforma so sugere um padrao (clinicas.retorno_prazo_maximo_dias,
     * hoje lido como "prazo sugerido") e tem um teto tecnico alto.
     */
    const [cl] = await banco.select({ sugerido: clinicas.retornoPrazoMaximoDias }).from(clinicas).where(eq(clinicas.id, req.contexto.clinicaId)).limit(1);
    const dias = corpo.dias ?? (cl?.sugerido || PRAZO_SUGERIDO_SEM_CONFIGURACAO);
    if (!prazoDeRetornoValido(dias)) throw new ErroHttp(400, "PRAZO_INVALIDO", `Escolha um prazo de 1 a ${PRAZO_DE_RETORNO_TETO_DIAS} dias.`);

    const [jaMarcado] = await banco
      .select({ id: consultas.id })
      .from(consultas)
      .where(and(eq(consultas.retornoDe, id), ne(consultas.status, "cancelada")))
      .limit(1);
    if (jaMarcado) throw new ErroHttp(409, "RETORNO_JA_MARCADO", "O paciente já marcou este retorno.");

    const ate = retornoAte(new Date(), dias);
    await banco.transaction(async (tx) => {
      await tx.update(consultas).set({ retornoAte: ate, atualizadoEm: new Date() }).where(eq(consultas.id, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "consulta.retorno_liberado",
        tabela: "consultas",
        registroId: id,
        detalhes: { dias, de: c.retornoAte?.toISOString() ?? null },
        ip: req.ip,
      });
    });

    const local = await fusoDaClinica(banco, req.contexto.clinicaId);
    const [medico] = await banco.select({ nome: perfis.nomeCompleto }).from(perfis).where(eq(perfis.id, c.medicoId)).limit(1);
    const dataLimite = new Intl.DateTimeFormat("pt-BR", { timeZone: local.fuso, day: "2-digit", month: "2-digit", year: "numeric" }).format(ate);
    await notificar(banco, [
      {
        perfilId: c.pacienteId,
        clinicaId: req.contexto.clinicaId,
        tipo: "consulta_marcada",
        titulo: "Retorno sem custo liberado",
        corpo: `Dr(a). ${medico?.nome ?? ""} liberou seu retorno sem custo até ${dataLimite}. Marque em Minhas consultas.`,
        link: `/c/${local.slug}/retorno/${id}`,
        chave: `retorno_liberado:${id}:${ate.toISOString().slice(0, 10)}`,
      },
    ]);

    return { ok: true, dados: { retornoAte: ate.toISOString() } };
  });

  // --- falta -----------------------------------------------------------------------

  app.post("/consultas/:id/falta", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ status: "cancelada"; ausencia: "paciente" | "medico" }>> => {
    const { id } = idDaRota.parse(req.params);
    const { quem } = z.object({ quem: z.enum(["paciente", "medico"], { message: "diga quem faltou: paciente ou medico" }) }).strict().parse(req.body);
    const c = await consulta(id, req.contexto.clinicaId);

    const equipe = req.contexto.papeis.some((p) => p === "recepcao" || p === "admin_clinica");
    // Quem registra a falta e o OUTRO lado (ou a equipe): ninguem diz que ele mesmo faltou.
    const pode = quem === "paciente" ? c.medicoId === req.usuario.id || equipe : c.pacienteId === req.usuario.id || equipe;
    if (!pode) throw new ErroHttp(403, "NAO_PODE_REGISTRAR_FALTA", quem === "paciente" ? "Só o médico da consulta ou a equipe registram a falta do paciente." : "Só o paciente da consulta ou a equipe registram a falta do médico.");
    if (c.status !== "agendada") throw new ErroHttp(409, "FALTA_SO_EM_AGENDADA", "A falta só pode ser registrada numa consulta agendada que não começou.");
    if (!podeRegistrarFalta(c.inicio, new Date())) {
      throw new ErroHttp(409, "CEDO_PARA_FALTA", `Espere ${TOLERANCIA_DE_FALTA_MINUTOS} minutos depois do horário marcado para registrar a falta.`);
    }

    await banco.transaction(async (tx) => {
      // Trava a consulta: falta, "Iniciar" e entrada na sala nao se cruzam.
      const [agora] = await tx.select({ status: consultas.status }).from(consultas).where(eq(consultas.id, id)).for("update");
      if (agora?.status !== "agendada") throw new ErroHttp(409, "ESTADO_MUDOU", "Esta consulta acabou de mudar (o atendimento pode ter começado). Recarregue a página.");
      // Quem e acusado de faltar mas entrou na sala, nao faltou.
      const acusado = quem === "paciente" ? c.pacienteId : c.medicoId;
      const [entrou] = await tx
        .select({ id: auditoria.id })
        .from(auditoria)
        .where(and(eq(auditoria.acao, "video.entrou"), eq(auditoria.registroId, id), eq(auditoria.quem, acusado)))
        .limit(1);
      if (entrou) {
        throw new ErroHttp(409, "ENTROU_NA_SALA", quem === "paciente" ? "O paciente entrou na sala desta consulta: não é falta." : "O médico entrou na sala desta consulta: não é falta.");
      }
      const feitas = await tx
        .update(consultas)
        .set({
          status: "cancelada",
          ausencia: quem,
          canceladoEm: new Date(),
          canceladoPor: req.usuario.id,
          motivoCancelamento: quem === "paciente" ? "Paciente não compareceu" : "Médico não compareceu",
          expiraReservaEm: null,
          atualizadoEm: new Date(),
        })
        .where(and(eq(consultas.id, id), eq(consultas.status, "agendada")))
        .returning({ id: consultas.id });
      if (feitas.length === 0) throw new ErroHttp(409, "ESTADO_MUDOU", "Esta consulta acabou de mudar. Recarregue a página.");

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "consulta.falta_registrada",
        tabela: "consultas",
        registroId: id,
        detalhes: { quem },
        ip: req.ip,
      });

      // Falta do MEDICO: o paciente nao pode pagar por um atendimento que nao
      // houve. Fica a pendencia de estorno para a administracao (como no
      // cancelamento). Falta do PACIENTE nao gera estorno automatico: a regra
      // e da administracao (ADR-0027) e o cartao nao e debitado, porque so
      // consulta concluida e cobrada.
      if (quem === "medico") {
        const pagos = await tx.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.consultaId, id), inArray(pagamentos.status, ["confirmado", "autorizado"])));
        for (const pago of pagos) {
          await registrarPendenciaDeEstorno(tx, { clinicaId: req.contexto.clinicaId, pagamentoId: pago.id, pacienteId: c.pacienteId, consultaId: id, motivo: "o médico não compareceu", ip: req.ip });
        }
      }
      await tx
        .update(filaAtendimento)
        .set({ status: "desistiu", encerradoEm: new Date(), observacao: quem === "paciente" ? "paciente não compareceu" : "médico não compareceu" })
        .where(and(eq(filaAtendimento.consultaId, id), eq(filaAtendimento.status, "em_atendimento")));
    });

    const local = await fusoDaClinica(banco, req.contexto.clinicaId);
    await notificar(
      banco,
      [c.pacienteId, c.medicoId]
        .filter((p) => p !== req.usuario.id)
        .map((perfilId) => ({
          perfilId,
          clinicaId: req.contexto.clinicaId,
          tipo: "consulta_cancelada" as const,
          titulo: quem === "paciente" ? "Falta do paciente registrada" : "Falta do médico registrada",
          corpo:
            quem === "medico" && perfilId === c.pacienteId
              ? "Registramos que o médico não compareceu. Se você pagou, a devolução será analisada pela plataforma."
              : "A consulta foi encerrada por falta.",
          link: `/c/${local.slug}/agenda`,
          chave: `falta:${id}`,
        })),
    );
    return { ok: true, dados: { status: "cancelada", ausencia: quem } };
  });

  // --- avaliacao ---------------------------------------------------------------------

  app.post("/consultas/:id/avaliacao", { preHandler: dentroDaClinica, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply): Promise<Resposta<{ nota: number }>> => {
    const { id } = idDaRota.parse(req.params);
    const dados = z
      .object({
        nota: z.number().int("a nota é um número inteiro").min(0, "a nota vai de 0 a 10").max(10, "a nota vai de 0 a 10"),
        comentario: z.string().trim().max(500, "comentário com no máximo 500 letras").optional(),
      })
      .strict()
      .parse(req.body);
    const c = await consulta(id, req.contexto.clinicaId);
    if (c.pacienteId !== req.usuario.id) throw new ErroHttp(403, "SO_O_PACIENTE", "Só o paciente da consulta pode avaliá-la.");
    if (c.status !== "concluida") throw new ErroHttp(409, "CONSULTA_NAO_CONCLUIDA", "Só dá para avaliar uma consulta concluída.");
    if (Date.now() - c.inicio.getTime() > DIAS_PARA_AVALIAR * DIA) throw new ErroHttp(409, "PRAZO_PARA_AVALIAR", `A avaliação fica aberta por ${DIAS_PARA_AVALIAR} dias depois da consulta.`);

    try {
      await banco.transaction(async (tx) => {
        await tx.insert(avaliacoesConsulta).values({
          clinicaId: req.contexto.clinicaId,
          consultaId: id,
          pacienteId: c.pacienteId,
          medicoId: c.medicoId,
          nota: dados.nota,
          comentario: dados.comentario ? dados.comentario : null,
        });
        // A nota vai para a auditoria; o comentario, nao (texto livre do paciente).
        await registrarAuditoria(tx, {
          quem: req.usuario.id,
          clinicaId: req.contexto.clinicaId,
          acao: "consulta.avaliada",
          tabela: "avaliacoes_consulta",
          registroId: id,
          detalhes: { nota: dados.nota },
          ip: req.ip,
        });
      });
    } catch (erro) {
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      if (codigo === "23505") throw new ErroHttp(409, "JA_AVALIADA", "Você já avaliou esta consulta. Obrigado!");
      throw erro;
    }
    void reply.code(201);
    return { ok: true, dados: { nota: dados.nota } };
  });

  // LGPD, art. 18: o comentario e texto livre do paciente; ele pode apaga-lo (a nota fica).
  app.post("/consultas/:id/avaliacao/apagar-comentario", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ apagado: true }>> => {
    const { id } = idDaRota.parse(req.params);
    const feitas = await banco
      .update(avaliacoesConsulta)
      .set({ comentario: null })
      .where(and(eq(avaliacoesConsulta.consultaId, id), eq(avaliacoesConsulta.clinicaId, req.contexto.clinicaId), eq(avaliacoesConsulta.pacienteId, req.usuario.id), isNotNull(avaliacoesConsulta.comentario)))
      .returning({ id: avaliacoesConsulta.id });
    if (feitas.length === 0) throw new ErroHttp(404, "SEM_COMENTARIO", "Não há comentário seu nesta consulta para apagar.");
    return { ok: true, dados: { apagado: true } };
  });
}
