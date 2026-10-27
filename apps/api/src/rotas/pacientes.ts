/**
 * =====================================================================
 * ROTAS DO PRONTUARIO DO PACIENTE (ADR-0015)
 * =====================================================================
 *
 *   GET  /pacientes                    lista (equipe) - so dado cadastral
 *   GET  /pacientes/:id                cadastro + se quem olha tem acesso clinico
 *   GET  /pacientes/:id/ficha          ficha clinica (versao atual)
 *   POST /pacientes/:id/ficha          nova versao da ficha (medico que atende)
 *   GET  /pacientes/:id/sinais         sinais vitais
 *   POST /pacientes/:id/sinais         registra medida (medico ou o proprio paciente)
 *   GET  /pacientes/:id/anexos         exames e laudos
 *   POST /pacientes/:id/anexos         envia arquivo (medico ou o proprio paciente)
 *   GET  /anexos/:id/arquivo           link temporario para baixar
 *   GET  /pacientes/:id/linha-do-tempo tudo junto, do mais recente ao mais antigo
 *
 * QUEM LE DADO CLINICO: o proprio paciente e o medico que o atende NESTA
 * clinica (ha consulta entre os dois). Recepcao e administracao veem o
 * cadastro - nome, idade, telefone, proxima consulta - e param ai. E a
 * mesma regra da evolucao (rotas/prontuario.ts), repetida no RLS.
 *
 * Toda leitura de dado clinico por profissional gera auditoria.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, max, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { anexos, consultas, documentos, evolucoes, fichasClinicas, pacientes, perfis, sinaisVitais, vinculos, type Banco } from "@tele/db";
import type {
  AnexoResumo,
  EventoDaLinhaDoTempo,
  FichaClinicaResumo,
  PacienteDetalhe,
  PacienteNaLista,
  Resposta,
  SinalVitalResumo,
} from "@tele/shared";
import { calcularIdade, calcularImc, CATEGORIAS_DE_ANEXO, TAMANHO_MAXIMO_ANEXO, TIPOS_SANGUINEOS } from "@tele/shared/prontuario";
import { tipoPelosBytes, type ArmazenamentoDeAnexos } from "../anexos/armazenamento.js";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const lista = z
  .array(z.string().trim().min(1).max(200))
  .max(50)
  .default([])
  .transform((itens) => [...new Set(itens)]);

export const esquemaFicha = z
  .object({
    alergias: lista,
    negaAlergias: z.boolean().default(false),
    medicamentosEmUso: lista,
    comorbidades: texto(3000),
    antecedentesFamiliares: texto(3000),
    cirurgiasInternacoes: texto(3000),
    habitos: texto(3000),
    tipoSanguineo: z.enum(TIPOS_SANGUINEOS).nullish().transform((v) => v ?? null),
    observacoes: texto(3000),
  })
  .refine((f) => !(f.negaAlergias && f.alergias.length > 0), { message: "Marque 'nega alergias' ou liste as alergias - não os dois.", path: ["alergias"] });

const numero = (min: number, max: number, nome: string) =>
  z
    .number({ message: `${nome} deve ser um número` })
    .min(min, `${nome}: valor mínimo ${min}`)
    .max(max, `${nome}: valor máximo ${max}`)
    .nullish()
    .transform((v) => v ?? null);

export const esquemaSinais = z
  .object({
    medidoEm: z.string().datetime({ offset: true }).optional(),
    consultaId: z.string().uuid().nullish(),
    pesoKg: numero(0.4, 399, "Peso"),
    alturaCm: numero(21, 259, "Altura"),
    pressaoSistolica: numero(40, 300, "Pressão sistólica"),
    pressaoDiastolica: numero(20, 200, "Pressão diastólica"),
    frequenciaCardiaca: numero(20, 250, "Frequência cardíaca"),
    frequenciaRespiratoria: numero(4, 80, "Frequência respiratória"),
    temperaturaC: numero(30, 45, "Temperatura"),
    saturacaoO2: numero(50, 100, "Saturação"),
    glicemiaMgDl: numero(10, 1500, "Glicemia"),
    observacao: texto(500),
  })
  .refine((s) => (s.pressaoSistolica === null) === (s.pressaoDiastolica === null), {
    message: "Informe a pressão completa (sistólica e diastólica).",
    path: ["pressaoDiastolica"],
  })
  .refine((s) => s.pressaoSistolica === null || s.pressaoDiastolica === null || s.pressaoSistolica > s.pressaoDiastolica, {
    message: "A sistólica precisa ser maior que a diastólica.",
    path: ["pressaoSistolica"],
  })
  .refine(
    (s) =>
      [s.pesoKg, s.alturaCm, s.pressaoSistolica, s.frequenciaCardiaca, s.frequenciaRespiratoria, s.temperaturaC, s.saturacaoO2, s.glicemiaMgDl].some(
        (v) => v !== null,
      ),
    { message: "Informe ao menos uma medida." },
  )
  .refine((s) => !s.medidoEm || new Date(s.medidoEm).getTime() <= Date.now() + 5 * 60000, { message: "A medida não pode ser no futuro.", path: ["medidoEm"] });

const esquemaCamposDoAnexo = z.object({
  categoria: z.enum(Object.keys(CATEGORIAS_DE_ANEXO) as [keyof typeof CATEGORIAS_DE_ANEXO, ...(keyof typeof CATEGORIAS_DE_ANEXO)[]], {
    message: "categoria inválida",
  }),
  titulo: z.string().trim().min(2, "Dê um título ao anexo (ex.: Hemograma completo).").max(160),
  dataDoExame: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data do exame no formato AAAA-MM-DD")
    .optional()
    .transform((v) => (v ? new Date(`${v}T12:00:00Z`) : null)),
  consultaId: z.string().uuid().optional(),
});

type Acesso = "paciente" | "medico" | "equipe";

const num = (v: string | null) => (v === null ? null : Number(v));

export async function rotasPacientes(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; armazenamento: ArmazenamentoDeAnexos },
): Promise<void> {
  const { banco, armazenamento } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soEquipe = [...dentroDaClinica, exigirPapel("medico", "recepcao", "admin_clinica")];

  /**
   * O que quem pede pode ver deste paciente, nesta clinica.
   * 404 (e nao 403) quando o paciente nao e desta clinica: quem nao tem
   * vinculo nao precisa saber se a pessoa e paciente aqui.
   */
  async function acessoAo(req: FastifyRequest, pacienteId: string): Promise<Acesso> {
    const [vinculo] = await banco
      .select({ id: vinculos.id })
      .from(vinculos)
      .where(and(eq(vinculos.perfilId, pacienteId), eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "paciente"), eq(vinculos.status, "ativo")))
      .limit(1);

    if (req.usuario.id === pacienteId && vinculo) return "paciente";
    if (!vinculo || !req.contexto.papeis.some((p) => p !== "paciente")) throw new ErroHttp(404, "PACIENTE_NAO_ENCONTRADO", "Paciente não encontrado nesta clínica.");

    if (req.contexto.papeis.includes("medico")) {
      const [atende] = await banco
        .select({ id: consultas.id })
        .from(consultas)
        .where(and(eq(consultas.pacienteId, pacienteId), eq(consultas.medicoId, req.usuario.id), eq(consultas.clinicaId, req.contexto.clinicaId)))
        .limit(1);
      if (atende) return "medico";
    }
    return "equipe";
  }

  async function exigirAcessoClinico(req: FastifyRequest, pacienteId: string): Promise<"paciente" | "medico"> {
    const a = await acessoAo(req, pacienteId);
    if (a === "equipe") {
      throw new ErroHttp(
        403,
        "SEM_RELACAO_ASSISTENCIAL",
        req.contexto.papeis.includes("medico")
          ? "Você só acessa o prontuário de pacientes que atende nesta clínica."
          : "Recepção e administração não acessam dados clínicos do paciente.",
      );
    }
    return a;
  }

  async function auditarLeitura(req: FastifyRequest, acesso: Acesso, tabela: string, pacienteId: string, detalhes?: Record<string, unknown>) {
    if (acesso !== "medico") return;
    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "prontuario.lido",
      tabela,
      registroId: pacienteId,
      ...(detalhes ? { detalhes } : {}),
      ip: req.ip,
    });
  }

  /** Consulta informada precisa ser deste paciente, nesta clinica. */
  async function conferirConsulta(consultaId: string | null | undefined, pacienteId: string, clinicaId: string) {
    if (!consultaId) return null;
    const [c] = await banco
      .select({ id: consultas.id })
      .from(consultas)
      .where(and(eq(consultas.id, consultaId), eq(consultas.pacienteId, pacienteId), eq(consultas.clinicaId, clinicaId)))
      .limit(1);
    if (!c) throw new ErroHttp(400, "CONSULTA_INVALIDA", "A consulta informada não é deste paciente nesta clínica.");
    return c.id;
  }

  // --- lista e cadastro ------------------------------------------------------

  /** Agregados de consulta por paciente: ultima, proxima e total. */
  function colunasDoPaciente(clinicaId: string) {
    // Texto ISO com cast: dentro de sql`` o driver nao infere o tipo de um Date.
    const agora = new Date().toISOString();
    return {
      id: perfis.id,
      nomeCompleto: perfis.nomeCompleto,
      telefone: perfis.telefone,
      cpf: perfis.cpf,
      dataNascimento: pacientes.dataNascimento,
      ultimaConsulta: sql<Date | null>`(select max(c.inicio) from consultas c where c.paciente_id = ${perfis.id} and c.clinica_id = ${clinicaId} and c.status <> 'cancelada' and c.inicio < ${agora}::timestamptz)`,
      proximaConsulta: sql<Date | null>`(select min(c.inicio) from consultas c where c.paciente_id = ${perfis.id} and c.clinica_id = ${clinicaId} and c.status in ('agendada','aguardando_pagamento') and c.inicio >= ${agora}::timestamptz)`,
      totalConsultas: sql<number>`(select count(*)::int from consultas c where c.paciente_id = ${perfis.id} and c.clinica_id = ${clinicaId} and c.status <> 'cancelada')`,
    };
  }

  function formatarPaciente(l: {
    id: string;
    nomeCompleto: string;
    telefone: string | null;
    dataNascimento: string | null;
    ultimaConsulta: Date | string | null;
    proximaConsulta: Date | string | null;
    totalConsultas: number;
  }): PacienteNaLista {
    const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
    return {
      id: l.id,
      nomeCompleto: l.nomeCompleto,
      dataNascimento: l.dataNascimento,
      idade: l.dataNascimento ? calcularIdade(l.dataNascimento) : null,
      telefone: l.telefone,
      ultimaConsulta: iso(l.ultimaConsulta),
      proximaConsulta: iso(l.proximaConsulta),
      totalConsultas: Number(l.totalConsultas),
    };
  }

  app.get("/pacientes", { preHandler: soEquipe }, async (req): Promise<Resposta<PacienteNaLista[]>> => {
    const { busca, meus } = z
      .object({ busca: z.string().trim().max(80).optional(), meus: z.enum(["1", "0"]).optional() })
      .parse(req.query);
    const clinicaId = req.contexto.clinicaId;

    const filtros: SQL[] = [eq(vinculos.clinicaId, clinicaId), eq(vinculos.papel, "paciente"), eq(vinculos.status, "ativo")];
    if (busca) {
      const digitos = busca.replace(/\D/g, "");
      filtros.push(or(ilike(perfis.nomeCompleto, `%${busca.replace(/[%_]/g, "")}%`), ...(digitos.length >= 3 ? [ilike(perfis.cpf, `%${digitos}%`)] : []))!);
    }
    if (meus === "1" && req.contexto.papeis.includes("medico")) {
      filtros.push(
        sql`exists (select 1 from consultas c where c.paciente_id = ${perfis.id} and c.medico_id = ${req.usuario.id} and c.clinica_id = ${clinicaId})`,
      );
    }

    const linhas = await banco
      .select(colunasDoPaciente(clinicaId))
      .from(vinculos)
      .innerJoin(perfis, eq(perfis.id, vinculos.perfilId))
      .leftJoin(pacientes, eq(pacientes.perfilId, vinculos.perfilId))
      .where(and(...filtros))
      .orderBy(asc(perfis.nomeCompleto))
      .limit(200);

    return { ok: true, dados: linhas.map(formatarPaciente) };
  });

  app.get("/pacientes/:id", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<PacienteDetalhe>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await acessoAo(req, id);

    const [l] = await banco
      .select(colunasDoPaciente(req.contexto.clinicaId))
      .from(perfis)
      .leftJoin(pacientes, eq(pacientes.perfilId, perfis.id))
      .where(eq(perfis.id, id))
      .limit(1);
    if (!l) throw new ErroHttp(404, "PACIENTE_NAO_ENCONTRADO", "Paciente não encontrado nesta clínica.");

    return { ok: true, dados: { ...formatarPaciente(l), cpf: l.cpf, acessoClinico: acesso !== "equipe" } };
  });

  // --- ficha clinica ---------------------------------------------------------

  async function fichaAtual(pacienteId: string, clinicaId: string): Promise<FichaClinicaResumo | null> {
    const [f] = await banco
      .select({ f: fichasClinicas, autor: perfis.nomeCompleto })
      .from(fichasClinicas)
      .innerJoin(perfis, eq(perfis.id, fichasClinicas.registradoPor))
      .where(and(eq(fichasClinicas.pacienteId, pacienteId), eq(fichasClinicas.clinicaId, clinicaId)))
      .orderBy(desc(fichasClinicas.versao))
      .limit(1);
    if (!f) return null;
    return {
      versao: f.f.versao,
      alergias: f.f.alergias,
      negaAlergias: f.f.negaAlergias,
      medicamentosEmUso: f.f.medicamentosEmUso,
      comorbidades: f.f.comorbidades,
      antecedentesFamiliares: f.f.antecedentesFamiliares,
      cirurgiasInternacoes: f.f.cirurgiasInternacoes,
      habitos: f.f.habitos,
      tipoSanguineo: f.f.tipoSanguineo as FichaClinicaResumo["tipoSanguineo"],
      observacoes: f.f.observacoes,
      registradoPor: f.autor,
      criadoEm: f.f.criadoEm.toISOString(),
    };
  }

  app.get("/pacientes/:id/ficha", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<FichaClinicaResumo | null>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    const ficha = await fichaAtual(id, req.contexto.clinicaId);
    await auditarLeitura(req, acesso, "fichas_clinicas", id);
    return { ok: true, dados: ficha };
  });

  app.post("/pacientes/:id/ficha", { preHandler: dentroDaClinica }, async (req, reply): Promise<Resposta<FichaClinicaResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    if (acesso !== "medico") throw new ErroHttp(403, "SO_MEDICO", "Só o médico que atende atualiza a ficha clínica.");
    const dados = esquemaFicha.parse(req.body);

    // Duas pessoas salvando ao mesmo tempo disputam o mesmo numero de versao;
    // o indice unico recusa a segunda, e tentamos de novo com o numero seguinte.
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        await banco.transaction(async (tx) => {
          const [ultima] = await tx
            .select({ v: max(fichasClinicas.versao) })
            .from(fichasClinicas)
            .where(and(eq(fichasClinicas.pacienteId, id), eq(fichasClinicas.clinicaId, req.contexto.clinicaId)));
          const versao = (ultima?.v ?? 0) + 1;
          const [nova] = await tx
            .insert(fichasClinicas)
            .values({ clinicaId: req.contexto.clinicaId, pacienteId: id, versao, registradoPor: req.usuario.id, ...dados })
            .returning({ id: fichasClinicas.id });
          await registrarAuditoria(tx, {
            quem: req.usuario.id,
            clinicaId: req.contexto.clinicaId,
            acao: "prontuario.ficha_atualizada",
            tabela: "fichas_clinicas",
            registroId: nova!.id,
            detalhes: { paciente: id, versao },
            ip: req.ip,
          });
        });
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "23505" || tentativa === 2) throw e;
      }
    }

    void reply.code(201);
    return { ok: true, dados: (await fichaAtual(id, req.contexto.clinicaId))! };
  });

  // --- sinais vitais ---------------------------------------------------------

  async function listarSinais(pacienteId: string, clinicaId: string, ids?: string[]): Promise<SinalVitalResumo[]> {
    const linhas = await banco
      .select({ s: sinaisVitais, autor: perfis.nomeCompleto })
      .from(sinaisVitais)
      .innerJoin(perfis, eq(perfis.id, sinaisVitais.registradoPor))
      .where(and(eq(sinaisVitais.pacienteId, pacienteId), eq(sinaisVitais.clinicaId, clinicaId), ...(ids ? [inArray(sinaisVitais.id, ids)] : [])))
      .orderBy(desc(sinaisVitais.medidoEm))
      .limit(300);
    return linhas.map(({ s, autor }) => {
      const pesoKg = num(s.pesoKg);
      const alturaCm = num(s.alturaCm);
      return {
        id: s.id,
        medidoEm: s.medidoEm.toISOString(),
        origem: s.origem,
        registradoPor: autor,
        pesoKg,
        alturaCm,
        imc: calcularImc(pesoKg, alturaCm),
        pressaoSistolica: s.pressaoSistolica,
        pressaoDiastolica: s.pressaoDiastolica,
        frequenciaCardiaca: s.frequenciaCardiaca,
        frequenciaRespiratoria: s.frequenciaRespiratoria,
        temperaturaC: num(s.temperaturaC),
        saturacaoO2: s.saturacaoO2,
        glicemiaMgDl: s.glicemiaMgDl,
        observacao: s.observacao,
      };
    });
  }

  app.get("/pacientes/:id/sinais", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<SinalVitalResumo[]>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    const dados = await listarSinais(id, req.contexto.clinicaId);
    await auditarLeitura(req, acesso, "sinais_vitais", id, { registros: dados.length });
    return { ok: true, dados };
  });

  app.post("/pacientes/:id/sinais", { preHandler: dentroDaClinica }, async (req, reply): Promise<Resposta<SinalVitalResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    const d = esquemaSinais.parse(req.body);
    const consultaId = await conferirConsulta(d.consultaId, id, req.contexto.clinicaId);
    const txt = (v: number | null) => (v === null ? null : String(v));

    const novo = await banco.transaction(async (tx) => {
      const [s] = await tx
        .insert(sinaisVitais)
        .values({
          clinicaId: req.contexto.clinicaId,
          pacienteId: id,
          consultaId,
          origem: acesso === "medico" ? "profissional" : "paciente",
          registradoPor: req.usuario.id,
          medidoEm: d.medidoEm ? new Date(d.medidoEm) : new Date(),
          pesoKg: txt(d.pesoKg),
          alturaCm: txt(d.alturaCm),
          pressaoSistolica: d.pressaoSistolica,
          pressaoDiastolica: d.pressaoDiastolica,
          frequenciaCardiaca: d.frequenciaCardiaca,
          frequenciaRespiratoria: d.frequenciaRespiratoria,
          temperaturaC: txt(d.temperaturaC),
          saturacaoO2: d.saturacaoO2,
          glicemiaMgDl: d.glicemiaMgDl,
          observacao: d.observacao,
        })
        .returning({ id: sinaisVitais.id });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "prontuario.sinais_registrados",
        tabela: "sinais_vitais",
        registroId: s!.id,
        detalhes: { paciente: id, origem: acesso },
        ip: req.ip,
      });
      return s!;
    });

    void reply.code(201);
    const [s] = await listarSinais(id, req.contexto.clinicaId, [novo.id]);
    return { ok: true, dados: s! };
  });

  // --- anexos ----------------------------------------------------------------

  async function listarAnexos(pacienteId: string, clinicaId: string, ids?: string[]): Promise<AnexoResumo[]> {
    const linhas = await banco
      .select({ a: anexos, autor: perfis.nomeCompleto })
      .from(anexos)
      .innerJoin(perfis, eq(perfis.id, anexos.enviadoPor))
      .where(and(eq(anexos.pacienteId, pacienteId), eq(anexos.clinicaId, clinicaId), ...(ids ? [inArray(anexos.id, ids)] : [])))
      .orderBy(desc(anexos.criadoEm))
      .limit(300);
    return linhas.map(({ a, autor }) => ({
      id: a.id,
      categoria: a.categoria,
      titulo: a.titulo,
      dataDoExame: a.dataDoExame?.toISOString() ?? null,
      tipoArquivo: a.tipoArquivo,
      tamanhoBytes: a.tamanhoBytes,
      origem: a.origem,
      enviadoPor: autor,
      criadoEm: a.criadoEm.toISOString(),
    }));
  }

  app.get("/pacientes/:id/anexos", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<AnexoResumo[]>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    const dados = await listarAnexos(id, req.contexto.clinicaId);
    await auditarLeitura(req, acesso, "anexos", id, { registros: dados.length });
    return { ok: true, dados };
  });

  app.post("/pacientes/:id/anexos", { preHandler: dentroDaClinica, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply): Promise<Resposta<AnexoResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    if (!req.isMultipart()) throw new ErroHttp(400, "ENVIE_UM_ARQUIVO", "Envie o arquivo como multipart/form-data.");

    const arquivo = await req.file({ limits: { fileSize: TAMANHO_MAXIMO_ANEXO, files: 1 } });
    if (!arquivo) throw new ErroHttp(400, "ENVIE_UM_ARQUIVO", "Nenhum arquivo recebido.");
    const conteudo = new Uint8Array(await arquivo.toBuffer());
    if (arquivo.file.truncated) throw new ErroHttp(413, "ARQUIVO_GRANDE_DEMAIS", "O arquivo passa de 15 MB.");
    if (conteudo.length === 0) throw new ErroHttp(400, "ARQUIVO_VAZIO", "O arquivo está vazio.");

    // O tipo vem dos BYTES, nao do nome nem do que o navegador diz: um .exe
    // renomeado para .pdf nao entra.
    const tipo = tipoPelosBytes(conteudo);
    if (!tipo) throw new ErroHttp(415, "TIPO_NAO_ACEITO", "Aceitamos PDF, JPG, PNG ou WEBP.");

    const campos = Object.fromEntries(
      Object.entries(arquivo.fields).flatMap(([k, v]) => (v && !Array.isArray(v) && "value" in v ? [[k, String(v.value)]] : [])),
    );
    const meta = esquemaCamposDoAnexo.parse({ ...campos, dataDoExame: campos.dataDoExame || undefined, consultaId: campos.consultaId || undefined });
    const consultaId = await conferirConsulta(meta.consultaId, id, req.contexto.clinicaId);

    const anexoId = randomUUID();
    const extensao = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[tipo];
    const caminho = `${req.contexto.clinicaId}/${id}/${anexoId}.${extensao}`;
    const { hash } = await armazenamento.guardar(caminho, conteudo, tipo);

    await banco.transaction(async (tx) => {
      await tx.insert(anexos).values({
        id: anexoId,
        clinicaId: req.contexto.clinicaId,
        pacienteId: id,
        consultaId,
        origem: acesso === "medico" ? "profissional" : "paciente",
        enviadoPor: req.usuario.id,
        categoria: meta.categoria,
        titulo: meta.titulo,
        dataDoExame: meta.dataDoExame,
        caminho,
        tipoArquivo: tipo,
        tamanhoBytes: conteudo.length,
        hash,
      });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "prontuario.anexo_enviado",
        tabela: "anexos",
        registroId: anexoId,
        detalhes: { paciente: id, categoria: meta.categoria, bytes: conteudo.length, hash },
        ip: req.ip,
      });
    });

    void reply.code(201);
    const [a] = await listarAnexos(id, req.contexto.clinicaId, [anexoId]);
    return { ok: true, dados: a! };
  });

  app.get("/anexos/:id/arquivo", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ url: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const [a] = await banco
      .select({ pacienteId: anexos.pacienteId, caminho: anexos.caminho, titulo: anexos.titulo })
      .from(anexos)
      .where(and(eq(anexos.id, id), eq(anexos.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!a) throw new ErroHttp(404, "ANEXO_NAO_ENCONTRADO", "Anexo não encontrado nesta clínica.");
    const acesso = await exigirAcessoClinico(req, a.pacienteId);

    const nome = `${a.titulo.replace(/[^\p{L}\p{N} ._-]/gu, "").trim() || "anexo"}.${a.caminho.split(".").pop()}`;
    const url = await armazenamento.linkTemporario(a.caminho, nome);
    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "prontuario.anexo_baixado",
      tabela: "anexos",
      registroId: id,
      detalhes: { paciente: a.pacienteId, por: acesso },
      ip: req.ip,
    });
    return { ok: true, dados: { url } };
  });

  // --- linha do tempo --------------------------------------------------------

  app.get("/pacientes/:id/linha-do-tempo", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<EventoDaLinhaDoTempo[]>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const acesso = await exigirAcessoClinico(req, id);
    const clinicaId = req.contexto.clinicaId;

    const [listaConsultas, listaEvolucoes, listaDocumentos, sinais, listaAnexos, versoes] = await Promise.all([
      banco
        .select({ id: consultas.id, inicio: consultas.inicio, status: consultas.status, motivo: consultas.motivo, medico: perfis.nomeCompleto })
        .from(consultas)
        .innerJoin(perfis, eq(perfis.id, consultas.medicoId))
        .where(and(eq(consultas.pacienteId, id), eq(consultas.clinicaId, clinicaId), ne(consultas.status, "aguardando_pagamento")))
        .orderBy(desc(consultas.inicio))
        .limit(200),
      banco
        .select({ id: evolucoes.id, criadoEm: evolucoes.criadoEm, finalizadaEm: evolucoes.finalizadaEm, status: evolucoes.status, avaliacao: evolucoes.avaliacao, cid10: evolucoes.cid10, adendoDe: evolucoes.adendoDe, medico: perfis.nomeCompleto })
        .from(evolucoes)
        .innerJoin(perfis, eq(perfis.id, evolucoes.medicoId))
        .where(
          and(
            eq(evolucoes.pacienteId, id),
            eq(evolucoes.clinicaId, clinicaId),
            // Rascunho e trabalho em andamento: so o autor ve.
            or(eq(evolucoes.status, "finalizada"), eq(evolucoes.medicoId, req.usuario.id)),
          ),
        )
        .orderBy(desc(evolucoes.criadoEm))
        .limit(200),
      banco
        .select({ id: documentos.id, criadoEm: documentos.criadoEm, tipo: documentos.tipo, status: documentos.status, numero: documentos.numero, ano: documentos.ano, medico: perfis.nomeCompleto })
        .from(documentos)
        .innerJoin(perfis, eq(perfis.id, documentos.medicoId))
        .where(and(eq(documentos.pacienteId, id), eq(documentos.clinicaId, clinicaId)))
        .orderBy(desc(documentos.criadoEm))
        .limit(200),
      listarSinais(id, clinicaId),
      listarAnexos(id, clinicaId),
      banco
        .select({ id: fichasClinicas.id, versao: fichasClinicas.versao, criadoEm: fichasClinicas.criadoEm, autor: perfis.nomeCompleto })
        .from(fichasClinicas)
        .innerJoin(perfis, eq(perfis.id, fichasClinicas.registradoPor))
        .where(and(eq(fichasClinicas.pacienteId, id), eq(fichasClinicas.clinicaId, clinicaId)))
        .orderBy(desc(fichasClinicas.versao))
        .limit(50),
    ]);

    const nomeDoc = (t: string) => {
      const s = t.replace(/_/g, " ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    const br = (n: number) => n.toLocaleString("pt-BR");
    const resumoSinais = (s: SinalVitalResumo) =>
      [
        s.pressaoSistolica ? `PA ${s.pressaoSistolica}x${s.pressaoDiastolica}` : null,
        s.frequenciaCardiaca ? `FC ${s.frequenciaCardiaca}` : null,
        s.pesoKg ? `${br(s.pesoKg)} kg` : null,
        s.imc ? `IMC ${br(s.imc)}` : null,
        s.temperaturaC ? `${br(s.temperaturaC)} °C` : null,
        s.saturacaoO2 ? `SpO₂ ${s.saturacaoO2}%` : null,
        s.glicemiaMgDl ? `Glicemia ${s.glicemiaMgDl}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

    const eventos: EventoDaLinhaDoTempo[] = [
      ...listaConsultas.map((c) => ({
        tipo: "consulta" as const,
        id: c.id,
        em: c.inicio.toISOString(),
        titulo: "Consulta",
        detalhe: c.motivo,
        autor: c.medico,
        estado: c.status,
      })),
      ...listaEvolucoes.map((e) => ({
        tipo: "evolucao" as const,
        id: e.id,
        em: (e.finalizadaEm ?? e.criadoEm).toISOString(),
        titulo: e.adendoDe ? "Adendo ao prontuário" : "Evolução clínica",
        detalhe: [e.avaliacao, e.cid10 ? `CID-10 ${e.cid10}` : null].filter(Boolean).join(" · ") || null,
        autor: e.medico,
        estado: e.status,
      })),
      ...listaDocumentos.map((d) => ({
        tipo: "documento" as const,
        id: d.id,
        em: d.criadoEm.toISOString(),
        titulo: `${nomeDoc(d.tipo)} nº ${d.numero}/${d.ano}`,
        detalhe: null,
        autor: d.medico,
        estado: d.status,
      })),
      ...sinais.map((s) => ({
        tipo: "sinais" as const,
        id: s.id,
        em: s.medidoEm,
        titulo: s.origem === "paciente" ? "Medida informada pelo paciente" : "Sinais vitais",
        detalhe: resumoSinais(s) || null,
        autor: s.registradoPor,
        estado: null,
      })),
      ...listaAnexos.map((a) => ({
        tipo: "anexo" as const,
        id: a.id,
        em: a.dataDoExame ?? a.criadoEm,
        titulo: a.titulo,
        detalhe: CATEGORIAS_DE_ANEXO[a.categoria],
        autor: a.enviadoPor,
        estado: null,
      })),
      ...versoes.map((v) => ({
        tipo: "ficha" as const,
        id: v.id,
        em: v.criadoEm.toISOString(),
        titulo: v.versao === 1 ? "Ficha clínica criada" : `Ficha clínica atualizada (versão ${v.versao})`,
        detalhe: null,
        autor: v.autor,
        estado: null,
      })),
    ].sort((a, b) => b.em.localeCompare(a.em));

    await auditarLeitura(req, acesso, "linha_do_tempo", id, { eventos: eventos.length });
    return { ok: true, dados: eventos };
  });

}
