/**
 * =====================================================================
 * A PLATAFORMA COMO CLINICA UNICA (ADR-0022)
 * =====================================================================
 *
 *   GET  /plataforma           (publica) a plataforma opera como uma clinica so?
 *   POST /plataforma/entrar    quem ja tem conta passa a ser paciente dela
 *
 * Com PLATAFORMA_SLUG definido, ninguem escolhe, cria ou e convidado para
 * clinica nenhuma para SER ATENDIDO: a plataforma e a clinica. Quem cria a
 * conta ja e paciente dela; o medico pede credenciamento.
 *
 * O isolamento por clinica (ADR-0008) continua inteiro por baixo: a
 * plataforma e uma clinica como as outras eram, so que a unica. Por isso
 * agenda, prontuario, equipe, valores, indicadores e LGPD seguem iguais.
 */
import { eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { clinicas, pacientes, perfis, vinculos, type Banco } from "@tele/db";
import type { ClinicaResumo, PlataformaPublica, Resposta } from "@tele/shared";
import { registrarAuditoria } from "../auditoria.js";
import { criarExigirLogin, type Autenticador } from "../autenticacao.js";
import type { Ambiente } from "../ambiente.js";
import { ErroHttp } from "../erros.js";

type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

export interface ModoPlataforma {
  /** O endereco da clinica que e a plataforma. Nulo = varias clinicas (modo antigo). */
  slug: string | null;
  /** Quem pode fazer a configuracao inicial. Vazio = qualquer conta (so fora de producao). */
  adminEmails: string[];
}

export function lerModoPlataforma(ambiente: Pick<Ambiente, "PLATAFORMA_SLUG" | "PLATAFORMA_ADMIN_EMAILS">): ModoPlataforma {
  return {
    slug: ambiente.PLATAFORMA_SLUG ?? null,
    adminEmails: (ambiente.PLATAFORMA_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

export async function clinicaDaPlataforma(b: Executor, slug: string) {
  const [c] = await b
    .select({ id: clinicas.id, slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia, status: clinicas.status, fusoHorario: clinicas.fusoHorario })
    .from(clinicas)
    .where(eq(clinicas.slug, slug))
    .limit(1);
  return c ?? null;
}

/**
 * Torna a pessoa paciente da clinica. Idempotente. Quem foi suspenso pela
 * administracao nao volta por aqui: a suspensao e uma decisao, e so quem
 * suspendeu desfaz. Devolve falso nesse caso.
 */
export async function vincularComoPaciente(tx: Executor, perfilId: string, clinicaId: string, ip?: string): Promise<boolean> {
  const criados = await tx
    .insert(vinculos)
    .values({ perfilId, clinicaId, papel: "paciente" })
    .onConflictDoUpdate({
      target: [vinculos.perfilId, vinculos.clinicaId, vinculos.papel],
      set: { status: "ativo", atualizadoEm: new Date() },
      where: ne(vinculos.status, "suspenso"),
    })
    .returning({ id: vinculos.id, criadoEm: vinculos.criadoEm, atualizadoEm: vinculos.atualizadoEm });
  if (criados.length === 0) return false;
  // So audita a entrada de verdade, nao cada vez que a pessoa abre o site.
  if (criados[0]!.criadoEm.getTime() === criados[0]!.atualizadoEm.getTime()) {
    await registrarAuditoria(tx, { quem: perfilId, clinicaId, acao: "paciente.entrou_na_plataforma", tabela: "vinculos", registroId: perfilId, ...(ip ? { ip } : {}) });
  }
  return true;
}

export async function rotasPlataforma(app: FastifyInstance, opcoes: { banco: Banco; autenticar: Autenticador; modo: ModoPlataforma }): Promise<void> {
  const { banco, modo } = opcoes;
  const exigirLogin = criarExigirLogin(opcoes.autenticar);

  app.get("/plataforma", async (): Promise<Resposta<PlataformaPublica>> => {
    if (!modo.slug) return { ok: true, dados: { unica: false, slug: null, nome: null, configurada: false, aceitandoPacientes: false } };
    const c = await clinicaDaPlataforma(banco, modo.slug);
    // Nada alem do nome: e uma rota publica.
    return { ok: true, dados: { unica: true, slug: modo.slug, nome: c?.nomeFantasia ?? null, configurada: Boolean(c), aceitandoPacientes: c?.status === "ativa" || c?.status === "em_implantacao" } };
  });

  /**
   * Para a conta que ja existia antes de a plataforma virar clinica unica (ou
   * que foi criada enquanto a clinica ainda nao estava configurada). Conta
   * nova nao precisa: POST /perfis ja faz isso.
   */
  app.post("/plataforma/entrar", { preHandler: exigirLogin }, async (req): Promise<Resposta<ClinicaResumo>> => {
    if (!modo.slug) throw new ErroHttp(404, "PLATAFORMA_COM_VARIAS_CLINICAS", "Esta instalação trabalha com várias clínicas. Use o link de entrada da clínica.");

    const [perfil] = await banco
      .select({ id: perfis.id, nascimento: pacientes.dataNascimento })
      .from(perfis)
      .leftJoin(pacientes, eq(pacientes.perfilId, perfis.id))
      .where(eq(perfis.id, req.usuario.id))
      .limit(1);
    if (!perfil) throw new ErroHttp(400, "PERFIL_NECESSARIO", "Complete seu cadastro para continuar.");

    const c = await clinicaDaPlataforma(banco, modo.slug);
    if (!c) throw new ErroHttp(503, "PLATAFORMA_NAO_CONFIGURADA", "A plataforma ainda está sendo preparada. Tente de novo em breve.");
    if (c.status === "suspensa" || c.status === "encerrada") throw new ErroHttp(409, "PLATAFORMA_INDISPONIVEL", "A plataforma não está aceitando novos cadastros no momento.");

    const entrou = await banco.transaction(async (tx) => {
      // Quem se cadastrou so como medico, antes desta versao, pode nao ter a ficha de paciente.
      if (!perfil.nascimento) return false;
      return vincularComoPaciente(tx, req.usuario.id, c.id, req.ip);
    });
    if (!perfil.nascimento) throw new ErroHttp(400, "DADOS_DE_PACIENTE_NECESSARIOS", "Para ser atendido, informe sua data de nascimento em Minha conta.");
    if (!entrou) throw new ErroHttp(403, "ACESSO_SUSPENSO", "Seu acesso está suspenso. Fale com o atendimento da plataforma.");

    return { ok: true, dados: { ...c, papel: "paciente" } };
  });
}
