/**
 * =====================================================================
 * ROTAS DE CLINICA
 * =====================================================================
 *
 *   POST /clinicas          cria uma clinica; quem cria vira admin dela
 *   GET  /clinicas/atual    dados da clinica do cabecalho X-Clinica
 *
 * Criar clinica NAO exige papel nenhum: e o momento em que alguem de fora
 * se torna cliente. O que exige e ter perfil - a pessoa precisa existir
 * antes de abrir uma clinica.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, pacientes, perfis, vinculos, type Banco } from "@tele/db";
import type { ClinicaResumo, Resposta } from "@tele/shared";
import { registrarAuditoria } from "../auditoria.js";
import type { ResolvedorDeProvedor } from "../assinatura/index.js";
import { cifrar } from "../criptografia.js";
import { criarExigirLogin, type Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

/** Confere os digitos verificadores do CNPJ (o mesmo algoritmo da Receita). */
export function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (tam: number) => {
    let soma = 0;
    let peso = tam - 7;
    for (let i = 0; i < tam; i++) {
      soma += Number(d[i]) * peso;
      peso = peso - 1 < 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

const RESERVADOS = ["www", "api", "app", "admin", "suporte", "conta", "entrar", "criar-conta", "convite", "clinicas", "diagnostico", "static", "assets"];

/**
 * O fuso existe de verdade? Intl conhece a lista IANA; nao mantemos a nossa.
 *
 * Recusamos deslocamento ("-03:00", "+0500") de proposito, embora o
 * JavaScript moderno os aceite: deslocamento nao sabe de horario de verao,
 * entao uma clinica cadastrada assim erraria a agenda por uma hora durante
 * parte do ano. So nome IANA ("America/Manaus") ou "UTC".
 */
export function fusoValido(fuso: string): boolean {
  if (/^[+-]\d{2}:?\d{2}$/.test(fuso)) return false;
  if (fuso !== "UTC" && !fuso.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

const esquemaCriarClinica = z.object({
  nomeFantasia: z.string().trim().min(3, "nomeFantasia precisa ter ao menos 3 letras").max(80),
  razaoSocial: z.string().trim().min(3, "razaoSocial precisa ter ao menos 3 letras").max(120),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 14, "cnpj: 14 digitos")
    .refine(cnpjValido, "cnpj invalido: confira os digitos"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/, "endereco: de 4 a 40 letras minusculas, numeros ou hifen, sem comecar nem terminar com hifen")
    .refine((v) => !RESERVADOS.includes(v), "este endereco e reservado pelo sistema"),
  /** Fuso IANA. Padrao: Brasilia. Ex.: America/Manaus, America/Rio_Branco. */
  fusoHorario: z
    .string()
    .trim()
    .default("America/Sao_Paulo")
    .refine(fusoValido, "fuso horario desconhecido (use o nome IANA, ex.: America/Manaus)"),
});

export async function rotasClinicas(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; resolvedor: ResolvedorDeProvedor; chaveDeCriptografia: Buffer | null },
): Promise<void> {
  const exigirLogin = criarExigirLogin(opcoes.autenticar);
  const dentroDaClinica = criarExigirClinica(opcoes.banco, opcoes.autenticar);
  const { banco } = opcoes;

  app.post("/clinicas", { preHandler: exigirLogin }, async (req, reply): Promise<Resposta<ClinicaResumo>> => {
    const dados = esquemaCriarClinica.parse(req.body);

    const [perfil] = await banco.select({ id: perfis.id }).from(perfis).where(eq(perfis.id, req.usuario.id)).limit(1);
    if (!perfil) throw new ErroHttp(400, "PERFIL_NECESSARIO", "Complete seu perfil antes de criar uma clinica.");

    let criada: { id: string; slug: string; nomeFantasia: string; status: ClinicaResumo["status"]; fusoHorario: string };
    try {
      criada = await banco.transaction(async (tx) => {
        const [c] = await tx
          .insert(clinicas)
          .values({ slug: dados.slug, nomeFantasia: dados.nomeFantasia, razaoSocial: dados.razaoSocial, cnpj: dados.cnpj, fusoHorario: dados.fusoHorario })
          .returning({ id: clinicas.id, slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia, status: clinicas.status, fusoHorario: clinicas.fusoHorario });
        // Quem cria administra: sem isso a clinica nasceria sem dono.
        await tx.insert(vinculos).values({ perfilId: req.usuario.id, clinicaId: c!.id, papel: "admin_clinica" });
        await registrarAuditoria(tx, {
          quem: req.usuario.id,
          clinicaId: c!.id,
          acao: "clinica.criada",
          tabela: "clinicas",
          registroId: c!.id,
          detalhes: { slug: c!.slug, fusoHorario: dados.fusoHorario },
          ip: req.ip,
        });
        return c!;
      });
    } catch (erro) {
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      const detalhe = String((erro as { cause?: { detail?: string } }).cause?.detail ?? "");
      if (codigo === "23505") {
        if (detalhe.includes("slug")) throw new ErroHttp(409, "ENDERECO_EM_USO", "Este endereco ja esta em uso por outra clinica. Escolha outro.");
        throw new ErroHttp(409, "CNPJ_EM_USO", "Ja existe uma clinica cadastrada com este CNPJ.");
      }
      throw erro;
    }

    void reply.code(201);
    return { ok: true, dados: { ...criada, papel: "admin_clinica" } };
  });

  /**
   * Ajustes da clinica. Hoje so o fuso; a tela de configuracao completa
   * (razao social, RT, logo) entra no modulo de administracao.
   *
   * Trocar o fuso NAO mexe nas consultas ja marcadas: elas guardam o
   * instante absoluto, que nao muda. O que muda e a leitura da grade
   * semanal - por isso o aviso na resposta.
   */
  app.patch("/clinicas/atual", { preHandler: [...dentroDaClinica, exigirPapel("admin_clinica")] }, async (req): Promise<Resposta<ClinicaResumo>> => {
    const { fusoHorario } = z
      .object({ fusoHorario: z.string().trim().refine(fusoValido, "fuso horario desconhecido (use o nome IANA, ex.: America/Manaus)") })
      .parse(req.body);

    const anterior = req.contexto.fusoHorario;
    const [c] = await banco
      .update(clinicas)
      .set({ fusoHorario, atualizadoEm: new Date() })
      .where(eq(clinicas.id, req.contexto.clinicaId))
      .returning({ id: clinicas.id, slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia, status: clinicas.status, fusoHorario: clinicas.fusoHorario });

    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "clinica.fuso_alterado",
      tabela: "clinicas",
      registroId: req.contexto.clinicaId,
      detalhes: { de: anterior, para: fusoHorario },
      ip: req.ip,
    });

    return { ok: true, dados: { ...c!, papel: req.contexto.papel } };
  });

  /**
   * Credenciais PROPRIAS da clinica no provedor de assinatura.
   *
   * Enviar `null` remove e faz a clinica voltar a usar as credenciais da
   * plataforma. O segredo e cifrado antes de tocar o banco, e a resposta
   * NUNCA o devolve - nem cifrado. Uma vez guardado, so se substitui.
   */
  app.put("/clinicas/atual/assinatura", { preHandler: [...dentroDaClinica, exigirPapel("admin_clinica")] }, async (req): Promise<Resposta<{ configurado: boolean; provedor: string | null }>> => {
    const dados = z
      .object({
        provedor: z.enum(["birdid"]).nullable(),
        url: z.string().url("informe a URL do provedor").optional(),
        clientId: z.string().trim().min(1, "informe o client id").optional(),
        clientSecret: z.string().trim().min(1, "informe o client secret").optional(),
      })
      .superRefine((v, ctx) => {
        if (v.provedor && (!v.url || !v.clientId || !v.clientSecret)) {
          ctx.addIssue({ code: "custom", message: "para usar credenciais proprias, informe url, clientId e clientSecret" });
        }
      })
      .parse(req.body);

    if (dados.provedor === null) {
      await banco
        .update(clinicas)
        .set({ assinaturaProvedor: null, assinaturaUrl: null, assinaturaClientId: null, assinaturaClientSecretCifrado: null, atualizadoEm: new Date() })
        .where(eq(clinicas.id, req.contexto.clinicaId));
      opcoes.resolvedor.esquecer(req.contexto.clinicaId);
      await registrarAuditoria(banco, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "clinica.assinatura_removida",
        tabela: "clinicas",
        registroId: req.contexto.clinicaId,
        ip: req.ip,
      });
      return { ok: true, dados: { configurado: false, provedor: null } };
    }

    if (!opcoes.chaveDeCriptografia) {
      throw new ErroHttp(
        503,
        "SEM_CHAVE_DE_CRIPTOGRAFIA",
        "Para guardar credenciais de assinatura e preciso definir CHAVE_CRIPTOGRAFIA em apps/api/.env.",
      );
    }

    await banco
      .update(clinicas)
      .set({
        assinaturaProvedor: dados.provedor,
        assinaturaUrl: dados.url!,
        assinaturaClientId: dados.clientId!,
        assinaturaClientSecretCifrado: cifrar(dados.clientSecret!, opcoes.chaveDeCriptografia),
        atualizadoEm: new Date(),
      })
      .where(eq(clinicas.id, req.contexto.clinicaId));
    opcoes.resolvedor.esquecer(req.contexto.clinicaId);

    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "clinica.assinatura_configurada",
      tabela: "clinicas",
      registroId: req.contexto.clinicaId,
      // O segredo nao entra na auditoria. Nem cifrado.
      detalhes: { provedor: dados.provedor, url: dados.url },
      ip: req.ip,
    });

    return { ok: true, dados: { configurado: true, provedor: dados.provedor } };
  });

  /** Diz apenas SE ha credencial propria - nunca qual. */
  app.get("/clinicas/atual/assinatura", { preHandler: [...dentroDaClinica, exigirPapel("admin_clinica")] }, async (req): Promise<Resposta<{ configurado: boolean; provedor: string | null; url: string | null }>> => {
    const [c] = await banco
      .select({ provedor: clinicas.assinaturaProvedor, url: clinicas.assinaturaUrl, secret: clinicas.assinaturaClientSecretCifrado })
      .from(clinicas)
      .where(eq(clinicas.id, req.contexto.clinicaId))
      .limit(1);
    const configurado = Boolean(c?.provedor && c.secret);
    return { ok: true, dados: { configurado, provedor: configurado ? c!.provedor : null, url: configurado ? c!.url : null } };
  });

  /**
   * ENTRAR NUMA CLINICA COMO PACIENTE (autocadastro).
   *
   * Ate o Modulo 9 so havia duas portas: criar uma clinica, ou aceitar
   * convite. Faltava a mais comum de todas - a pessoa que chega pelo site
   * da clinica, ou pelo QR Code na recepcao, e quer ser atendida ali.
   *
   * Nao e convite: e o paciente se apresentando. Por isso o unico papel
   * que esta rota concede e "paciente", e nunca outro. Medico e recepcao
   * continuam entrando so por convite da administracao - senao qualquer
   * pessoa se cadastraria como medica da clinica.
   */
  app.post("/clinicas/:slug/entrar", { preHandler: exigirLogin }, async (req, reply): Promise<Resposta<ClinicaResumo>> => {
    const { slug } = z.object({ slug: z.string().trim().toLowerCase().min(3) }).parse(req.params);

    const [perfil] = await banco
      .select({ id: perfis.id, nascimento: pacientes.dataNascimento })
      .from(perfis)
      .leftJoin(pacientes, eq(pacientes.perfilId, perfis.id))
      .where(eq(perfis.id, req.usuario.id))
      .limit(1);
    if (!perfil) throw new ErroHttp(400, "PERFIL_NECESSARIO", "Complete seu perfil antes de entrar numa clinica.");
    if (!perfil.nascimento) {
      throw new ErroHttp(400, "DADOS_DE_PACIENTE_NECESSARIOS", "Para ser atendido, informe sua data de nascimento no perfil.");
    }

    const [c] = await banco
      .select({ id: clinicas.id, slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia, status: clinicas.status, fusoHorario: clinicas.fusoHorario })
      .from(clinicas)
      .where(eq(clinicas.slug, slug))
      .limit(1);
    if (!c) throw new ErroHttp(404, "CLINICA_NAO_ENCONTRADA", `Nao existe clinica com o endereco "${slug}".`);
    if (c.status !== "ativa") {
      throw new ErroHttp(409, "CLINICA_INDISPONIVEL", `${c.nomeFantasia} nao esta aceitando novos pacientes no momento.`);
    }

    await banco.transaction(async (tx) => {
      await tx
        .insert(vinculos)
        .values({ perfilId: req.usuario.id, clinicaId: c.id, papel: "paciente" })
        .onConflictDoUpdate({ target: [vinculos.perfilId, vinculos.clinicaId, vinculos.papel], set: { status: "ativo", atualizadoEm: new Date() } });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: c.id,
        acao: "paciente.entrou_na_clinica",
        tabela: "vinculos",
        registroId: req.usuario.id,
        ip: req.ip,
      });
    });

    void reply.code(201);
    return { ok: true, dados: { ...c, papel: "paciente" } };
  });

  /** Dados publicos de uma clinica, para a pagina de entrada do paciente. */
  app.get("/clinicas/:slug/publico", async (req): Promise<Resposta<{ slug: string; nomeFantasia: string; aceitandoPacientes: boolean }>> => {
    const { slug } = z.object({ slug: z.string().trim().toLowerCase().min(3) }).parse(req.params);
    const [c] = await banco
      .select({ slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia, status: clinicas.status })
      .from(clinicas)
      .where(eq(clinicas.slug, slug))
      .limit(1);
    if (!c) throw new ErroHttp(404, "CLINICA_NAO_ENCONTRADA", "Clinica nao encontrada.");
    // Nada alem do nome: quem nao tem vinculo nao precisa saber mais.
    return { ok: true, dados: { slug: c.slug, nomeFantasia: c.nomeFantasia, aceitandoPacientes: c.status === "ativa" } };
  });

  app.get("/clinicas/atual", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<ClinicaResumo>> => {
    const [c] = await banco
      .select({ id: clinicas.id, slug: clinicas.slug, nomeFantasia: clinicas.nomeFantasia, status: clinicas.status, fusoHorario: clinicas.fusoHorario })
      .from(clinicas)
      .where(eq(clinicas.id, req.contexto.clinicaId))
      .limit(1);
    return { ok: true, dados: { ...c!, papel: req.contexto.papel } };
  });
}
