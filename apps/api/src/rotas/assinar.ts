/**
 * =====================================================================
 * ROTAS DE ASSINATURA
 * =====================================================================
 *
 *   POST /documentos/:id/assinar   o medico assina (CPF + codigo do app)
 *   GET  /documentos/:id/arquivo   link temporario para baixar o PDF
 *
 * O QUE ACONTECE EM UMA ASSINATURA, na ordem:
 *
 *   1. conferimos que quem pede e o medico que emitiu, e que o documento
 *      ainda esta "emitido";
 *   2. geramos o PDF a partir do MESMO texto cujo hash foi guardado na
 *      emissao (Modulo 8) - o documento nao e remontado, e reproduzido;
 *   3. abrimos o espaco da assinatura e calculamos o ByteRange;
 *   4. pedimos autorizacao ao provedor com o CPF e o codigo do aplicativo;
 *   5. mandamos SO O HASH; o medico confirma no celular; volta o CMS;
 *   6. embutimos, verificamos a assinatura do arquivo que acabou de sair,
 *      e so entao guardamos e marcamos o documento como assinado.
 *
 * O passo 6 nao e paranoia: guardar sem conferir seria confiar que a
 * biblioteca e o provedor fizeram tudo certo. Conferimos.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicas, documentos, medicos, perfis, type Banco } from "@tele/db";
import type { DocumentoResumo, Resposta } from "@tele/shared";
import {
  ArmazenamentoDeDocumentos,
  assinarPdf,
  ErroDoProvedor,
  gerarPdfDocumento,
  prepararPdfParaAssinatura,
  verificarPdfAssinado,
  type ResolvedorDeProvedor,
} from "../assinatura/index.js";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica, exigirPapel } from "../contexto.js";
import { ErroHttp } from "../erros.js";

const esquemaAssinar = z.object({
  /** CPF do titular do certificado. Deve ser o do proprio medico. */
  cpf: z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => v.length === 11, "CPF invalido"),
  /** Codigo de 6 digitos lido no aplicativo do certificado. */
  otp: z.string().trim().regex(/^\d{6}$/, "o codigo do aplicativo tem 6 digitos"),
});

/** Traduz o erro do provedor para status HTTP e mensagem util. */
function traduzir(erro: unknown): never {
  if (erro instanceof ErroDoProvedor) {
    const status = erro.codigo === "PROVEDOR_INDISPONIVEL" ? 503 : erro.codigo === "SEM_CREDITOS" ? 402 : 400;
    throw new ErroHttp(status, erro.codigo, erro.message);
  }
  throw erro;
}

export async function rotasAssinatura(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; resolvedor: ResolvedorDeProvedor; armazenamento: ArmazenamentoDeDocumentos; urlDoSite: string },
): Promise<void> {
  const { banco, armazenamento } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);
  const soMedico = [...dentroDaClinica, exigirPapel("medico")];

  app.post("/documentos/:id/assinar", { preHandler: soMedico }, async (req): Promise<Resposta<DocumentoResumo>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);
    const credenciais = esquemaAssinar.parse(req.body);

    const [doc] = await banco
      .select({
        id: documentos.id,
        status: documentos.status,
        tipo: documentos.tipo,
        ano: documentos.ano,
        numero: documentos.numero,
        textoImpresso: documentos.textoImpresso,
        hash: documentos.hash,
        codigoValidacao: documentos.codigoValidacao,
        medicoId: documentos.medicoId,
        clinicaNome: clinicas.nomeFantasia,
        medicoNome: perfis.nomeCompleto,
        medicoCpf: perfis.cpf,
      })
      .from(documentos)
      .innerJoin(clinicas, eq(clinicas.id, documentos.clinicaId))
      .innerJoin(perfis, eq(perfis.id, documentos.medicoId))
      .where(and(eq(documentos.id, id), eq(documentos.clinicaId, req.contexto.clinicaId)))
      .limit(1);

    if (!doc) throw new ErroHttp(404, "DOCUMENTO_NAO_ENCONTRADO", "Documento nao encontrado nesta clinica.");
    if (doc.medicoId !== req.usuario.id) throw new ErroHttp(403, "NAO_E_SEU", "So quem emitiu o documento pode assina-lo.");
    if (doc.status === "assinado") throw new ErroHttp(409, "JA_ASSINADO", "Este documento ja esta assinado.");
    if (doc.status === "cancelado") throw new ErroHttp(409, "CANCELADO", "Documento cancelado nao se assina.");

    // O certificado e da PESSOA. Assinar com o CPF de outra pessoa seria
    // atribuir a ela um documento que ela nao emitiu.
    if (doc.medicoCpf && doc.medicoCpf !== credenciais.cpf) {
      throw new ErroHttp(400, "CPF_DIVERGENTE", "O CPF informado nao e o do seu cadastro. O certificado tem de ser seu.");
    }

    // 2 e 3: reproduzir o PDF e abrir o espaco da assinatura.
    const pdf = await gerarPdfDocumento({
      textoImpresso: doc.textoImpresso,
      tipo: doc.tipo,
      numero: doc.numero,
      ano: doc.ano,
      codigoValidacao: doc.codigoValidacao,
      hashTexto: doc.hash,
      urlValidacao: `${opcoes.urlDoSite}/validar`,
    });
    const preparado = await prepararPdfParaAssinatura(pdf, {
      motivo: `${doc.tipo.replace(/_/g, " ")} ${doc.numero}/${doc.ano}`,
      local: doc.clinicaNome,
      nomeDoAssinante: doc.medicoNome,
    });

    // A clinica pode ter contrato proprio com o provedor; se nao tiver,
    // usa-se o da plataforma.
    const provedor = await opcoes.resolvedor.para(req.contexto.clinicaId);

    // 4 e 5: autorizar e assinar. Escopo "unica": o token morre no uso.
    let pdfAssinado: Uint8Array;
    let idNoProvedor: string;
    let carimboEm: Date | null;
    try {
      const autorizacao = await provedor.autorizar({ cpf: credenciais.cpf, otp: credenciais.otp }, "unica");
      const resultado = await assinarPdf(preparado, provedor, autorizacao, `${doc.tipo} ${doc.numero}/${doc.ano}`);
      pdfAssinado = resultado.pdfAssinado;
      idNoProvedor = resultado.assinatura.idNoProvedor;
      carimboEm = resultado.assinatura.carimboEm;
    } catch (erro) {
      traduzir(erro);
    }

    // 6: conferir o que acabou de sair, antes de guardar.
    const conferencia = verificarPdfAssinado(pdfAssinado);
    if (!conferencia.integro || !conferencia.assinaturaValida) {
      throw new ErroHttp(502, "ASSINATURA_INVALIDA", `A assinatura devolvida nao confere: ${conferencia.problema ?? "motivo desconhecido"}`);
    }

    const caminho = ArmazenamentoDeDocumentos.caminhoDo(req.contexto.clinicaId, doc.ano, doc.id);
    const guardado = await armazenamento.guardar(caminho, pdfAssinado);

    await banco.transaction(async (tx) => {
      await tx
        .update(documentos)
        .set({
          status: "assinado",
          assinadoEm: new Date(),
          assinaturaProvedor: provedor.nome,
          assinaturaId: idNoProvedor,
          arquivoUrl: guardado.caminho,
          arquivoHash: guardado.hash,
          carimboEm,
          assinanteNome: conferencia.titular?.nome ?? null,
          assinanteCpf: conferencia.titular?.cpf ?? null,
        })
        .where(eq(documentos.id, id));

      await registrarAuditoria(tx, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "documento.assinado",
        tabela: "documentos",
        registroId: id,
        detalhes: {
          provedor: provedor.nome,
          idNoProvedor,
          // O hash do arquivo entra na auditoria: e o que permite provar,
          // depois, que o PDF baixado e o mesmo que foi assinado.
          arquivoHash: guardado.hash,
          titular: conferencia.titular?.nome ?? null,
        },
        ip: req.ip,
      });
    });

    const [atualizado] = await banco
      .select({
        id: documentos.id, tipo: documentos.tipo, status: documentos.status, ano: documentos.ano, numero: documentos.numero,
        codigoValidacao: documentos.codigoValidacao, hash: documentos.hash, textoImpresso: documentos.textoImpresso,
        assinadoEm: documentos.assinadoEm, motivoCancelamento: documentos.motivoCancelamento, criadoEm: documentos.criadoEm,
        pacienteNome: perfis.nomeCompleto, crm: medicos.crm, crmUf: medicos.crmUf,
      })
      .from(documentos)
      .innerJoin(perfis, eq(perfis.id, documentos.pacienteId))
      .innerJoin(medicos, eq(medicos.perfilId, documentos.medicoId))
      .where(eq(documentos.id, id));

    return {
      ok: true,
      dados: {
        ...atualizado!,
        status: atualizado!.status as DocumentoResumo["status"],
        assinadoEm: atualizado!.assinadoEm?.toISOString() ?? null,
        criadoEm: atualizado!.criadoEm.toISOString(),
        medico: { nomeCompleto: doc.medicoNome, crm: atualizado!.crm, crmUf: atualizado!.crmUf },
        paciente: { nomeCompleto: atualizado!.pacienteNome },
      },
    };
  });

  /**
   * O link para baixar. Nao devolvemos o arquivo direto: devolvemos um
   * endereco temporario, gerado depois de conferir quem pediu. E o mesmo
   * principio de sempre - quem decide o acesso e o servidor.
   */
  app.get("/documentos/:id/arquivo", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<{ url: string; expiraEmSegundos: number }>> => {
    const { id } = z.object({ id: z.string().uuid("id invalido") }).parse(req.params);

    const [doc] = await banco
      .select({ arquivoUrl: documentos.arquivoUrl, arquivoHash: documentos.arquivoHash, pacienteId: documentos.pacienteId, medicoId: documentos.medicoId })
      .from(documentos)
      .where(and(eq(documentos.id, id), eq(documentos.clinicaId, req.contexto.clinicaId)))
      .limit(1);

    if (!doc?.arquivoUrl) throw new ErroHttp(404, "SEM_ARQUIVO", "Este documento ainda nao foi assinado, entao nao ha PDF.");
    // So o paciente e o medico do documento baixam. Recepcao nao.
    if (doc.pacienteId !== req.usuario.id && doc.medicoId !== req.usuario.id) {
      throw new ErroHttp(403, "NAO_E_SEU", "Este documento nao e seu.");
    }

    // Confere que o arquivo guardado ainda e o que foi assinado.
    const bytes = await armazenamento.ler(doc.arquivoUrl);
    const hashAtual = createHash("sha256").update(bytes).digest("hex");
    if (hashAtual !== doc.arquivoHash) {
      throw new ErroHttp(500, "ARQUIVO_DIVERGENTE", "O arquivo guardado nao confere com o que foi assinado. Avise o suporte.");
    }

    await registrarAuditoria(banco, {
      quem: req.usuario.id,
      clinicaId: req.contexto.clinicaId,
      acao: "documento.baixado",
      tabela: "documentos",
      registroId: id,
      ip: req.ip,
    });

    return { ok: true, dados: { url: await armazenamento.linkTemporario(doc.arquivoUrl), expiraEmSegundos: 300 } };
  });
}
