/**
 * =====================================================================
 * ROTAS DE PERFIL - a PESSOA (nao o papel)
 * =====================================================================
 *
 *   POST /perfis      cria o perfil da pessoa logada
 *   GET  /perfis/eu   o perfil + as clinicas onde ela tem vinculo ativo
 *
 * Mudanca do Modulo 6: o perfil nao tem mais papel. "Sou medico" ou "sou
 * paciente" passou a ser um vinculo com uma clinica. Aqui a pessoa diz
 * quem ela e no mundo (nome, CPF) e, se for medica, seu CRM - que e da
 * pessoa, nao da clinica.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, consentimentos, medicos, pacientes, perfis, vinculos, type Banco } from "@tele/db";
import type { PerfilResposta, Resposta, SituacaoCrm } from "@tele/shared";
import { consentimentosPendentes } from "@tele/shared/lgpd";
import { registrarAuditoria } from "../auditoria.js";
import { situacaoCrm } from "../crm.js";
import { registrarAceites } from "./lgpd.js";
import { ErroHttp } from "../erros.js";
import { criarExigirLogin, type Autenticador } from "../autenticacao.js";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;

const esquemaCriarPerfil = z.object({
  nomeCompleto: z.string().trim().min(3, "nomeCompleto precisa ter ao menos 3 letras").max(120),
  telefone: z.string().trim().regex(/^\d{10,11}$/, "telefone: só dígitos, com DDD (10 ou 11)").optional(),
  cpf: z.string().regex(/^\d{11}$/, "cpf: exatamente 11 dígitos, sem pontos").optional(),
  /** Preencha se voce e medico(a): o CRM acompanha a pessoa entre clinicas. */
  medico: z
    .object({
      crm: z.string().trim().regex(/^\d{4,7}$/, "crm: de 4 a 7 dígitos"),
      crmUf: z.enum(UFS, { message: "crmUf deve ser a sigla de um estado (ex.: SP)" }),
      especialidade: z.string().trim().min(2).max(80).optional(),
    })
    .optional(),
  /** Preencha se voce sera atendido: a data de nascimento e clinica, nao cadastral. */
  paciente: z.object({ dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dataNascimento no formato AAAA-MM-DD") }).optional(),
  /** O que a pessoa aceitou na tela de cadastro (ADR-0018). */
  consentimentos: z.array(z.enum(["termos_de_uso", "politica_de_privacidade", "telemedicina"])).optional(),
});

export async function buscarPerfil(banco: Banco, id: string): Promise<PerfilResposta | null> {
  const [linha] = await banco
    .select({
      id: perfis.id,
      nomeCompleto: perfis.nomeCompleto,
      telefone: perfis.telefone,
      cpf: perfis.cpf,
      criadoEm: perfis.criadoEm,
      crm: medicos.crm,
      crmUf: medicos.crmUf,
      especialidade: medicos.especialidade,
      dataNascimento: pacientes.dataNascimento,
    })
    .from(perfis)
    .leftJoin(medicos, eq(medicos.perfilId, perfis.id))
    .leftJoin(pacientes, eq(pacientes.perfilId, perfis.id))
    .where(eq(perfis.id, id))
    .limit(1);
  if (!linha) return null;

  const minhas = await banco
    .select({
      id: clinicas.id,
      slug: clinicas.slug,
      nomeFantasia: clinicas.nomeFantasia,
      status: clinicas.status,
      fusoHorario: clinicas.fusoHorario,
      papel: vinculos.papel,
    })
    .from(vinculos)
    .innerJoin(clinicas, eq(clinicas.id, vinculos.clinicaId))
    .where(and(eq(vinculos.perfilId, id), eq(vinculos.status, "ativo")))
    .orderBy(clinicas.nomeFantasia);

  // Uma pessoa pode ter mais de um papel na MESMA clinica (medica e
  // administradora, por exemplo). Na lista de clinicas ela aparece uma vez
  // so, com o papel de maior alcance - senao a tela mostra a mesma clinica
  // duas vezes e a pessoa nao sabe qual escolher.
  const FORCA = { admin_clinica: 4, medico: 3, recepcao: 2, paciente: 1 } as const;
  const porClinica = new Map<string, (typeof minhas)[number]>();
  const papeisPorClinica = new Map<string, (typeof minhas)[number]["papel"][]>();
  for (const c of minhas) {
    const atual = porClinica.get(c.id);
    if (!atual || FORCA[c.papel] > FORCA[atual.papel]) porClinica.set(c.id, c);
    papeisPorClinica.set(c.id, [...(papeisPorClinica.get(c.id) ?? []), c.papel]);
  }

  // ADR-0018: o que ainda falta aceitar na versao atual dos textos.
  const aceites = await banco
    .select({ tipo: consentimentos.tipo, acao: consentimentos.acao, versao: consentimentos.versao, criadoEm: consentimentos.criadoEm })
    .from(consentimentos)
    .where(eq(consentimentos.perfilId, id));

  // ADR-0016: onde a pessoa atende como medico, a situacao do CRM la.
  const ondeAtende = minhas.filter((c) => c.papel === "medico").map((c) => c.id);
  const crmPorClinica = new Map<string, SituacaoCrm>();
  for (const clinicaId of ondeAtende) crmPorClinica.set(clinicaId, await situacaoCrm(banco, clinicaId, id));

  return {
    id: linha.id,
    nomeCompleto: linha.nomeCompleto,
    telefone: linha.telefone,
    cpf: linha.cpf,
    criadoEm: linha.criadoEm.toISOString(),
    medico: linha.crm && linha.crmUf ? { crm: linha.crm, crmUf: linha.crmUf, especialidade: linha.especialidade } : null,
    paciente: linha.dataNascimento ? { dataNascimento: linha.dataNascimento } : null,
    consentimentosPendentes: consentimentosPendentes(aceites),
    clinicas: [...porClinica.values()]
      .filter((c) => c.status !== "encerrada")
      .map((c) => ({
        ...c,
        papeis: papeisPorClinica.get(c.id)!.sort((a, b) => FORCA[b] - FORCA[a]),
        ...(crmPorClinica.has(c.id) ? { situacaoCrm: crmPorClinica.get(c.id)! } : {}),
      })),
  };
}

export async function rotasPerfis(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador }): Promise<void> {
  const exigirLogin = criarExigirLogin(opcoes.autenticar);
  const { banco } = opcoes;

  /**
   * Correcao dos proprios dados (LGPD, art. 18, III). Nome e telefone.
   * CPF, CRM e data de nascimento identificam a pessoa em documentos ja
   * emitidos: mudam por pedido ao controlador, com conferencia.
   */
  app.patch("/perfis/eu", { preHandler: exigirLogin }, async (req): Promise<Resposta<PerfilResposta>> => {
    const dados = z
      .object({
        nomeCompleto: z.string().trim().min(3, "nome com ao menos 3 letras").max(120).optional(),
        telefone: z.string().trim().regex(/^\d{10,11}$/, "telefone: só dígitos, com DDD (10 ou 11)").nullable().optional(),
      })
      .refine((d) => d.nomeCompleto !== undefined || d.telefone !== undefined, "nada para corrigir")
      .parse(req.body);
    const [antes] = await banco.select({ nome: perfis.nomeCompleto, telefone: perfis.telefone }).from(perfis).where(eq(perfis.id, req.usuario.id)).limit(1);
    if (!antes) throw new ErroHttp(404, "PERFIL_NAO_ENCONTRADO", "Você ainda não tem perfil.");
    await banco.transaction(async (tx) => {
      await tx
        .update(perfis)
        .set({ ...(dados.nomeCompleto ? { nomeCompleto: dados.nomeCompleto } : {}), ...(dados.telefone !== undefined ? { telefone: dados.telefone } : {}), atualizadoEm: new Date() })
        .where(eq(perfis.id, req.usuario.id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: null,
        acao: "perfil.corrigido",
        tabela: "perfis",
        registroId: req.usuario.id,
        detalhes: { campos: Object.keys(dados) },
        ip: req.ip,
      });
    });
    return { ok: true, dados: (await buscarPerfil(banco, req.usuario.id))! };
  });

  app.post("/perfis", { preHandler: exigirLogin }, async (req, reply): Promise<Resposta<PerfilResposta>> => {
    const dados = esquemaCriarPerfil.parse(req.body);
    const usuario = req.usuario;

    try {
      await banco.transaction(async (tx) => {
        await tx.insert(perfis).values({
          id: usuario.id,
          nomeCompleto: dados.nomeCompleto,
          telefone: dados.telefone ?? null,
          cpf: dados.cpf ?? null,
        });
        if (dados.medico) {
          await tx.insert(medicos).values({
            perfilId: usuario.id,
            crm: dados.medico.crm,
            crmUf: dados.medico.crmUf,
            especialidade: dados.medico.especialidade ?? null,
          });
        }
        if (dados.paciente) {
          await tx.insert(pacientes).values({ perfilId: usuario.id, dataNascimento: dados.paciente.dataNascimento });
        }
        await registrarAuditoria(tx, {
          quem: usuario.id,
          clinicaId: null, // criar o proprio perfil acontece fora de qualquer clinica
          acao: "perfil.criado",
          tabela: "perfis",
          registroId: usuario.id,
          detalhes: { medico: Boolean(dados.medico), paciente: Boolean(dados.paciente) },
          ip: req.ip,
        });
        if (dados.consentimentos?.length) {
          await registrarAceites(tx, usuario.id, [...new Set(dados.consentimentos)], req.ip, String(req.headers["user-agent"] ?? ""));
        }
      });
    } catch (erro) {
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      if (codigo === "23505") throw new ErroHttp(409, "PERFIL_JA_EXISTE", "Esta conta já tem perfil (ou o CRM/CPF já está em uso).");
      if (codigo === "23503") throw new ErroHttp(400, "LOGIN_NAO_ENCONTRADO", "O usuário do token não existe em auth.users.");
      throw erro;
    }

    const perfil = await buscarPerfil(banco, usuario.id);
    if (!perfil) throw new ErroHttp(500, "PERFIL_SUMIU", "O perfil foi criado mas não pode ser lido.");
    void reply.code(201);
    return { ok: true, dados: perfil };
  });

  app.get("/perfis/eu", { preHandler: exigirLogin }, async (req): Promise<Resposta<PerfilResposta>> => {
    const perfil = await buscarPerfil(banco, req.usuario.id);
    if (!perfil) throw new ErroHttp(404, "PERFIL_NAO_ENCONTRADO", "Você ainda não tem perfil. Envie POST /perfis.");
    return { ok: true, dados: perfil };
  });
}
