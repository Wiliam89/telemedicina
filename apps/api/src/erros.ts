/**
 * Tratamento de erros em um lugar so. Toda falha sai no envelope RespostaErro
 * (ok: false, erro: { codigo, mensagem, detalhes? }) - o site conta com isso.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { RespostaErro } from "@tele/shared";

export class ErroHttp extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

export function tratarErro(erro: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  let status = 500;
  let corpo: RespostaErro = { ok: false, erro: { codigo: "ERRO_INTERNO", mensagem: "Algo deu errado do nosso lado." } };

  if (erro instanceof ZodError) {
    status = 400;
    corpo = {
      ok: false,
      erro: {
        codigo: "DADOS_INVALIDOS",
        mensagem: "Os dados enviados nao passaram na validacao.",
        detalhes: erro.issues.map((i) => ({ campo: i.path.join(".") || "(raiz)", problema: i.message })),
      },
    };
  } else if (erro instanceof ErroHttp) {
    status = erro.status;
    corpo = { ok: false, erro: { codigo: erro.codigo, mensagem: erro.message, ...(erro.detalhes !== undefined ? { detalhes: erro.detalhes } : {}) } };
  } else if ("statusCode" in erro && typeof erro.statusCode === "number" && erro.statusCode < 500) {
    // Erros que o proprio Fastify gera (JSON malformado, rate limit, etc.)
    status = erro.statusCode;
    corpo = { ok: false, erro: { codigo: erro.code ?? "REQUISICAO_INVALIDA", mensagem: erro.message } };
  } else {
    // 500 de verdade: vai para o log com detalhes, mas o cliente ve so o generico.
    req.log.error(erro);
  }

  void reply.code(status).send(corpo);
}
