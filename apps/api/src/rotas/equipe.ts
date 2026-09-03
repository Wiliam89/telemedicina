/**
 * =====================================================================
 * ROTAS DE EQUIPE - membros e convites
 * =====================================================================
 *
 *   GET  /membros            quem trabalha nesta clinica
 *   GET  /medicos            os medicos desta clinica (para escolher)
 *   POST /convites           admin convida alguem (devolve o link)
 *   GET  /convites           convites pendentes desta clinica
 *   POST /convites/:id/revogar
 *   POST /convites/aceitar   quem recebeu o link entra na clinica
 *
 * Sobre o convite: o codigo e sorteado aqui e aparece UMA vez, no link
 * devolvido a quem convidou. No banco guardamos so o SHA-256 dele - se o
 * banco vazar, ninguem consegue aceitar convite nenhum. E o mesmo cuidado
 * que se tem com senha.
 *
 * O envio por e-mail entra no modulo de comunicacao (precisa de SMTP
 * proprio); ate la o admin copia o link e entrega como preferir.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, convites, medicos, perfis, vinculos, type Banco } from "@tele/db";
import type { ConviteCriado, ConviteResumo, MedicoResumo, MembroResumo, Resposta } from "@tele/shared";
import { registrarAuditoria } from "../auditoria.js";
import { criarExigirLogin, type Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

const DIAS_DE_VALIDADE = 7;

export const hashDoCodigo = (codigo: string) => createHash("sha256").update(codigo).digest("hex");

const esquemaConvite = z.object({
  email: z.string().trim().toLowerCase().email("informe um e-mail valido"),
  papel: z.enum(["medico", "recepcao", "admin_clinica"], { message: "papel deve ser medico, recepcao ou admin_clinica" }),
});

const esquemaAceite = z.object({ codigo: z.string().trim().min(20, "codigo invalido") });

export async function rotasEquipe(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; urlDoSite: string },
): Promise<void> {
  const { banco } = opcoes;
  const exigirLogin = criarExigirLogin(opcoes.autenticar);
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soAdmin = [...dentroDaClinica, exigirPapel("admin_clinica")];

  app.get("/membros", { preHandler: [...dentroDaClinica, exigirPapel("medico", "recepcao", "admin_clinica")] }, async (req): Promise<Resposta<MembroResumo[]>> => {
    const linhas = await banco
      .select({
        vinculoId: vinculos.id,
        perfilId: vinculos.perfilId,
        nomeCompleto: perfis.nomeCompleto,
        papel: vinculos.papel,
        status: vinculos.status,
        desde: vinculos.criadoEm,
      })
      .from(vinculos)
      .innerJoin(perfis, eq(perfis.id, vinculos.perfilId))
      .where(and(eq(vinculos.clinicaId, req.contexto.clinicaId), inArray(vinculos.papel, ["medico", "recepcao", "admin_clinica"])))
      .orderBy(asc(perfis.nomeCompleto));

    // Uma linha por PESSOA, com todos os papeis dela na clinica. Repetir a
    // pessoa uma vez por papel confunde quem administra a equipe.
    const porPessoa = new Map<string, MembroResumo>();
    for (const l of linhas) {
      const atual = porPessoa.get(l.perfilId);
      if (atual) {
        atual.papeis.push(l.papel);
        if (l.status === "ativo") atual.status = "ativo";
        if (l.desde.toISOString() < atual.desde) atual.desde = l.desde.toISOString();
      } else {
        porPessoa.set(l.perfilId, {
          vinculoId: l.vinculoId,
          perfilId: l.perfilId,
          nomeCompleto: l.nomeCompleto,
          papeis: [l.papel],
          status: l.status,
          desde: l.desde.toISOString(),
        });
      }
    }
    return { ok: true, dados: [...porPessoa.values()] };
  });

  app.get("/medicos", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<MedicoResumo[]>> => {
    const linhas = await banco
      .select({
        id: medicos.perfilId,
        nomeCompleto: perfis.nomeCompleto,
        crm: medicos.crm,
        crmUf: medicos.crmUf,
        especialidade: medicos.especialidade,
      })
      .from(vinculos)
      .innerJoin(medicos, eq(medicos.perfilId, vinculos.perfilId))
      .innerJoin(perfis, eq(perfis.id, vinculos.perfilId))
      .where(and(eq(vinculos.clinicaId, req.contexto.clinicaId), eq(vinculos.papel, "medico"), eq(vinculos.status, "ativo")))
      .orderBy(asc(perfis.nomeCompleto));
    return { ok: true, dados: linhas };
  });

  app.post("/convites", { preHandler: soAdmin }, async (req, reply): Promise<Resposta<ConviteCriado>> => {
    const dados = esquemaConvite.parse(req.body);

    // 32 bytes sorteados = 43 caracteres. Impossivel de adivinhar.
    const codigo = randomBytes(32).toString("base64url");
    const expiraEm = new Date(Date.now() + DIAS_DE_VALIDADE * 24 * 60 * 60 * 1000);

    const criado = await banco.transaction(async (tx) => {
      const [c] = await tx
        .insert(convites)
        .values({
          clinicaId: req.contexto.clinicaId,
          email: dados.email,
          papel: dados.papel,
          codigoHash: hashDoCodigo(codigo),
          expiraEm,
          convidadoPor: req.usuario.id,
        })
        .returning({ id: convites.id, email: convites.email, papel: convites.papel, status: convites.status, expiraEm: convites.expiraEm, criadoEm: convites.criadoEm });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "convite.criado",
        tabela: "convites",
        registroId: c!.id,
        detalhes: { email: dados.email, papel: dados.papel },
        ip: req.ip,
      });
      return c!;
    });

    void reply.code(201);
    return {
      ok: true,
      dados: {
        ...criado,
        expiraEm: criado.expiraEm.toISOString(),
        criadoEm: criado.criadoEm.toISOString(),
        linkDeAceite: `${opcoes.urlDoSite}/convite/${codigo}`,
      },
    };
  });

  app.get("/convites", { preHandler: soAdmin }, async (req): Promise<Resposta<ConviteResumo[]>> => {
    const linhas = await banco
      .select({ id: convites.id, email: convites.email, papel: convites.papel, status: convites.status, expiraEm: convites.expiraEm, criadoEm: convites.criadoEm })
      .from(convites)
      .where(and(eq(convites.clinicaId, req.contexto.clinicaId), eq(convites.status, "pendente"), gt(convites.expiraEm, new Date())))
      .orderBy(asc(convites.criadoEm));
    return { ok: true, dados: linhas.map((l) => ({ ...l, expiraEm: l.expiraEm.toISOString(), criadoEm: l.criadoEm.toISOString() })) };
  });

  app.post("/convites/:id/revogar", { preHandler: soAdmin }, async (req): Promise<Resposta<{ revogado: true }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const alterados = await banco
      .update(convites)
      .set({ status: "revogado" })
      .where(and(eq(convites.id, id), eq(convites.clinicaId, req.contexto.clinicaId), eq(convites.status, "pendente")))
      .returning({ id: convites.id });
    if (alterados.length === 0) throw new ErroHttp(404, "CONVITE_NAO_ENCONTRADO", "Convite nao encontrado ou ja usado.");
    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "convite.revogado",
      tabela: "convites",
      registroId: id,
      ip: req.ip,
    });
    return { ok: true, dados: { revogado: true } };
  });

  /**
   * Aceitar convite NAO passa pelo contexto de clinica: quem aceita ainda
   * nao tem vinculo nenhum. A clinica vem do proprio convite.
   */
  app.post("/convites/aceitar", { preHandler: exigirLogin }, async (req): Promise<Resposta<{ clinica: { slug: string; nomeFantasia: string }; papel: string }>> => {
    const { codigo } = esquemaAceite.parse(req.body);

    const [perfil] = await banco.select({ id: perfis.id }).from(perfis).where(eq(perfis.id, req.usuario.id)).limit(1);
    if (!perfil) throw new ErroHttp(400, "PERFIL_NECESSARIO", "Complete seu perfil antes de aceitar o convite.");

    const [convite] = await banco
      .select({ id: convites.id, clinicaId: convites.clinicaId, papel: convites.papel, status: convites.status, expiraEm: convites.expiraEm, slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia })
      .from(convites)
      .innerJoin(clinicas, eq(clinicas.id, convites.clinicaId))
      .where(eq(convites.codigoHash, hashDoCodigo(codigo)))
      .limit(1);

    // Mensagem unica para "nao existe" e "ja usado": nao ajudamos ninguem a
    // descobrir se um codigo tentado por acaso chegou perto.
    if (!convite || convite.status !== "pendente") throw new ErroHttp(404, "CONVITE_INVALIDO", "Este convite nao existe, ja foi usado ou foi revogado.");
    if (convite.expiraEm < new Date()) {
      await banco.update(convites).set({ status: "expirado" }).where(eq(convites.id, convite.id));
      throw new ErroHttp(410, "CONVITE_EXPIRADO", "Este convite venceu. Peca outro a administracao da clinica.");
    }

    // Medico precisa ter CRM cadastrado antes de atender (CFM 2.314/2022).
    if (convite.papel === "medico") {
      const [m] = await banco.select({ crm: medicos.crm }).from(medicos).where(eq(medicos.perfilId, req.usuario.id)).limit(1);
      if (!m) throw new ErroHttp(400, "CRM_NECESSARIO", "Para entrar como medico(a), cadastre seu CRM no seu perfil antes de aceitar.");
    }

    await banco.transaction(async (tx) => {
      await tx
        .insert(vinculos)
        .values({ perfilId: req.usuario.id, clinicaId: convite.clinicaId, papel: convite.papel })
        .onConflictDoUpdate({ target: [vinculos.perfilId, vinculos.clinicaId, vinculos.papel], set: { status: "ativo", atualizadoEm: new Date() } });
      await tx.update(convites).set({ status: "aceito", aceitoPor: req.usuario.id, aceitoEm: new Date() }).where(eq(convites.id, convite.id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: convite.clinicaId,
        acao: "convite.aceito",
        tabela: "vinculos",
        registroId: convite.id,
        detalhes: { papel: convite.papel },
        ip: req.ip,
      });
    });

    return { ok: true, dados: { clinica: { slug: convite.slug, nomeFantasia: convite.nomeFantasia }, papel: convite.papel } };
  });
}
