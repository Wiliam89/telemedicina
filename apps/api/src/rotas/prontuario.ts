/**
 * =====================================================================
 * ROTAS DO PRONTUARIO
 * =====================================================================
 *
 *   POST  /consultas/:id/evolucao       abre o rascunho (o medico da consulta)
 *   PATCH /evolucoes/:id                edita o rascunho
 *   POST  /evolucoes/:id/finalizar      finaliza: a partir daqui, imutavel
 *   POST  /evolucoes/:id/adendo         corrige uma finalizada, sem apagar nada
 *   GET   /pacientes/:id/prontuario     o historico do paciente nesta clinica
 *
 * REGRA DE ACESSO, mais estreita que a das outras tabelas: recepcao e
 * administracao NAO leem evolucao clinica. Elas agendam, cobram e
 * organizam - nao precisam saber o que o paciente tem. E a necessidade
 * (LGPD art. 6, III) virando codigo, e o RLS repete a mesma regra embaixo.
 *
 * TODA LEITURA DE PRONTUARIO GERA AUDITORIA. Nao e exagero: a Resolucao
 * CFM 1.821/2007 exige log de auditoria, e "quem abriu o prontuario de
 * quem" e a pergunta que uma pericia faz primeiro.
 */
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consultas, evolucoes, medicos, perfis, type Banco } from "@tele/db";
import type { EvolucaoResumo, Resposta } from "@tele/shared";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

export const esquemaSoap = z.object({
  subjetivo: z.string().trim().max(5000).optional(),
  objetivo: z.string().trim().max(5000).optional(),
  avaliacao: z.string().trim().max(5000).optional(),
  plano: z.string().trim().max(5000).optional(),
  cid10: z.string().trim().regex(/^[A-Z]\d{2}(\.\d)?$/, "CID-10 no formato A00 ou A00.0").optional(),
});

export const esquemaAdendo = esquemaSoap.refine(
  (v) => Object.values(v).some((x) => x && String(x).trim() !== ""),
  "o adendo precisa dizer alguma coisa",
);

export async function rotasProntuario(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];

  /** Confere que a evolucao existe, e desta clinica, e e do medico logado. */
  async function minhaEvolucao(id: string, clinicaId: string, medicoId: string) {
    const [e] = await banco.select().from(evolucoes).where(and(eq(evolucoes.id, id), eq(evolucoes.clinicaId, clinicaId))).limit(1);
    if (!e) throw new ErroHttp(404, "EVOLUCAO_NAO_ENCONTRADA", "Evolucao nao encontrada nesta clinica.");
    if (e.medicoId !== medicoId) throw new ErroHttp(403, "NAO_E_SUA", "So quem escreveu a evolucao pode altera-la.");
    return e;
  }

  app.post("/consultas/:id/evolucao", { preHandler: soMedico }, async (req, reply): Promise<Resposta<{ id: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);

    const [consulta] = await banco
      .select({ id: consultas.id, pacienteId: consultas.pacienteId, medicoId: consultas.medicoId, status: consultas.status })
      .from(consultas)
      .where(and(eq(consultas.id, id), eq(consultas.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta nao encontrada nesta clinica.");
    if (consulta.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU_ATENDIMENTO", "So o medico da consulta escreve o prontuario dela.");
    if (consulta.status === "cancelada") throw new ErroHttp(409, "CONSULTA_CANCELADA", "Consulta cancelada nao gera prontuario.");

    // Uma evolucao principal por consulta (adendos vem depois, com adendo_de).
    const [existente] = await banco
      .select({ id: evolucoes.id })
      .from(evolucoes)
      .where(and(eq(evolucoes.consultaId, id), isNull(evolucoes.adendoDe)))
      .limit(1);
    if (existente) return { ok: true, dados: { id: existente.id } };

    const [criada] = await banco
      .insert(evolucoes)
      .values({
        clinicaId: req.contexto.clinicaId,
        consultaId: id,
        pacienteId: consulta.pacienteId,
        medicoId: req.usuario.id,
      })
      .returning({ id: evolucoes.id });

    void reply.code(201);
    return { ok: true, dados: { id: criada!.id } };
  });

  app.patch("/evolucoes/:id", { preHandler: soMedico }, async (req): Promise<Resposta<EvolucaoResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const dados = esquemaSoap.parse(req.body);

    const atual = await minhaEvolucao(id, req.contexto.clinicaId, req.usuario.id);
    if (atual.status === "finalizada") {
      throw new ErroHttp(409, "EVOLUCAO_FINALIZADA", "Esta evolucao ja foi finalizada e nao pode ser alterada. Registre um adendo.");
    }

    await banco
      .update(evolucoes)
      .set({
        subjetivo: dados.subjetivo ?? atual.subjetivo,
        objetivo: dados.objetivo ?? atual.objetivo,
        avaliacao: dados.avaliacao ?? atual.avaliacao,
        plano: dados.plano ?? atual.plano,
        cid10: dados.cid10 ?? atual.cid10,
      })
      .where(eq(evolucoes.id, id));

    const [atualizada] = await buscarEvolucoes(banco, [id]);
    return { ok: true, dados: atualizada! };
  });

  app.post("/evolucoes/:id/finalizar", { preHandler: soMedico }, async (req): Promise<Resposta<EvolucaoResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const atual = await minhaEvolucao(id, req.contexto.clinicaId, req.usuario.id);
    if (atual.status === "finalizada") throw new ErroHttp(409, "JA_FINALIZADA", "Esta evolucao ja estava finalizada.");

    const vazia = ![atual.subjetivo, atual.objetivo, atual.avaliacao, atual.plano].some((c) => c && c.trim() !== "");
    if (vazia) throw new ErroHttp(400, "EVOLUCAO_VAZIA", "Escreva ao menos um campo (S, O, A ou P) antes de finalizar.");

    await banco.transaction(async (tx) => {
      // A hora da finalizacao e carimbada pelo gatilho, nao aqui: quem
      // decide "quando foi" e o banco, nao o relogio de quem chamou.
      await tx.update(evolucoes).set({ status: "finalizada" }).where(eq(evolucoes.id, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "prontuario.finalizado",
        tabela: "evolucoes",
        registroId: id,
        detalhes: { consultaId: atual.consultaId, pacienteId: atual.pacienteId },
        ip: req.ip,
      });
    });

    const [finalizada] = await buscarEvolucoes(banco, [id]);
    return { ok: true, dados: finalizada! };
  });

  app.post("/evolucoes/:id/adendo", { preHandler: soMedico }, async (req, reply): Promise<Resposta<EvolucaoResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const dados = esquemaAdendo.parse(req.body);

    const original = await minhaEvolucao(id, req.contexto.clinicaId, req.usuario.id);
    if (original.status !== "finalizada") throw new ErroHttp(409, "AINDA_RASCUNHO", "Esta evolucao ainda e rascunho: edite-a em vez de fazer adendo.");
    if (original.adendoDe) throw new ErroHttp(409, "ADENDO_DE_ADENDO", "Aponte o adendo para a evolucao original, nao para outro adendo.");

    const criado = await banco.transaction(async (tx) => {
      const [a] = await tx
        .insert(evolucoes)
        .values({
          clinicaId: original.clinicaId,
          consultaId: original.consultaId,
          pacienteId: original.pacienteId,
          medicoId: req.usuario.id,
          adendoDe: id,
          status: "finalizada",
          finalizadaEm: new Date(),
          subjetivo: dados.subjetivo ?? null,
          objetivo: dados.objetivo ?? null,
          avaliacao: dados.avaliacao ?? null,
          plano: dados.plano ?? null,
          cid10: dados.cid10 ?? null,
        })
        .returning({ id: evolucoes.id });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "prontuario.adendo_registrado",
        tabela: "evolucoes",
        registroId: a!.id,
        detalhes: { corrige: id },
        ip: req.ip,
      });
      return a!;
    });

    const [novo] = await buscarEvolucoes(banco, [criado.id]);
    void reply.code(201);
    return { ok: true, dados: novo! };
  });

  app.get("/pacientes/:id/prontuario", { preHandler: soMedico }, async (req): Promise<Resposta<EvolucaoResumo[]>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);

    // O medico so ve o historico de quem ele atende (ou atendeu) aqui.
    const [vinculo] = await banco
      .select({ id: consultas.id })
      .from(consultas)
      .where(and(eq(consultas.pacienteId, id), eq(consultas.medicoId, req.usuario.id), eq(consultas.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!vinculo) throw new ErroHttp(403, "SEM_RELACAO_ASSISTENCIAL", "Voce so acessa o prontuario de pacientes que atende nesta clinica.");

    const linhas = await banco
      .select(colunas())
      .from(evolucoes)
      .innerJoin(perfis, eq(perfis.id, evolucoes.medicoId))
      .innerJoin(medicos, eq(medicos.perfilId, evolucoes.medicoId))
      .where(
        and(
          eq(evolucoes.pacienteId, id),
          eq(evolucoes.clinicaId, req.contexto.clinicaId),
          // Rascunho de outro medico nao aparece: e trabalho em andamento.
          or(eq(evolucoes.status, "finalizada"), eq(evolucoes.medicoId, req.usuario.id)),
        ),
      )
      .orderBy(desc(evolucoes.criadoEm));

    // Ler prontuario e evento auditavel - inclusive quando nada e alterado.
    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "prontuario.lido",
      tabela: "evolucoes",
      registroId: id,
      detalhes: { registros: linhas.length },
      ip: req.ip,
    });

    return { ok: true, dados: linhas.map(formatar) };
  });

  // --- apoio ---------------------------------------------------------------

  function colunas() {
    return {
      id: evolucoes.id,
      status: evolucoes.status,
      subjetivo: evolucoes.subjetivo,
      objetivo: evolucoes.objetivo,
      avaliacao: evolucoes.avaliacao,
      plano: evolucoes.plano,
      cid10: evolucoes.cid10,
      adendoDe: evolucoes.adendoDe,
      consultaId: evolucoes.consultaId,
      finalizadaEm: evolucoes.finalizadaEm,
      criadoEm: evolucoes.criadoEm,
      medicoId: evolucoes.medicoId,
      medicoNome: perfis.nomeCompleto,
      crm: medicos.crm,
      crmUf: medicos.crmUf,
    };
  }

  async function buscarEvolucoes(b: Banco, ids: string[]) {
    const linhas = await b
      .select(colunas())
      .from(evolucoes)
      .innerJoin(perfis, eq(perfis.id, evolucoes.medicoId))
      .innerJoin(medicos, eq(medicos.perfilId, evolucoes.medicoId))
      .where(eq(evolucoes.id, ids[0]!))
      .orderBy(asc(evolucoes.criadoEm));
    return linhas.map(formatar);
  }
}

function formatar(l: {
  id: string; status: string; subjetivo: string | null; objetivo: string | null; avaliacao: string | null;
  plano: string | null; cid10: string | null; adendoDe: string | null; consultaId: string;
  finalizadaEm: Date | null; criadoEm: Date; medicoId: string; medicoNome: string; crm: string; crmUf: string;
}): EvolucaoResumo {
  return {
    id: l.id,
    status: l.status as EvolucaoResumo["status"],
    subjetivo: l.subjetivo,
    objetivo: l.objetivo,
    avaliacao: l.avaliacao,
    plano: l.plano,
    cid10: l.cid10,
    adendoDe: l.adendoDe,
    consultaId: l.consultaId,
    finalizadaEm: l.finalizadaEm?.toISOString() ?? null,
    criadoEm: l.criadoEm.toISOString(),
    medico: { id: l.medicoId, nomeCompleto: l.medicoNome, crm: l.crm, crmUf: l.crmUf },
  };
}
