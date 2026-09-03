/**
 * =====================================================================
 * ROTAS DE DOCUMENTOS
 * =====================================================================
 *
 *   POST /documentos               emite (o medico da consulta)
 *   GET  /documentos               os meus / os que emiti nesta clinica
 *   POST /documentos/:id/cancelar  cancela com motivo
 *   GET  /validar/:codigo          PUBLICA - sem login, sem clinica
 *
 * A rota de validacao e a unica publica da plataforma inteira. Ela existe
 * para a farmacia, o RH ou o laboratorio conferirem se o documento em maos
 * e autentico. Por isso devolve o minimo: tipo, numero, data, CRM do
 * medico e as INICIAIS do paciente - nunca o conteudo clinico. Quem tem o
 * papel ja sabe o que esta escrito; quem nao tem nao vai descobrir aqui.
 */
import { randomInt } from "node:crypto";
import { createHash } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, consultas, documentos, medicos, pacientes, perfis, type Banco } from "@tele/db";
import type { DocumentoResumo, ResultadoValidacao, Resposta } from "@tele/shared";
import { gerarCodigoValidacao, iniciaisDoNome, montarTextoDocumento, normalizarCodigo, NOME_DO_TIPO } from "@tele/shared/documentos";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

export const hashDoTexto = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

const esquemaItem = z.object({
  medicamento: z.string().trim().min(2, "informe o medicamento").max(200),
  posologia: z.string().trim().min(3, "informe a posologia").max(300),
  quantidade: z.string().trim().max(60).optional(),
});

export const esquemaEmitir = z
  .object({
    consultaId: z.string().uuid("consultaId invalido"),
    tipo: z.enum(["receita_simples", "receita_controle_especial", "atestado", "pedido_exame", "relatorio", "declaracao_comparecimento"]),
    conteudo: z.object({
      itens: z.array(esquemaItem).max(20).optional(),
      diasAfastamento: z.number().int().min(1).max(365).optional(),
      cid10: z.string().trim().regex(/^[A-Z]\d{2}(\.\d)?$/, "CID-10 no formato A00 ou A00.0").optional(),
      exames: z.array(z.string().trim().min(2).max(200)).max(30).optional(),
      texto: z.string().trim().max(5000).optional(),
      observacoes: z.string().trim().max(1000).optional(),
    }),
  })
  .superRefine((v, ctx) => {
    const c = v.conteudo;
    if (v.tipo.startsWith("receita") && !c.itens?.length) ctx.addIssue({ code: "custom", path: ["conteudo", "itens"], message: "receita precisa de ao menos um medicamento" });
    if (v.tipo === "atestado" && typeof c.diasAfastamento !== "number") ctx.addIssue({ code: "custom", path: ["conteudo", "diasAfastamento"], message: "atestado precisa dos dias de afastamento" });
    if (v.tipo === "pedido_exame" && !c.exames?.length) ctx.addIssue({ code: "custom", path: ["conteudo", "exames"], message: "informe ao menos um exame" });
    if (v.tipo === "relatorio" && !c.texto) ctx.addIssue({ code: "custom", path: ["conteudo", "texto"], message: "relatorio precisa do texto" });
  });

export async function rotasDocumentos(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const { banco } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];

  app.post("/documentos", { preHandler: soMedico }, async (req, reply): Promise<Resposta<DocumentoResumo>> => {
    const dados = esquemaEmitir.parse(req.body);

    const [ctx] = await banco
      .select({
        consultaId: consultas.id,
        pacienteId: consultas.pacienteId,
        medicoId: consultas.medicoId,
        statusConsulta: consultas.status,
        pacienteNome: perfis.nomeCompleto,
        pacienteCpf: perfis.cpf,
        nascimento: pacientes.dataNascimento,
        clinicaNome: clinicas.nomeFantasia,
        clinicaCnpj: clinicas.cnpj,
      })
      .from(consultas)
      .innerJoin(perfis, eq(perfis.id, consultas.pacienteId))
      .innerJoin(pacientes, eq(pacientes.perfilId, consultas.pacienteId))
      .innerJoin(clinicas, eq(clinicas.id, consultas.clinicaId))
      .where(and(eq(consultas.id, dados.consultaId), eq(consultas.clinicaId, req.contexto.clinicaId)))
      .limit(1);

    if (!ctx) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Consulta nao encontrada nesta clinica.");
    if (ctx.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU_ATENDIMENTO", "So o medico da consulta emite documento dela.");
    if (ctx.statusConsulta === "cancelada") throw new ErroHttp(409, "CONSULTA_CANCELADA", "Consulta cancelada nao emite documento.");

    const [eu] = await banco
      .select({ nome: perfis.nomeCompleto, crm: medicos.crm, crmUf: medicos.crmUf, especialidade: medicos.especialidade })
      .from(medicos)
      .innerJoin(perfis, eq(perfis.id, medicos.perfilId))
      .where(eq(medicos.perfilId, req.usuario.id))
      .limit(1);
    if (!eu) throw new ErroHttp(400, "CRM_NECESSARIO", "Cadastre seu CRM antes de emitir documentos.");

    const agora = new Date();
    const ano = Number(new Intl.DateTimeFormat("en-CA", { timeZone: req.contexto.fusoHorario, year: "numeric" }).format(agora));
    const codigo = gerarCodigoValidacao((max) => randomInt(max));

    const criado = await banco.transaction(async (tx) => {
      // O numero vem de uma funcao com bloqueio: dois medicos emitindo ao
      // mesmo tempo nunca recebem o mesmo (migracao 0010).
      const linhasNumero = await tx.execute<{ numero: number }>(
        sql`select public.proximo_numero_documento(${req.contexto.clinicaId}::uuid, ${ano}::integer) as numero`,
      );
      const numero = Number((linhasNumero as unknown as { numero: number }[])[0]?.numero);
      if (!Number.isInteger(numero) || numero < 1) throw new ErroHttp(500, "NUMERACAO_FALHOU", "Nao foi possivel obter o numero do documento.");

      const texto = montarTextoDocumento({
        tipo: dados.tipo,
        ano,
        numero,
        emitidoEm: agora.toISOString(),
        clinica: { nomeFantasia: ctx.clinicaNome, cnpj: ctx.clinicaCnpj },
        medico: { nomeCompleto: eu.nome, crm: eu.crm, crmUf: eu.crmUf, especialidade: eu.especialidade },
        paciente: { nomeCompleto: ctx.pacienteNome, cpf: ctx.pacienteCpf, dataNascimento: ctx.nascimento },
        conteudo: dados.conteudo,
        codigoValidacao: codigo,
      });

      const [d] = await tx
        .insert(documentos)
        .values({
          clinicaId: req.contexto.clinicaId,
          consultaId: dados.consultaId,
          pacienteId: ctx.pacienteId,
          medicoId: req.usuario.id,
          tipo: dados.tipo,
          ano,
          numero,
          conteudo: dados.conteudo,
          textoImpresso: texto,
          hash: hashDoTexto(texto),
          codigoValidacao: codigo,
        })
        .returning({ id: documentos.id });

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "documento.emitido",
        tabela: "documentos",
        registroId: d!.id,
        detalhes: { tipo: dados.tipo, numero: `${numero}/${ano}` },
        ip: req.ip,
      });
      return d!;
    });

    const [doc] = await buscar(banco, criado.id);
    void reply.code(201);
    return { ok: true, dados: doc! };
  });

  app.get("/documentos", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<DocumentoResumo[]>> => {
    const linhas = await banco
      .select(colunas())
      .from(documentos)
      .innerJoin(perfis, eq(perfis.id, documentos.pacienteId))
      .innerJoin(medicos, eq(medicos.perfilId, documentos.medicoId))
      .where(
        and(
          eq(documentos.clinicaId, req.contexto.clinicaId),
          or(eq(documentos.pacienteId, req.usuario.id), eq(documentos.medicoId, req.usuario.id)),
        ),
      )
      .orderBy(desc(documentos.criadoEm));

    const comNome = await Promise.all(linhas.map(async (l) => l));
    return { ok: true, dados: comNome.map(formatar) };
  });

  app.post("/documentos/:id/cancelar", { preHandler: soMedico }, async (req): Promise<Resposta<DocumentoResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().trim().min(5, "explique o motivo do cancelamento").max(300) }).parse(req.body);

    const [d] = await banco.select({ status: documentos.status, medicoId: documentos.medicoId }).from(documentos).where(and(eq(documentos.id, id), eq(documentos.clinicaId, req.contexto.clinicaId))).limit(1);
    if (!d) throw new ErroHttp(404, "DOCUMENTO_NAO_ENCONTRADO", "Documento nao encontrado nesta clinica.");
    if (d.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU", "So quem emitiu o documento pode cancela-lo.");
    if (d.status === "cancelado") throw new ErroHttp(409, "JA_CANCELADO", "Este documento ja estava cancelado.");

    await banco.transaction(async (tx) => {
      await tx.update(documentos).set({ status: "cancelado", canceladoEm: new Date(), canceladoPor: req.usuario.id, motivoCancelamento: motivo }).where(eq(documentos.id, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "documento.cancelado",
        tabela: "documentos",
        registroId: id,
        detalhes: { motivo },
        ip: req.ip,
      });
    });

    const [atualizado] = await buscar(banco, id);
    return { ok: true, dados: atualizado! };
  });

  /**
   * VALIDACAO PUBLICA. Sem login e sem clinica - e o ponto em que a
   * plataforma responde ao mundo. Devolve so o suficiente para confirmar
   * autenticidade.
   */
  app.get("/validar/:codigo", async (req): Promise<Resposta<ResultadoValidacao>> => {
    const { codigo } = z.object({ codigo: z.string().trim().min(8).max(24) }).parse(req.params);
    const normalizado = normalizarCodigo(codigo);

    const [d] = await banco
      .select({
        tipo: documentos.tipo,
        status: documentos.status,
        ano: documentos.ano,
        numero: documentos.numero,
        hash: documentos.hash,
        criadoEm: documentos.criadoEm,
        assinadoEm: documentos.assinadoEm,
        pacienteNome: perfis.nomeCompleto,
        medicoNome: sql<string>`medico_perfil.nome_completo`,
        crm: medicos.crm,
        crmUf: medicos.crmUf,
        clinicaNome: clinicas.nomeFantasia,
      })
      .from(documentos)
      .innerJoin(perfis, eq(perfis.id, documentos.pacienteId))
      .innerJoin(medicos, eq(medicos.perfilId, documentos.medicoId))
      .innerJoin(sql`perfis as medico_perfil`, sql`medico_perfil.id = ${documentos.medicoId}`)
      .innerJoin(clinicas, eq(clinicas.id, documentos.clinicaId))
      .where(eq(documentos.codigoValidacao, normalizado))
      .limit(1);

    if (!d) return { ok: true, dados: { valido: false, motivo: "Nao existe documento com este codigo." } };
    if (d.status === "cancelado") {
      return { ok: true, dados: { valido: false, motivo: "Este documento foi CANCELADO pelo medico que o emitiu.", numero: `${d.numero}/${d.ano}` } };
    }

    return {
      ok: true,
      dados: {
        valido: true,
        tipo: NOME_DO_TIPO[d.tipo as keyof typeof NOME_DO_TIPO],
        numero: `${d.numero}/${d.ano}`,
        emitidoEm: d.criadoEm.toISOString(),
        pacienteIniciais: iniciaisDoNome(d.pacienteNome),
        medico: { nomeCompleto: d.medicoNome, crm: d.crm, crmUf: d.crmUf },
        clinica: d.clinicaNome,
        assinado: d.status === "assinado",
        assinadoEm: d.assinadoEm?.toISOString() ?? null,
        hash: d.hash,
      },
    };
  });

  // --- apoio ---------------------------------------------------------------

  function colunas() {
    return {
      id: documentos.id,
      tipo: documentos.tipo,
      status: documentos.status,
      ano: documentos.ano,
      numero: documentos.numero,
      codigoValidacao: documentos.codigoValidacao,
      hash: documentos.hash,
      textoImpresso: documentos.textoImpresso,
      assinadoEm: documentos.assinadoEm,
      motivoCancelamento: documentos.motivoCancelamento,
      criadoEm: documentos.criadoEm,
      pacienteNome: perfis.nomeCompleto,
      crm: medicos.crm,
      crmUf: medicos.crmUf,
      medicoId: documentos.medicoId,
    };
  }

  async function buscar(b: Banco, id: string) {
    const linhas = await b
      .select(colunas())
      .from(documentos)
      .innerJoin(perfis, eq(perfis.id, documentos.pacienteId))
      .innerJoin(medicos, eq(medicos.perfilId, documentos.medicoId))
      .where(eq(documentos.id, id));
    return linhas.map(formatar);
  }
}

function formatar(l: {
  id: string; tipo: string; status: string; ano: number; numero: number; codigoValidacao: string;
  hash: string; textoImpresso: string; assinadoEm: Date | null; motivoCancelamento: string | null;
  criadoEm: Date; pacienteNome: string; crm: string; crmUf: string;
}): DocumentoResumo {
  return {
    id: l.id,
    tipo: l.tipo,
    status: l.status as DocumentoResumo["status"],
    ano: l.ano,
    numero: l.numero,
    codigoValidacao: l.codigoValidacao,
    hash: l.hash,
    textoImpresso: l.textoImpresso,
    assinadoEm: l.assinadoEm?.toISOString() ?? null,
    motivoCancelamento: l.motivoCancelamento,
    criadoEm: l.criadoEm.toISOString(),
    medico: { nomeCompleto: "", crm: l.crm, crmUf: l.crmUf },
    paciente: { nomeCompleto: l.pacienteNome },
  };
}
