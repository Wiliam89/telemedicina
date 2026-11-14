/**
 * =====================================================================
 * CREDENCIAMENTO DO MEDICO (ADR-0022)
 * =====================================================================
 *
 * O MEDICO:
 *   GET  /credenciamento                         o meu pedido e o que falta
 *   PUT  /credenciamento                         o que quero atender (rascunho)
 *   POST /credenciamento/documentos              envia um documento ou a selfie
 *   POST /credenciamento/enviar                  manda para analise
 *
 * A ADMINISTRACAO:
 *   GET  /credenciamentos                        os pedidos, com situacao
 *   GET  /credenciamentos/documentos/:id/arquivo link temporario (auditado)
 *   POST /credenciamentos/:id/identidade         registra a conferencia das fotos
 *   POST /credenciamentos/:id/decidir            aprova, recusa ou pede ajuste
 *
 * O SERVICO DE RECONHECIMENTO FACIAL (modo externo):
 *   GET  /webhooks/identidade/:referencia/arquivos  busca as duas fotos
 *   POST /webhooks/identidade                       devolve o resultado
 *
 * A REGRA QUE ORGANIZA TUDO: ate ser aprovado, o medico e so mais uma conta.
 * Ele nao ganha o papel de medico - logo nao ve paciente, agenda nem fila.
 * O papel nasce na aprovacao, e a aprovacao exige a identidade confirmada.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { credenciamentosMedicos, documentosDoMedico, medicos, perfis, verificacoesCrm, verificacoesDeIdentidade, vinculos, type Banco } from "@tele/db";
import type { Resposta } from "@tele/shared";
import { especialidadeExiste, normalizarEspecialidades } from "@tele/shared/atendimento";
import {
  DOCUMENTOS_SO_IMAGEM,
  pendenciasDoCredenciamento,
  TIPOS_DE_DOCUMENTO_DO_MEDICO,
  VERSAO_DO_TERMO_DE_BIOMETRIA,
  type CredenciamentoParaAnalise,
  type DocumentoDoMedicoResumo,
  type MeuCredenciamento,
  type TipoDeDocumentoDoMedico,
  type VerificacaoDeIdentidadeResumo,
} from "@tele/shared/credenciamento";
import { DIAS_DE_VALIDADE_CRM } from "@tele/shared/crm";
import { TAMANHO_MAXIMO_ANEXO } from "@tele/shared/prontuario";
import { tipoPelosBytes, type ArmazenamentoDeAnexos } from "../anexos/armazenamento.js";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { situacoesCrm } from "../crm.js";
import { ErroHttp } from "../erros.js";
import { pedidoDeArquivosAutentico, resultadoAutentico, type ProvedorDeIdentidade } from "../identidade/provedor.js";
import { notificar } from "../notificacoes/index.js";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;

const codigosDeEspecialidade = z
  .array(z.string().refine(especialidadeExiste, "especialidade desconhecida"))
  .max(6, "no máximo 6 especialidades")
  .transform(normalizarEspecialidades);

/** Estados em que o medico ainda pode mexer no pedido. */
const EDITAVEL = ["rascunho", "pendente_de_ajuste", "recusado"] as const;

function mascararCpf(cpf: string | null): string | null {
  return cpf ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : null;
}

function resumirIdentidade(v: typeof verificacoesDeIdentidade.$inferSelect, por: string | null = null): VerificacaoDeIdentidadeResumo {
  return { id: v.id, provedor: v.provedor, status: v.status, pontuacao: v.pontuacao, observacao: v.observacao, verificadoPor: por, criadoEm: v.criadoEm.toISOString() };
}

export async function rotasCredenciamento(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; armazenamento: ArmazenamentoDeAnexos; identidade: ProvedorDeIdentidade; segredoDaIdentidade: string | null },
): Promise<void> {
  const { banco, armazenamento, identidade } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soAdmin = [...dentroDaClinica, exigirPapel("admin_clinica")];

  /** O documento em vigor de cada tipo: o mais recente. */
  async function documentosEmVigor(medicoId: string, clinicaId: string) {
    const todos = await banco
      .select()
      .from(documentosDoMedico)
      .where(and(eq(documentosDoMedico.medicoId, medicoId), eq(documentosDoMedico.clinicaId, clinicaId)))
      .orderBy(desc(documentosDoMedico.criadoEm));
    const vistos = new Set<string>();
    return todos.filter((d) => (vistos.has(d.tipo) ? false : (vistos.add(d.tipo), true)));
  }

  const resumirDocumento = (d: typeof documentosDoMedico.$inferSelect): DocumentoDoMedicoResumo => ({
    id: d.id,
    tipo: d.tipo,
    tipoArquivo: d.tipoArquivo,
    tamanhoBytes: d.tamanhoBytes,
    criadoEm: d.criadoEm.toISOString(),
  });

  async function ultimaIdentidade(medicoId: string, clinicaId: string) {
    const [v] = await banco
      .select()
      .from(verificacoesDeIdentidade)
      .where(and(eq(verificacoesDeIdentidade.medicoId, medicoId), eq(verificacoesDeIdentidade.clinicaId, clinicaId)))
      .orderBy(desc(verificacoesDeIdentidade.criadoEm))
      .limit(1);
    return v ?? null;
  }

  async function administradores(clinicaId: string): Promise<string[]> {
    const linhas = await banco
      .select({ perfilId: vinculos.perfilId })
      .from(vinculos)
      .where(and(eq(vinculos.clinicaId, clinicaId), eq(vinculos.papel, "admin_clinica"), eq(vinculos.status, "ativo")));
    return linhas.map((l) => l.perfilId);
  }

  // --- o medico ---------------------------------------------------------------

  app.get("/credenciamento", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<MeuCredenciamento & { medico: { crm: string; crmUf: string; especialidade: string | null } | null }>> => {
    const [pessoa] = await banco
      .select({ cpf: perfis.cpf, crm: medicos.crm, crmUf: medicos.crmUf, especialidade: medicos.especialidade })
      .from(perfis)
      .leftJoin(medicos, eq(medicos.perfilId, perfis.id))
      .where(eq(perfis.id, req.usuario.id))
      .limit(1);
    const [pedido] = await banco
      .select()
      .from(credenciamentosMedicos)
      .where(and(eq(credenciamentosMedicos.medicoId, req.usuario.id), eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    const docs = pessoa?.crm ? await documentosEmVigor(req.usuario.id, req.contexto.clinicaId) : [];
    const ultima = pessoa?.crm ? await ultimaIdentidade(req.usuario.id, req.contexto.clinicaId) : null;
    const especialidadesSolicitadas = pedido?.especialidadesSolicitadas ?? [];
    const querProntoAtendimento = pedido?.querProntoAtendimento ?? true;

    return {
      ok: true,
      dados: {
        id: pedido?.id ?? null,
        status: pedido?.status ?? "rascunho",
        especialidadesSolicitadas,
        querProntoAtendimento,
        rqe: pedido?.rqe ?? null,
        motivo: pedido?.motivo ?? null,
        enviadoEm: pedido?.enviadoEm?.toISOString() ?? null,
        decididoEm: pedido?.decididoEm?.toISOString() ?? null,
        documentos: docs.map(resumirDocumento),
        identidade: ultima ? resumirIdentidade(ultima) : null,
        pendencias: [
          ...(pessoa?.crm ? [] : ["Informe seu CRM."]),
          ...pendenciasDoCredenciamento({ documentos: docs.map((d) => d.tipo), especialidadesSolicitadas, querProntoAtendimento, temCpf: Boolean(pessoa?.cpf) }),
        ],
        urlDaProvaDeVida: ultima?.referencia && ultima.status === "pendente" ? identidade.urlDaProvaDeVida(ultima.referencia) : null,
        medico: pessoa?.crm && pessoa.crmUf ? { crm: pessoa.crm, crmUf: pessoa.crmUf, especialidade: pessoa.especialidade } : null,
      },
    };
  });

  app.put("/credenciamento", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ status: string }>> => {
    const dados = z
      .object({
        especialidadesSolicitadas: codigosDeEspecialidade,
        querProntoAtendimento: z.boolean(),
        rqe: z.string().trim().max(60).optional(),
        /** So para quem criou a conta sem dizer que e medico: o CRM entra aqui. */
        medico: z
          .object({
            crm: z.string().trim().regex(/^\d{4,7}$/, "crm: de 4 a 7 dígitos"),
            crmUf: z.enum(UFS, { message: "crmUf deve ser a sigla de um estado (ex.: SP)" }),
            especialidade: z.string().trim().min(2).max(80).optional(),
          })
          .optional(),
      })
      .parse(req.body);

    try {
      await banco.transaction(async (tx) => {
        const [m] = await tx.select({ crm: medicos.crm }).from(medicos).where(eq(medicos.perfilId, req.usuario.id)).limit(1);
        if (!m) {
          if (!dados.medico) throw new ErroHttp(400, "CRM_NECESSARIO", "Informe seu CRM e a UF para pedir o credenciamento.");
          // Nasce sem nenhuma aptidao: quem libera pronto atendimento e especialidade e a aprovacao.
          await tx.insert(medicos).values({ perfilId: req.usuario.id, crm: dados.medico.crm, crmUf: dados.medico.crmUf, especialidade: dados.medico.especialidade ?? null, atendeProntoAtendimento: false });
        }

        const [atual] = await tx
          .select({ id: credenciamentosMedicos.id, status: credenciamentosMedicos.status })
          .from(credenciamentosMedicos)
          .where(and(eq(credenciamentosMedicos.medicoId, req.usuario.id), eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId)))
          .for("update");
        if (atual && !EDITAVEL.includes(atual.status as (typeof EDITAVEL)[number])) {
          throw new ErroHttp(409, "PEDIDO_NAO_EDITAVEL", atual.status === "aprovado" ? "Seu credenciamento já foi aprovado. Para mudar o que você atende, fale com a administração." : "Seu pedido está em análise. Aguarde o retorno para alterá-lo.");
        }

        const valores = { especialidadesSolicitadas: dados.especialidadesSolicitadas, querProntoAtendimento: dados.querProntoAtendimento, rqe: dados.rqe || null, atualizadoEm: new Date() };
        if (atual) await tx.update(credenciamentosMedicos).set(valores).where(eq(credenciamentosMedicos.id, atual.id));
        else await tx.insert(credenciamentosMedicos).values({ clinicaId: req.contexto.clinicaId, medicoId: req.usuario.id, ...valores });
      });
    } catch (erro) {
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      if (codigo === "23505") throw new ErroHttp(409, "CRM_EM_USO", "Este CRM já está cadastrado em outra conta. Se for o seu, fale com o atendimento da plataforma.");
      throw erro;
    }
    return { ok: true, dados: { status: "rascunho" } };
  });

  app.post("/credenciamento/documentos", { preHandler: dentroDaClinica, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply): Promise<Resposta<DocumentoDoMedicoResumo>> => {
    if (!req.isMultipart()) throw new ErroHttp(400, "ENVIE_UM_ARQUIVO", "Envie o arquivo como multipart/form-data.");

    const [m] = await banco.select({ crm: medicos.crm }).from(medicos).where(eq(medicos.perfilId, req.usuario.id)).limit(1);
    if (!m) throw new ErroHttp(400, "CRM_NECESSARIO", "Informe seu CRM antes de enviar os documentos.");
    const [pedido] = await banco
      .select({ status: credenciamentosMedicos.status })
      .from(credenciamentosMedicos)
      .where(and(eq(credenciamentosMedicos.medicoId, req.usuario.id), eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (pedido && !EDITAVEL.includes(pedido.status as (typeof EDITAVEL)[number])) {
      throw new ErroHttp(409, "PEDIDO_NAO_EDITAVEL", "Seu pedido já foi enviado. Aguarde o retorno da administração para trocar documentos.");
    }

    const arquivo = await req.file({ limits: { fileSize: TAMANHO_MAXIMO_ANEXO, files: 1 } });
    if (!arquivo) throw new ErroHttp(400, "ENVIE_UM_ARQUIVO", "Nenhum arquivo recebido.");
    const conteudo = new Uint8Array(await arquivo.toBuffer());
    if (arquivo.file.truncated) throw new ErroHttp(413, "ARQUIVO_GRANDE_DEMAIS", "O arquivo passa de 15 MB.");
    if (conteudo.length === 0) throw new ErroHttp(400, "ARQUIVO_VAZIO", "O arquivo está vazio.");

    const campoTipo = arquivo.fields["tipo"];
    const { tipo } = z
      .object({ tipo: z.enum(TIPOS_DE_DOCUMENTO_DO_MEDICO as [TipoDeDocumentoDoMedico, ...TipoDeDocumentoDoMedico[]], { message: "tipo de documento desconhecido" }) })
      .parse({ tipo: campoTipo && !Array.isArray(campoTipo) && "value" in campoTipo ? String(campoTipo.value) : undefined });

    // O tipo vem dos BYTES, nao do nome: um executavel renomeado nao entra.
    const formato = tipoPelosBytes(conteudo);
    if (!formato) throw new ErroHttp(415, "TIPO_NAO_ACEITO", "Aceitamos PDF, JPG, PNG ou WEBP.");
    if (DOCUMENTOS_SO_IMAGEM.includes(tipo) && formato === "application/pdf") {
      throw new ErroHttp(415, "PRECISA_SER_FOTO", "Este item precisa ser uma foto (JPG, PNG ou WEBP), não um PDF: ela é comparada com o seu rosto.");
    }

    const id = randomUUID();
    const extensao = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[formato];
    const caminho = `${req.contexto.clinicaId}/credenciamento/${req.usuario.id}/${id}.${extensao}`;
    const { hash } = await armazenamento.guardar(caminho, conteudo, formato);

    const [novo] = await banco.transaction(async (tx) => {
      const criado = await tx
        .insert(documentosDoMedico)
        .values({ id, clinicaId: req.contexto.clinicaId, medicoId: req.usuario.id, tipo, caminho, tipoArquivo: formato, tamanhoBytes: conteudo.length, hash })
        .returning();
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "credenciamento.documento_enviado",
        tabela: "documentos_do_medico",
        registroId: id,
        detalhes: { tipo, bytes: conteudo.length, hash },
        ip: req.ip,
      });
      return criado;
    });

    void reply.code(201);
    return { ok: true, dados: resumirDocumento(novo!) };
  });

  app.post("/credenciamento/enviar", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ status: string; identidade: string }>> => {
    z.object({ aceitoBiometria: z.literal(true, { message: "É preciso concordar com a conferência de identidade." }) }).parse(req.body);

    const [pessoa] = await banco
      .select({ nome: perfis.nomeCompleto, cpf: perfis.cpf, crm: medicos.crm })
      .from(perfis)
      .leftJoin(medicos, eq(medicos.perfilId, perfis.id))
      .where(eq(perfis.id, req.usuario.id))
      .limit(1);
    if (!pessoa?.crm) throw new ErroHttp(400, "CRM_NECESSARIO", "Informe seu CRM antes de enviar o pedido.");

    const docs = await documentosEmVigor(req.usuario.id, req.contexto.clinicaId);
    const selfie = docs.find((d) => d.tipo === "selfie");
    const documento = docs.find((d) => d.tipo === "identidade_frente");

    // A conferencia comeca fora da transacao: o provedor pode ser um servico de rede.
    const referencia = randomUUID();
    const resultado = await identidade.iniciar({ referencia });

    const status = await banco.transaction(async (tx) => {
      const [pedido] = await tx
        .select()
        .from(credenciamentosMedicos)
        .where(and(eq(credenciamentosMedicos.medicoId, req.usuario.id), eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId)))
        .for("update");
      if (!pedido) throw new ErroHttp(400, "PEDIDO_INCOMPLETO", "Diga primeiro o que você quer atender.");
      if (!EDITAVEL.includes(pedido.status as (typeof EDITAVEL)[number])) {
        throw new ErroHttp(409, "JA_ENVIADO", pedido.status === "aprovado" ? "Seu credenciamento já foi aprovado." : "Seu pedido já está em análise.");
      }
      const faltas = pendenciasDoCredenciamento({
        documentos: docs.map((d) => d.tipo),
        especialidadesSolicitadas: pedido.especialidadesSolicitadas,
        querProntoAtendimento: pedido.querProntoAtendimento,
        temCpf: Boolean(pessoa.cpf),
      });
      if (faltas.length > 0) throw new ErroHttp(400, "PEDIDO_INCOMPLETO", "Ainda falta completar o pedido.", { pendencias: faltas });

      const agora = new Date();
      await tx
        .update(credenciamentosMedicos)
        .set({ status: "em_analise", enviadoEm: agora, consentimentoBiometriaEm: agora, consentimentoBiometriaVersao: VERSAO_DO_TERMO_DE_BIOMETRIA, motivo: null, decididoEm: null, decididoPor: null, atualizadoEm: agora })
        .where(eq(credenciamentosMedicos.id, pedido.id));
      await tx.insert(verificacoesDeIdentidade).values({
        clinicaId: req.contexto.clinicaId,
        medicoId: req.usuario.id,
        provedor: identidade.nome,
        status: resultado.status,
        pontuacao: resultado.pontuacao,
        referencia: identidade.decisaoHumana ? null : referencia,
        selfieId: selfie!.id,
        documentoId: documento!.id,
        detalhes: resultado.detalhes,
      });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "credenciamento.enviado",
        tabela: "credenciamentos_medicos",
        registroId: pedido.id,
        detalhes: { termoDeBiometria: VERSAO_DO_TERMO_DE_BIOMETRIA, identidade: identidade.nome, especialidades: pedido.especialidadesSolicitadas },
        ip: req.ip,
      });
      await notificar(
        tx,
        (await administradores(req.contexto.clinicaId)).map((perfilId) => ({
          perfilId,
          clinicaId: req.contexto.clinicaId,
          tipo: "credenciamento" as const,
          titulo: "Novo pedido de credenciamento",
          corpo: `${pessoa.nome} pediu para atender na plataforma. Confira os documentos e a identidade.`,
          link: `/c/${req.contexto.slug}/credenciamentos`,
          chave: `credenciamento_enviado:${pedido.id}:${agora.getTime()}`,
        })),
      );
      return "em_analise";
    });

    return { ok: true, dados: { status, identidade: resultado.status } };
  });

  // --- a administracao --------------------------------------------------------

  app.get("/credenciamentos", { preHandler: soAdmin }, async (req): Promise<Resposta<CredenciamentoParaAnalise[]>> => {
    const { status } = z.object({ status: z.enum(["em_analise", "pendente_de_ajuste", "aprovado", "recusado", "todos"]).default("em_analise") }).parse(req.query);
    const pedidos = await banco
      .select({ p: credenciamentosMedicos, nome: perfis.nomeCompleto, cpf: perfis.cpf, crm: medicos.crm, crmUf: medicos.crmUf, especialidade: medicos.especialidade })
      .from(credenciamentosMedicos)
      .innerJoin(perfis, eq(perfis.id, credenciamentosMedicos.medicoId))
      .innerJoin(medicos, eq(medicos.perfilId, credenciamentosMedicos.medicoId))
      .where(and(eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId), status === "todos" ? ne(credenciamentosMedicos.status, "rascunho") : eq(credenciamentosMedicos.status, status)))
      .orderBy(desc(credenciamentosMedicos.enviadoEm))
      .limit(100);
    if (pedidos.length === 0) return { ok: true, dados: [] };

    const ids = pedidos.map((x) => x.p.medicoId);
    const situacoes = await situacoesCrm(banco, req.contexto.clinicaId, ids);
    const conferente = perfis;
    const identidades = await banco
      .select({ v: verificacoesDeIdentidade, por: conferente.nomeCompleto })
      .from(verificacoesDeIdentidade)
      .leftJoin(conferente, eq(conferente.id, verificacoesDeIdentidade.verificadoPor))
      .where(and(eq(verificacoesDeIdentidade.clinicaId, req.contexto.clinicaId), inArray(verificacoesDeIdentidade.medicoId, ids)))
      .orderBy(desc(verificacoesDeIdentidade.criadoEm));

    const dados: CredenciamentoParaAnalise[] = [];
    for (const { p, nome, cpf, crm, crmUf, especialidade } of pedidos) {
      const docs = await documentosEmVigor(p.medicoId, req.contexto.clinicaId);
      const historico = identidades.filter((i) => i.v.medicoId === p.medicoId).map((i) => resumirIdentidade(i.v, i.por));
      dados.push({
        id: p.id,
        status: p.status,
        especialidadesSolicitadas: p.especialidadesSolicitadas,
        querProntoAtendimento: p.querProntoAtendimento,
        rqe: p.rqe,
        motivo: p.motivo,
        enviadoEm: p.enviadoEm?.toISOString() ?? null,
        decididoEm: p.decididoEm?.toISOString() ?? null,
        documentos: docs.map(resumirDocumento),
        identidade: historico[0] ?? null,
        historicoDeIdentidade: historico,
        medico: { id: p.medicoId, nomeCompleto: nome, cpfMascarado: mascararCpf(cpf), crm, crmUf, especialidadeDeclarada: especialidade },
        situacaoCrm: situacoes.get(p.medicoId)!,
      });
    }
    return { ok: true, dados };
  });

  /** O arquivo so sai por link temporario, e cada entrega fica na auditoria. */
  app.get("/credenciamentos/documentos/:id/arquivo", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ url: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const [d] = await banco
      .select()
      .from(documentosDoMedico)
      .where(and(eq(documentosDoMedico.id, id), eq(documentosDoMedico.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    const dono = d?.medicoId === req.usuario.id;
    // O mesmo 404 para "nao existe" e "nao e seu": nao se confirma a existencia a quem nao pode ver.
    if (!d || (!dono && !req.contexto.papeis.includes("admin_clinica"))) throw new ErroHttp(404, "DOCUMENTO_NAO_ENCONTRADO", "Documento não encontrado.");

    const url = await armazenamento.linkTemporario(d.caminho, `${d.tipo}.${d.caminho.split(".").pop()}`);
    if (!dono) {
      await registrarAuditoria(banco, { quem: req.usuario.id, clinicaId: req.contexto.clinicaId, acao: "credenciamento.documento_lido", tabela: "documentos_do_medico", registroId: id, detalhes: { medico: d.medicoId, tipo: d.tipo }, ip: req.ip });
    }
    return { ok: true, dados: { url } };
  });

  /**
   * Conferencia MANUAL: a administracao olhou a selfie ao lado da foto do
   * documento. Vale tambem para decidir um caso que o servico automatico
   * devolveu como inconclusivo - sempre com o nome de quem decidiu.
   */
  app.post("/credenciamentos/:id/identidade", { preHandler: soAdmin }, async (req, reply): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const dados = z
      .object({ resultado: z.enum(["aprovada", "reprovada"], { message: "resultado deve ser aprovada ou reprovada" }), observacao: z.string().trim().max(500).optional() })
      .superRefine((d, ctx) => {
        if (d.resultado === "reprovada" && (d.observacao ?? "").length < 5) ctx.addIssue({ code: "custom", path: ["observacao"], message: "Explique por que a identidade não foi confirmada." });
      })
      .parse(req.body);

    const [pedido] = await banco
      .select({ medicoId: credenciamentosMedicos.medicoId, status: credenciamentosMedicos.status })
      .from(credenciamentosMedicos)
      .where(and(eq(credenciamentosMedicos.id, id), eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId)))
      .limit(1);
    if (!pedido) throw new ErroHttp(404, "PEDIDO_NAO_ENCONTRADO", "Pedido de credenciamento não encontrado.");
    if (pedido.status !== "em_analise") throw new ErroHttp(409, "PEDIDO_FORA_DE_ANALISE", "Só se confere a identidade de pedido em análise.");
    // Ninguem confere a propria identidade.
    if (pedido.medicoId === req.usuario.id) throw new ErroHttp(403, "CONFERENCIA_PROPRIA", "Outra pessoa da administração precisa conferir a sua identidade.");

    const docs = await documentosEmVigor(pedido.medicoId, req.contexto.clinicaId);
    const selfie = docs.find((d) => d.tipo === "selfie");
    const documento = docs.find((d) => d.tipo === "identidade_frente");
    if (!selfie || !documento) throw new ErroHttp(409, "FOTOS_AUSENTES", "Faltam a selfie ou a foto do documento neste pedido.");

    await banco.transaction(async (tx) => {
      const [v] = await tx
        .insert(verificacoesDeIdentidade)
        .values({ clinicaId: req.contexto.clinicaId, medicoId: pedido.medicoId, provedor: "manual", status: dados.resultado, selfieId: selfie.id, documentoId: documento.id, observacao: dados.observacao ?? null, verificadoPor: req.usuario.id })
        .returning({ id: verificacoesDeIdentidade.id });
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: dados.resultado === "aprovada" ? "identidade.confirmada" : "identidade.nao_confirmada",
        tabela: "verificacoes_de_identidade",
        registroId: v!.id,
        detalhes: { medico: pedido.medicoId, metodo: "manual" },
        ip: req.ip,
      });
    });
    void reply.code(201);
    return { ok: true, dados: { status: dados.resultado } };
  });

  app.post("/credenciamentos/:id/decidir", { preHandler: soAdmin }, async (req): Promise<Resposta<{ status: string }>> => {
    const { id } = z.object({ id: z.string().uuid("id inválido") }).parse(req.params);
    const dados = z
      .object({
        decisao: z.enum(["aprovar", "recusar", "pedir_ajuste"], { message: "decisao deve ser aprovar, recusar ou pedir_ajuste" }),
        motivo: z.string().trim().max(1000).optional(),
        /** O que a administracao LIBERA (pode ser menos do que o medico pediu). */
        especialidades: codigosDeEspecialidade.optional(),
        atendeProntoAtendimento: z.boolean().optional(),
        /** Opcional: a conferencia do CRM no Conselho, registrada junto (ADR-0016). */
        crm: z
          .object({
            nomeNoConselho: z.string().trim().min(3, "Informe o nome como aparece no Conselho.").max(200),
            situacaoNoConselho: z.string().trim().min(2).max(60).refine((s) => /^ativ/i.test(s), "Só se verifica CRM com situação ATIVA no Conselho."),
            especialidadesNoConselho: z.string().trim().max(300).optional(),
          })
          .optional(),
      })
      .superRefine((d, ctx) => {
        if (d.decisao !== "aprovar" && (d.motivo ?? "").length < 5) ctx.addIssue({ code: "custom", path: ["motivo"], message: "Explique o motivo: o médico vai ler esta mensagem." });
      })
      .parse(req.body);

    const resultado = await banco.transaction(async (tx) => {
      const [pedido] = await tx
        .select()
        .from(credenciamentosMedicos)
        .where(and(eq(credenciamentosMedicos.id, id), eq(credenciamentosMedicos.clinicaId, req.contexto.clinicaId)))
        .for("update");
      if (!pedido) throw new ErroHttp(404, "PEDIDO_NAO_ENCONTRADO", "Pedido de credenciamento não encontrado.");
      if (pedido.status !== "em_analise") throw new ErroHttp(409, "PEDIDO_FORA_DE_ANALISE", "Este pedido não está em análise. Recarregue a página.");
      if (pedido.medicoId === req.usuario.id) throw new ErroHttp(403, "DECISAO_PROPRIA", "Outra pessoa da administração precisa decidir o seu credenciamento.");

      const agora = new Date();
      const [m] = await tx.select({ crm: medicos.crm, crmUf: medicos.crmUf }).from(medicos).where(eq(medicos.perfilId, pedido.medicoId)).limit(1);

      if (dados.decisao === "aprovar") {
        // A regra central: sem identidade confirmada, ninguem atende.
        const [ultima] = await tx
          .select({ status: verificacoesDeIdentidade.status })
          .from(verificacoesDeIdentidade)
          .where(and(eq(verificacoesDeIdentidade.medicoId, pedido.medicoId), eq(verificacoesDeIdentidade.clinicaId, req.contexto.clinicaId)))
          .orderBy(desc(verificacoesDeIdentidade.criadoEm))
          .limit(1);
        if (ultima?.status !== "aprovada") {
          throw new ErroHttp(409, "IDENTIDADE_NAO_CONFIRMADA", "Confirme a identidade do médico (selfie e documento) antes de aprovar.");
        }

        const especialidades = dados.especialidades ?? pedido.especialidadesSolicitadas;
        const atendePronto = dados.atendeProntoAtendimento ?? pedido.querProntoAtendimento;
        if (!atendePronto && especialidades.length === 0) throw new ErroHttp(400, "NADA_LIBERADO", "Libere ao menos o pronto atendimento ou uma especialidade.");
        // Nao se libera especialidade que o medico nao pediu (e para a qual nao enviou titulo).
        const naoPedidas = especialidades.filter((e) => !pedido.especialidadesSolicitadas.includes(e));
        if (naoPedidas.length > 0) throw new ErroHttp(400, "ESPECIALIDADE_NAO_PEDIDA", "Só é possível liberar especialidades que o médico pediu.");

        await tx.update(medicos).set({ especialidades, atendeProntoAtendimento: atendePronto }).where(eq(medicos.perfilId, pedido.medicoId));
        const vinculo = await tx
          .insert(vinculos)
          .values({ perfilId: pedido.medicoId, clinicaId: req.contexto.clinicaId, papel: "medico" })
          .onConflictDoUpdate({ target: [vinculos.perfilId, vinculos.clinicaId, vinculos.papel], set: { status: "ativo", atualizadoEm: agora }, where: ne(vinculos.status, "suspenso") })
          .returning({ id: vinculos.id });
        if (vinculo.length === 0) throw new ErroHttp(409, "MEDICO_SUSPENSO", "Este médico está suspenso. Reative-o na tela Equipe antes de aprovar um novo pedido.");

        if (dados.crm && m) {
          await tx.insert(verificacoesCrm).values({
            medicoId: pedido.medicoId,
            clinicaId: req.contexto.clinicaId,
            resultado: "verificado",
            metodo: "consulta_manual_cfm",
            crm: m.crm,
            crmUf: m.crmUf,
            nomeNoConselho: dados.crm.nomeNoConselho,
            situacaoNoConselho: dados.crm.situacaoNoConselho,
            especialidadesNoConselho: dados.crm.especialidadesNoConselho ?? null,
            verificadoPor: req.usuario.id,
            validoAte: new Date(agora.getTime() + DIAS_DE_VALIDADE_CRM * 86400000),
          });
        }
      }

      const novoStatus = dados.decisao === "aprovar" ? "aprovado" : dados.decisao === "recusar" ? "recusado" : "pendente_de_ajuste";
      await tx
        .update(credenciamentosMedicos)
        .set({ status: novoStatus, decididoEm: agora, decididoPor: req.usuario.id, motivo: dados.decisao === "aprovar" ? null : dados.motivo!, atualizadoEm: agora })
        .where(eq(credenciamentosMedicos.id, id));
      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: `credenciamento.${novoStatus}`,
        tabela: "credenciamentos_medicos",
        registroId: id,
        detalhes: { medico: pedido.medicoId, crmConferido: Boolean(dados.crm), ...(dados.decisao === "aprovar" ? { especialidades: dados.especialidades ?? pedido.especialidadesSolicitadas } : {}) },
        ip: req.ip,
      });
      await notificar(tx, {
        perfilId: pedido.medicoId,
        clinicaId: req.contexto.clinicaId,
        tipo: "credenciamento",
        titulo: novoStatus === "aprovado" ? "Credenciamento aprovado" : novoStatus === "recusado" ? "Credenciamento não aprovado" : "Seu credenciamento precisa de ajuste",
        corpo:
          novoStatus === "aprovado"
            ? `Você já faz parte da equipe de ${req.contexto.nomeFantasia}.${dados.crm ? " Monte seus horários e fique online para atender." : " Falta só a conferência do seu CRM no Conselho, que a administração faz em seguida."}`
            : "Abra o seu pedido para ver a mensagem da administração.",
        link: novoStatus === "aprovado" ? `/c/${req.contexto.slug}/inicio` : `/c/${req.contexto.slug}/credenciamento`,
        chave: `credenciamento_decidido:${id}:${agora.getTime()}`,
      });
      return novoStatus;
    });

    return { ok: true, dados: { status: resultado } };
  });

  // --- o servico de reconhecimento facial -------------------------------------

  /**
   * O servico de fora busca as duas fotos que vai comparar. Rota publica (ele
   * nao tem login), mas so responde a quem assina o pedido com o segredo
   * combinado, e os links valem poucos minutos.
   */
  app.get("/webhooks/identidade/:referencia/arquivos", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const segredo = opcoes.segredoDaIdentidade;
    if (!segredo) return reply.code(503).send({ ok: false });
    const { referencia } = z.object({ referencia: z.string().uuid() }).parse(req.params);
    const { ts } = z.object({ ts: z.coerce.number() }).parse(req.query);
    if (!pedidoDeArquivosAutentico(referencia, ts, String(req.headers["x-assinatura"] ?? ""), segredo)) {
      req.log.warn({ ip: req.ip }, "pedido de arquivos de identidade com assinatura invalida");
      return reply.code(401).send({ ok: false });
    }

    const [v] = await banco.select().from(verificacoesDeIdentidade).where(and(eq(verificacoesDeIdentidade.referencia, referencia), eq(verificacoesDeIdentidade.status, "pendente"))).limit(1);
    if (!v || !v.selfieId || !v.documentoId) return reply.code(404).send({ ok: false });
    const arquivos = await banco.select({ id: documentosDoMedico.id, caminho: documentosDoMedico.caminho }).from(documentosDoMedico).where(inArray(documentosDoMedico.id, [v.selfieId, v.documentoId]));
    const link = async (id: string) => armazenamento.linkTemporario(arquivos.find((a) => a.id === id)!.caminho, "foto");

    await registrarAuditoria(banco, { quem: null, clinicaId: v.clinicaId, acao: "identidade.fotos_entregues_ao_servico", tabela: "verificacoes_de_identidade", registroId: v.id, detalhes: { provedor: v.provedor }, ip: req.ip });
    return { ok: true, dados: { referencia, selfie: await link(v.selfieId), documento: await link(v.documentoId) } };
  });

  /**
   * O resultado do reconhecimento facial. Tres cuidados, como no pagamento:
   * conferir a assinatura, recusar aviso velho e dar o mesmo resultado se o
   * mesmo aviso chegar duas vezes.
   */
  app.post("/webhooks/identidade", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const segredo = opcoes.segredoDaIdentidade;
    if (!segredo) {
      req.log.error("aviso de identidade recebido, mas IDENTIDADE_WEBHOOK_SEGREDO nao esta definido");
      return reply.code(503).send({ ok: false });
    }
    const corpo = z
      .object({
        referencia: z.string().uuid(),
        status: z.enum(["aprovada", "reprovada", "inconclusiva"]),
        pontuacao: z.number().int().min(0).max(100).nullable().optional(),
        ts: z.number(),
      })
      .safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ ok: false });
    const aviso = { ...corpo.data, pontuacao: corpo.data.pontuacao ?? null };

    if (!resultadoAutentico(aviso, String(req.headers["x-assinatura"] ?? ""), segredo)) {
      req.log.warn({ ip: req.ip }, "aviso de identidade com assinatura invalida");
      return reply.code(401).send({ ok: false });
    }

    const [aberta] = await banco.select().from(verificacoesDeIdentidade).where(and(eq(verificacoesDeIdentidade.referencia, aviso.referencia), eq(verificacoesDeIdentidade.status, "pendente"))).limit(1);
    if (!aberta) return reply.code(404).send({ ok: false, desconhecido: true });

    // O primeiro resultado vale. Um segundo aviso, igual ou diferente, nao muda nada:
    // para rever uma conferencia, o medico envia novas fotos e abre outra.
    const [jaDecidida] = await banco
      .select({ id: verificacoesDeIdentidade.id })
      .from(verificacoesDeIdentidade)
      .where(and(eq(verificacoesDeIdentidade.referencia, aviso.referencia), ne(verificacoesDeIdentidade.status, "pendente")))
      .limit(1);
    if (jaDecidida) return reply.code(200).send({ ok: true, repetido: true });

    try {
      await banco.transaction(async (tx) => {
        // Somente insercao: o resultado e uma linha nova, a abertura continua la.
        const [v] = await tx
          .insert(verificacoesDeIdentidade)
          .values({ clinicaId: aberta.clinicaId, medicoId: aberta.medicoId, provedor: aberta.provedor, status: aviso.status, pontuacao: aviso.pontuacao, referencia: aviso.referencia, selfieId: aberta.selfieId, documentoId: aberta.documentoId, detalhes: { origem: "aviso assinado" } })
          .returning({ id: verificacoesDeIdentidade.id });
        await registrarAuditoria(tx, { quem: null, clinicaId: aberta.clinicaId, acao: `identidade.${aviso.status}`, tabela: "verificacoes_de_identidade", registroId: v!.id, detalhes: { medico: aberta.medicoId, provedor: aberta.provedor, pontuacao: aviso.pontuacao }, ip: req.ip });
        await notificar(
          tx,
          (await administradores(aberta.clinicaId)).map((perfilId) => ({
            perfilId,
            clinicaId: aberta.clinicaId,
            tipo: "credenciamento" as const,
            titulo: "Conferência de identidade concluída",
            corpo: "O serviço de reconhecimento facial devolveu o resultado de um pedido de credenciamento.",
            link: null,
            chave: `identidade_resultado:${v!.id}`,
          })),
        );
      });
    } catch (erro) {
      // O indice unico (referencia, status) recusa o mesmo aviso repetido: ja foi processado.
      const codigo = (erro as { cause?: { code?: string } }).cause?.code ?? (erro as { code?: string }).code;
      if (codigo !== "23505") throw erro;
    }
    return reply.code(200).send({ ok: true });
  });
}
