/**
 * =====================================================================
 * CONTEXTO DE CLINICA - "quem voce e, e onde voce esta"
 * =====================================================================
 *
 * Toda rota assistencial acontece DENTRO de uma clinica. O site informa
 * qual pela cabecalho `X-Clinica` (o slug), e esta camada:
 *
 *   1. confirma que a clinica existe e nao esta encerrada;
 *   2. confirma que a pessoa logada tem vinculo ATIVO nela;
 *   3. entrega `req.contexto = { clinica, papel }` para a rota.
 *
 * Sem vinculo, a resposta e 403 - e a rota nao roda. Isso e a segunda
 * tranca: a primeira e o RLS, que barraria a consulta mesmo se esta
 * camada falhasse (a API usa a chave secreta, entao ela e quem tem de
 * se disciplinar - por isso as duas travas existem, ADR-0008).
 */
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { clinicas, vinculos, type Banco } from "@tele/db";
import type { PapelVinculo, RespostaErro } from "@tele/shared";
import { criarExigirLogin, type Autenticador } from "./autenticacao.js";

export interface ContextoClinica {
  clinicaId: string;
  slug: string;
  nomeFantasia: string;
  /** Fuso IANA da clinica. Toda hora local desta requisicao usa este. */
  fusoHorario: string;
  papel: PapelVinculo;
}

declare module "fastify" {
  interface FastifyRequest {
    contexto: ContextoClinica;
  }
}

/** Ordem de "forca" dos papeis: quem tem dois na mesma clinica age pelo maior. */
const FORCA: Record<PapelVinculo, number> = { admin_clinica: 4, medico: 3, recepcao: 2, paciente: 1 };

function erro(reply: FastifyReply, status: number, codigo: string, mensagem: string) {
  const corpo: RespostaErro = { ok: false, erro: { codigo, mensagem } };
  return reply.code(status).send(corpo);
}

/**
 * Cria o par de hooks: primeiro o porteiro do login (Modulo 4), depois a
 * resolucao da clinica. Use em `preHandler` das rotas de dentro da clinica.
 */
export function criarExigirClinica(banco: Banco, autenticar: Autenticador) {
  const exigirLogin = criarExigirLogin(autenticar);

  async function exigirClinica(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const slug = String(req.headers["x-clinica"] ?? "").trim().toLowerCase();
    if (!slug) {
      await erro(reply, 400, "CLINICA_NAO_INFORMADA", "Informe a clinica no cabecalho X-Clinica.");
      return;
    }

    const linhas = await banco
      .select({
        id: clinicas.id,
        slug: clinicas.slug,
        nomeFantasia: clinicas.nomeFantasia,
        fusoHorario: clinicas.fusoHorario,
        status: clinicas.status,
        papel: vinculos.papel,
        statusVinculo: vinculos.status,
      })
      .from(clinicas)
      .leftJoin(vinculos, and(eq(vinculos.clinicaId, clinicas.id), eq(vinculos.perfilId, req.usuario.id)))
      .where(eq(clinicas.slug, slug));

    if (linhas.length === 0) {
      await erro(reply, 404, "CLINICA_NAO_ENCONTRADA", `Nao existe clinica com o endereco "${slug}".`);
      return;
    }
    const clinica = linhas[0]!;
    if (clinica.status === "encerrada" || clinica.status === "suspensa") {
      await erro(reply, 403, "CLINICA_INDISPONIVEL", `A clinica ${clinica.nomeFantasia} esta ${clinica.status}. Fale com a administracao.`);
      return;
    }

    const ativos = linhas.filter((l) => l.papel && l.statusVinculo === "ativo");
    if (ativos.length === 0) {
      await erro(reply, 403, "SEM_VINCULO", `Voce nao tem acesso a ${clinica.nomeFantasia}.`);
      return;
    }
    const maior = ativos.sort((a, b) => FORCA[b.papel!] - FORCA[a.papel!])[0]!;

    req.contexto = {
      clinicaId: clinica.id,
      slug: clinica.slug,
      nomeFantasia: clinica.nomeFantasia,
      fusoHorario: clinica.fusoHorario,
      papel: maior.papel!,
    };
  }

  return [exigirLogin, exigirClinica];
}

/** Exige que o papel na clinica esteja entre os aceitos; senao 403. */
export function exigirPapel(...aceitos: PapelVinculo[]) {
  return async function verificar(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!aceitos.includes(req.contexto.papel)) {
      await erro(reply, 403, "PAPEL_INSUFICIENTE", `Esta acao e de ${aceitos.join(" ou ")}. Voce e ${req.contexto.papel} nesta clinica.`);
    }
  };
}
