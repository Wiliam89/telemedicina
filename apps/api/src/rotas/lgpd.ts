/**
 * =====================================================================
 * ROTAS DA LGPD - DIREITOS DO TITULAR (ADR-0018)
 * =====================================================================
 *
 *   GET  /lgpd/consentimentos          meu historico de aceites e revogacoes
 *   POST /lgpd/consentimentos          aceito (versao atual) - art. 8
 *   POST /lgpd/consentimentos/revogar  revogo - art. 8, par. 5
 *   GET  /lgpd/meus-dados              tudo o que ha sobre mim, em JSON - art. 18, II e V
 *   GET  /lgpd/acessos                 quem tratou meus dados e quando - art. 9 e 18
 *   GET  /lgpd/solicitacoes            meus pedidos ao controlador
 *   POST /lgpd/solicitacoes            novo pedido (prazo de 15 dias) - art. 18 e 19
 *   GET  /lgpd/solicitacoes-da-clinica pedidos dirigidos a esta clinica (administracao)
 *   POST /lgpd/solicitacoes/:id/responder  administracao responde
 *
 * Os pedidos de exclusao nao apagam prontuario: a Lei 13.787/2018 manda
 * guardar o registro clinico por 20 anos. O controlador responde dizendo o
 * que foi anonimizado ou excluido e o que fica guardado por obrigacao
 * legal (art. 16, I).
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  anexos,
  auditoria,
  clinicas,
  consentimentos,
  consultas,
  documentos,
  evolucoes,
  fichasClinicas,
  medicos,
  pacientes,
  perfis,
  sinaisVitais,
  solicitacoesTitular,
  vinculos,
  type Banco,
} from "@tele/db";
import type { AcessoAosMeusDados, ConsentimentoResumo, Resposta, SolicitacaoResumo } from "@tele/shared";
import { DESCRICAO_DA_ACAO, DIAS_PARA_RESPONDER, TIPOS_DE_SOLICITACAO, VERSOES_LEGAIS, type TipoConsentimento } from "@tele/shared/lgpd";
import { registrarAuditoria } from "../auditoria.js";
import { criarExigirLogin, type Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { notificar } from "../notificacoes/index.js";
import { ErroHttp } from "../erros.js";

const TIPOS = Object.keys(VERSOES_LEGAIS) as [TipoConsentimento, ...TipoConsentimento[]];

export async function rotasLgpd(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const exigirLogin = criarExigirLogin(opcoes.autenticar);
  const soAdmin = [...criarExigirClinica(banco, opcoes.autenticar), exigirPapel("admin_clinica")];

  // --- consentimento ---------------------------------------------------------

  app.get("/lgpd/consentimentos", { preHandler: exigirLogin }, async (req): Promise<Resposta<ConsentimentoResumo[]>> => {
    const linhas = await banco
      .select()
      .from(consentimentos)
      .where(eq(consentimentos.perfilId, req.usuario.id))
      .orderBy(desc(consentimentos.criadoEm));
    return { ok: true, dados: linhas.map((l) => ({ tipo: l.tipo, acao: l.acao, versao: l.versao, criadoEm: l.criadoEm.toISOString() })) };
  });

  app.post("/lgpd/consentimentos", { preHandler: exigirLogin }, async (req, reply): Promise<Resposta<{ registrados: number }>> => {
    const { tipos } = z.object({ tipos: z.array(z.enum(TIPOS)).min(1, "informe o que foi aceito") }).parse(req.body);
    const [perfil] = await banco.select({ id: perfis.id }).from(perfis).where(eq(perfis.id, req.usuario.id)).limit(1);
    if (!perfil) throw new ErroHttp(400, "PERFIL_NECESSARIO", "Complete seu perfil antes.");
    await registrarAceites(banco, req.usuario.id, [...new Set(tipos)], req.ip, String(req.headers["user-agent"] ?? ""));
    void reply.code(201);
    return { ok: true, dados: { registrados: tipos.length } };
  });

  app.post("/lgpd/consentimentos/revogar", { preHandler: exigirLogin }, async (req, reply): Promise<Resposta<{ revogado: TipoConsentimento }>> => {
    const { tipo } = z.object({ tipo: z.enum(TIPOS) }).parse(req.body);
    await banco.transaction(async (tx) => {
      await tx.insert(consentimentos).values({
        perfilId: req.usuario.id,
        tipo,
        acao: "revogado",
        versao: VERSOES_LEGAIS[tipo],
        ip: req.ip,
        navegador: String(req.headers["user-agent"] ?? "").slice(0, 300),
      });
      await registrarAuditoria(tx, { quem: req.usuario.id, clinicaId: null, acao: "lgpd.consentimento_revogado", tabela: "consentimentos", registroId: req.usuario.id, detalhes: { tipo }, ip: req.ip });
    });
    void reply.code(201);
    return { ok: true, dados: { revogado: tipo } };
  });

  // --- acesso e portabilidade -----------------------------------------------

  app.get("/lgpd/meus-dados", { preHandler: exigirLogin, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const eu = req.usuario.id;
    const [pessoa] = await banco
      .select({
        id: perfis.id, nomeCompleto: perfis.nomeCompleto, telefone: perfis.telefone, cpf: perfis.cpf, criadoEm: perfis.criadoEm,
        crm: medicos.crm, crmUf: medicos.crmUf, especialidade: medicos.especialidade, dataNascimento: pacientes.dataNascimento,
      })
      .from(perfis)
      .leftJoin(medicos, eq(medicos.perfilId, perfis.id))
      .leftJoin(pacientes, eq(pacientes.perfilId, perfis.id))
      .where(eq(perfis.id, eu))
      .limit(1);
    if (!pessoa) throw new ErroHttp(404, "PERFIL_NAO_ENCONTRADO", "Você ainda não tem perfil.");

    const [meusVinculos, minhasConsultas, meusDocumentos, minhasEvolucoes, fichas, sinais, meusAnexos, aceites, pedidos] = await Promise.all([
      banco.select({ clinica: clinicas.nomeFantasia, papel: vinculos.papel, status: vinculos.status, desde: vinculos.criadoEm }).from(vinculos).innerJoin(clinicas, eq(clinicas.id, vinculos.clinicaId)).where(eq(vinculos.perfilId, eu)),
      banco.select({ clinica: clinicas.nomeFantasia, inicio: consultas.inicio, fim: consultas.fim, status: consultas.status, motivo: consultas.motivo }).from(consultas).innerJoin(clinicas, eq(clinicas.id, consultas.clinicaId)).where(eq(consultas.pacienteId, eu)),
      banco.select({ clinica: clinicas.nomeFantasia, tipo: documentos.tipo, numero: documentos.numero, ano: documentos.ano, status: documentos.status, texto: documentos.textoImpresso, codigoValidacao: documentos.codigoValidacao, emitidoEm: documentos.criadoEm }).from(documentos).innerJoin(clinicas, eq(clinicas.id, documentos.clinicaId)).where(eq(documentos.pacienteId, eu)),
      banco.select({ clinica: clinicas.nomeFantasia, subjetivo: evolucoes.subjetivo, objetivo: evolucoes.objetivo, avaliacao: evolucoes.avaliacao, plano: evolucoes.plano, cid10: evolucoes.cid10, finalizadaEm: evolucoes.finalizadaEm }).from(evolucoes).innerJoin(clinicas, eq(clinicas.id, evolucoes.clinicaId)).where(and(eq(evolucoes.pacienteId, eu), eq(evolucoes.status, "finalizada"))),
      banco.select({ clinica: clinicas.nomeFantasia, f: fichasClinicas }).from(fichasClinicas).innerJoin(clinicas, eq(clinicas.id, fichasClinicas.clinicaId)).where(eq(fichasClinicas.pacienteId, eu)),
      banco.select({ clinica: clinicas.nomeFantasia, s: sinaisVitais }).from(sinaisVitais).innerJoin(clinicas, eq(clinicas.id, sinaisVitais.clinicaId)).where(eq(sinaisVitais.pacienteId, eu)),
      banco.select({ clinica: clinicas.nomeFantasia, titulo: anexos.titulo, categoria: anexos.categoria, tipoArquivo: anexos.tipoArquivo, enviadoEm: anexos.criadoEm, hash: anexos.hash }).from(anexos).innerJoin(clinicas, eq(clinicas.id, anexos.clinicaId)).where(eq(anexos.pacienteId, eu)),
      banco.select({ tipo: consentimentos.tipo, acao: consentimentos.acao, versao: consentimentos.versao, em: consentimentos.criadoEm }).from(consentimentos).where(eq(consentimentos.perfilId, eu)),
      banco.select({ tipo: solicitacoesTitular.tipo, status: solicitacoesTitular.status, descricao: solicitacoesTitular.descricao, resposta: solicitacoesTitular.resposta, criadoEm: solicitacoesTitular.criadoEm }).from(solicitacoesTitular).where(eq(solicitacoesTitular.perfilId, eu)),
    ]);

    await registrarAuditoria(banco, { quem: eu, clinicaId: null, acao: "lgpd.dados_exportados", tabela: "perfis", registroId: eu, ip: req.ip });

    const exportacao = {
      geradoEm: new Date().toISOString(),
      aviso: "Cópia dos seus dados pessoais nesta plataforma (LGPD, art. 18, II e V). Os arquivos de exames não vão aqui: baixe-os em Minha saúde. Guarde este arquivo em local seguro.",
      pessoa: {
        nomeCompleto: pessoa.nomeCompleto,
        cpf: pessoa.cpf,
        telefone: pessoa.telefone,
        dataNascimento: pessoa.dataNascimento,
        cadastradoEm: pessoa.criadoEm,
        medico: pessoa.crm ? { crm: pessoa.crm, uf: pessoa.crmUf, especialidade: pessoa.especialidade } : null,
      },
      email: req.usuario.email,
      vinculos: meusVinculos,
      consultas: minhasConsultas,
      documentos: meusDocumentos,
      evolucoesClinicas: minhasEvolucoes,
      fichasClinicas: fichas.map(({ clinica, f }) => ({ clinica, versao: f.versao, alergias: f.alergias, negaAlergias: f.negaAlergias, medicamentosEmUso: f.medicamentosEmUso, comorbidades: f.comorbidades, antecedentesFamiliares: f.antecedentesFamiliares, cirurgiasInternacoes: f.cirurgiasInternacoes, habitos: f.habitos, tipoSanguineo: f.tipoSanguineo, observacoes: f.observacoes, registradaEm: f.criadoEm })),
      sinaisVitais: sinais.map(({ clinica, s }) => ({ clinica, medidoEm: s.medidoEm, origem: s.origem, pesoKg: s.pesoKg, alturaCm: s.alturaCm, pressao: s.pressaoSistolica ? `${s.pressaoSistolica}x${s.pressaoDiastolica}` : null, frequenciaCardiaca: s.frequenciaCardiaca, temperaturaC: s.temperaturaC, saturacaoO2: s.saturacaoO2, glicemiaMgDl: s.glicemiaMgDl })),
      anexos: meusAnexos,
      consentimentos: aceites,
      solicitacoes: pedidos,
    };

    return reply
      .type("application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="meus-dados-${new Date().toISOString().slice(0, 10)}.json"`)
      .header("cache-control", "no-store")
      .send(JSON.stringify(exportacao, null, 2));
  });

  app.get("/lgpd/acessos", { preHandler: exigirLogin }, async (req): Promise<Resposta<AcessoAosMeusDados[]>> => {
    const eu = req.usuario.id;
    const [docs, cons] = await Promise.all([
      banco.select({ id: documentos.id }).from(documentos).where(eq(documentos.pacienteId, eu)),
      banco.select({ id: consultas.id }).from(consultas).where(eq(consultas.pacienteId, eu)),
    ]);
    const ids = [eu, ...docs.map((d) => d.id), ...cons.map((c) => c.id)];

    const linhas = await banco
      .select({ quando: auditoria.quando, acao: auditoria.acao, quemId: auditoria.quem, quem: perfis.nomeCompleto, clinica: clinicas.nomeFantasia })
      .from(auditoria)
      .leftJoin(perfis, eq(perfis.id, auditoria.quem))
      .leftJoin(clinicas, eq(clinicas.id, auditoria.clinicaId))
      .where(or(inArray(auditoria.registroId, ids), sql`${auditoria.detalhes}->>'paciente' = ${eu}`))
      .orderBy(desc(auditoria.quando))
      .limit(300);

    return {
      ok: true,
      dados: linhas.map((l) => ({
        quando: l.quando.toISOString(),
        quem: l.quem,
        souEu: l.quemId === eu,
        clinica: l.clinica,
        acao: l.acao,
        descricao: DESCRICAO_DA_ACAO[l.acao] ?? l.acao.replace(/[._]/g, " "),
      })),
    };
  });

  // --- solicitacoes do titular ----------------------------------------------

  function formatar(l: { s: typeof solicitacoesTitular.$inferSelect; clinica: string | null; nome?: string | null }): SolicitacaoResumo {
    return {
      id: l.s.id,
      tipo: l.s.tipo,
      descricao: l.s.descricao,
      status: l.s.status,
      resposta: l.s.resposta,
      respondidoEm: l.s.respondidoEm?.toISOString() ?? null,
      prazo: l.s.prazo.toISOString(),
      criadoEm: l.s.criadoEm.toISOString(),
      clinica: l.clinica,
      ...(l.nome !== undefined ? { titular: { id: l.s.perfilId, nomeCompleto: l.nome ?? "" } } : {}),
    };
  }

  app.get("/lgpd/solicitacoes", { preHandler: exigirLogin }, async (req): Promise<Resposta<SolicitacaoResumo[]>> => {
    const linhas = await banco
      .select({ s: solicitacoesTitular, clinica: clinicas.nomeFantasia })
      .from(solicitacoesTitular)
      .leftJoin(clinicas, eq(clinicas.id, solicitacoesTitular.clinicaId))
      .where(eq(solicitacoesTitular.perfilId, req.usuario.id))
      .orderBy(desc(solicitacoesTitular.criadoEm));
    return { ok: true, dados: linhas.map(formatar) };
  });

  app.post("/lgpd/solicitacoes", { preHandler: exigirLogin, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply): Promise<Resposta<SolicitacaoResumo>> => {
    const dados = z
      .object({
        tipo: z.enum(Object.keys(TIPOS_DE_SOLICITACAO) as [keyof typeof TIPOS_DE_SOLICITACAO, ...(keyof typeof TIPOS_DE_SOLICITACAO)[]]),
        descricao: z.string().trim().min(10, "Descreva o pedido (ao menos 10 caracteres).").max(3000),
        clinica: z.string().trim().toLowerCase().optional(),
      })
      .parse(req.body);

    let clinicaId: string | null = null;
    if (dados.clinica) {
      // So se pede a uma clinica onde se tem (ou teve) vinculo.
      const [c] = await banco
        .select({ id: clinicas.id })
        .from(clinicas)
        .innerJoin(vinculos, and(eq(vinculos.clinicaId, clinicas.id), eq(vinculos.perfilId, req.usuario.id)))
        .where(eq(clinicas.slug, dados.clinica))
        .limit(1);
      if (!c) throw new ErroHttp(404, "CLINICA_NAO_ENCONTRADA", "Você não tem vínculo com esta clínica.");
      clinicaId = c.id;
    }

    const criada = await banco.transaction(async (tx) => {
      const [s] = await tx
        .insert(solicitacoesTitular)
        .values({ perfilId: req.usuario.id, clinicaId, tipo: dados.tipo, descricao: dados.descricao, prazo: new Date(Date.now() + DIAS_PARA_RESPONDER * 86400000) })
        .returning();
      await registrarAuditoria(tx, { quem: req.usuario.id, clinicaId, acao: "lgpd.solicitacao_aberta", tabela: "solicitacoes_titular", registroId: s!.id, detalhes: { tipo: dados.tipo }, ip: req.ip });
      return s!;
    });

    void reply.code(201);
    return { ok: true, dados: formatar({ s: criada, clinica: null }) };
  });

  app.get("/lgpd/solicitacoes-da-clinica", { preHandler: soAdmin }, async (req): Promise<Resposta<SolicitacaoResumo[]>> => {
    const linhas = await banco
      .select({ s: solicitacoesTitular, clinica: clinicas.nomeFantasia, nome: perfis.nomeCompleto })
      .from(solicitacoesTitular)
      .innerJoin(clinicas, eq(clinicas.id, solicitacoesTitular.clinicaId))
      .innerJoin(perfis, eq(perfis.id, solicitacoesTitular.perfilId))
      .where(eq(solicitacoesTitular.clinicaId, req.contexto.clinicaId))
      .orderBy(desc(solicitacoesTitular.criadoEm));
    return { ok: true, dados: linhas.map(formatar) };
  });

  app.post("/lgpd/solicitacoes/:id/responder", { preHandler: soAdmin }, async (req): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const dados = z
      .object({
        status: z.enum(["em_andamento", "concluida", "negada"]),
        resposta: z.string().trim().max(3000).optional(),
      })
      .superRefine((d, ctx) => {
        if (d.status !== "em_andamento" && (d.resposta ?? "").length < 10) ctx.addIssue({ code: "custom", path: ["resposta"], message: "Escreva a resposta ao titular (ao menos 10 caracteres)." });
      })
      .parse(req.body);

    const [s] = await banco
      .select({ id: solicitacoesTitular.id, status: solicitacoesTitular.status, perfilId: solicitacoesTitular.perfilId })
      .from(solicitacoesTitular)
      .where(and(eq(solicitacoesTitular.id, id), eq(solicitacoesTitular.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!s) throw new ErroHttp(404, "SOLICITACAO_NAO_ENCONTRADA", "Pedido não encontrado nesta clínica.");
    if (s.status === "concluida" || s.status === "negada") throw new ErroHttp(409, "JA_RESPONDIDA", "Este pedido já foi respondido.");

    await banco.transaction(async (tx) => {
      await tx
        .update(solicitacoesTitular)
        .set({
          status: dados.status,
          resposta: dados.resposta ?? null,
          ...(dados.status === "em_andamento" ? {} : { respondidoPor: req.usuario.id, respondidoEm: new Date() }),
        })
        .where(eq(solicitacoesTitular.id, id));
      await registrarAuditoria(tx, { quem: req.usuario.id, clinicaId: req.contexto.clinicaId, acao: "lgpd.solicitacao_respondida", tabela: "solicitacoes_titular", registroId: id, detalhes: { status: dados.status }, ip: req.ip });
      if (dados.status !== "em_andamento") {
        await notificar(tx, {
          perfilId: s.perfilId,
          clinicaId: req.contexto.clinicaId,
          tipo: "pedido_lgpd_respondido",
          titulo: "Seu pedido sobre dados pessoais foi respondido",
          corpo: `${req.contexto.nomeFantasia} respondeu ao seu pedido. Veja a resposta em Minha conta.`,
          link: "/conta",
          chave: `pedido_lgpd_respondido:${id}`,
        });
      }
    });
    return { ok: true, dados: { status: dados.status } };
  });
}

/** Registra os aceites na versao atual (usado aqui e no cadastro do perfil). */
export async function registrarAceites(
  b: Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0],
  perfilId: string,
  tipos: TipoConsentimento[],
  ip: string,
  navegador: string,
): Promise<void> {
  if (tipos.length === 0) return;
  await b.insert(consentimentos).values(tipos.map((tipo) => ({ perfilId, tipo, acao: "aceito" as const, versao: VERSOES_LEGAIS[tipo], ip, navegador: navegador.slice(0, 300) })));
  await registrarAuditoria(b, { quem: perfilId, clinicaId: null, acao: "lgpd.consentimento_aceito", tabela: "consentimentos", registroId: perfilId, detalhes: { tipos, versoes: tipos.map((t) => VERSOES_LEGAIS[t]) }, ip });
}
