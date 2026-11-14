/**
 * =====================================================================
 * LINHAS DE ATENDIMENTO (ADR-0024)
 * =====================================================================
 *
 *   GET /atendimento/opcoes        o que o paciente pode escolher, e por quanto
 *   PUT /medicos/:id/atendimento   a administracao define o que o medico atende
 *
 * Duas linhas, cada uma com o modo imediato e o agendado:
 *   pronto atendimento - clinico geral, sem escolher especialidade
 *   teleconsulta       - especialista: o paciente escolhe a especialidade
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { medicos, precos, vinculos, type Banco } from "@tele/db";
import type { OpcoesDeAtendimento, Resposta } from "@tele/shared";
import { ESPECIALIDADES, especialidadeExiste, normalizarEspecialidades, tipoDePreco } from "@tele/shared/atendimento";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { situacoesCrm } from "../crm.js";
import { ErroHttp } from "../erros.js";
import { escolherPreco } from "../pagamento/index.js";

export async function rotasAtendimento(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);

  /**
   * A vitrine. So aparece especialidade que tem ao menos um medico apto (CRM
   * e especialidade conferidos): oferecer o que ninguem atende e prometer o
   * que nao sera cumprido.
   */
  app.get("/atendimento/opcoes", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<OpcoesDeAtendimento>> => {
    const equipe = await banco
      .select({
        id: medicos.perfilId,
        especialidades: medicos.especialidades,
        atendeProntoAtendimento: medicos.atendeProntoAtendimento,
        online: sql<boolean>`exists (select 1 from plantoes p where p.medico_id = ${medicos.perfilId} and p.clinica_id = ${req.contexto.clinicaId} and p.status = 'aberto' and p.fim >= now())`,
      })
      .from(vinculos)
      .innerJoin(medicos, eq(medicos.perfilId, vinculos.perfilId))
      .where(and(eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico"), eq(vinculos.status, "ativo")));
    const situacoes = await situacoesCrm(banco, req.contexto.clinicaId, equipe.map((m) => m.id));
    const aptos = equipe.filter((m) => situacoes.get(m.id) === "verificado");

    const tabela = await banco
      .select({ tipo: precos.tipo, valorCentavos: precos.valorCentavos, comissaoPlataformaBps: precos.comissaoPlataformaBps, medicoId: precos.medicoId, especialidade: precos.especialidade })
      .from(precos)
      .where(eq(precos.clinicaId, req.contexto.clinicaId));
    // Na vitrine vale o preco da especialidade ou o padrao; o preco de um medico especifico aparece ao escolhe-lo.
    const valor = (linha: "pronto_atendimento" | "teleconsulta", modo: "imediato" | "agendado", especialidade: string | null) =>
      escolherPreco(tabela.filter((p) => p.tipo === tipoDePreco(linha, modo)), null, especialidade)?.valorCentavos ?? null;

    const doPronto = aptos.filter((m) => m.atendeProntoAtendimento);
    return {
      ok: true,
      dados: {
        prontoAtendimento: {
          medicos: doPronto.length,
          online: doPronto.filter((m) => m.online).length,
          valorImediatoCentavos: valor("pronto_atendimento", "imediato", null),
          valorAgendadoCentavos: valor("pronto_atendimento", "agendado", null),
        },
        especialidades: ESPECIALIDADES.map((e) => {
          const dela = aptos.filter((m) => m.especialidades.includes(e.codigo));
          return {
            ...e,
            medicos: dela.length,
            online: dela.filter((m) => m.online).length,
            valorImediatoCentavos: valor("teleconsulta", "imediato", e.codigo),
            valorAgendadoCentavos: valor("teleconsulta", "agendado", e.codigo),
          };
        }).filter((e) => e.medicos > 0),
      },
    };
  });

  /**
   * O que o medico atende e decisao da administracao, que confere o registro
   * de especialista. O medico pede (no credenciamento); nao decide.
   */
  app.put("/medicos/:id/atendimento", { preHandler: [...dentroDaClinica, exigirPapel("admin_clinica")] }, async (req): Promise<Resposta<{ especialidades: string[]; atendeProntoAtendimento: boolean }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const dados = z
      .object({
        especialidades: z.array(z.string().refine(especialidadeExiste, "especialidade desconhecida")).max(6, "no máximo 6 especialidades").transform(normalizarEspecialidades),
        atendeProntoAtendimento: z.boolean(),
      })
      .parse(req.body);

    const [m] = await banco
      .select({ especialidades: medicos.especialidades, atendeProntoAtendimento: medicos.atendeProntoAtendimento })
      .from(vinculos)
      .innerJoin(medicos, eq(medicos.perfilId, vinculos.perfilId))
      .where(and(eq(vinculos.perfilId, id), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico"), eq(vinculos.status, "ativo")))
      .limit(1);
    if (!m) throw new ErroHttp(404, "MEDICO_NAO_ENCONTRADO", "Médico não encontrado nesta clínica.");

    await banco.transaction(async (tx) => {
      await tx.update(medicos).set({ especialidades: dados.especialidades, atendeProntoAtendimento: dados.atendeProntoAtendimento }).where(eq(medicos.perfilId, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "medico.atendimento_alterado",
        tabela: "medicos",
        registroId: id,
        detalhes: { de: m, para: dados },
        ip: req.ip,
      });
    });
    return { ok: true, dados };
  });
}
