/**
 * =====================================================================
 * AUTENTICACAO: quem esta chamando a API?
 * =====================================================================
 *
 * O site faz login no Supabase Auth (com a chave PUBLICA) e recebe um
 * token (JWT). Em cada chamada a API, o site manda esse token no cabecalho
 *   Authorization: Bearer <token>
 * A API pergunta ao Supabase, com a chave SECRETA, "de quem e este token?".
 * Se a resposta vier, temos o usuario. Se nao, 401.
 *
 * Por que perguntar ao Supabase em vez de validar o JWT localmente?
 * Porque assim um usuario bloqueado ou apagado deixa de entrar na hora,
 * sem depender de o token expirar.
 */
import { createClient } from "@supabase/supabase-js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RespostaErro } from "@tele/shared";
import type { Ambiente } from "./ambiente.js";

export interface Usuario {
  id: string;
  email: string | null;
}

/** Recebe o token e devolve o usuario, ou null se o token nao vale. */
export type Autenticador = (token: string) => Promise<Usuario | null>;

/** Autenticador de verdade: consulta o Supabase Auth com a chave secreta. */
export function criarAutenticadorSupabase(ambiente: Ambiente): Autenticador {
  const supabase = createClient(ambiente.SUPABASE_URL, ambiente.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  };
}

/** Le "Authorization: Bearer xxx" e devolve so o xxx (ou null). */
export function extrairToken(cabecalho: string | undefined): string | null {
  if (!cabecalho) return null;
  const [tipo, token] = cabecalho.split(" ");
  return tipo?.toLowerCase() === "bearer" && token ? token : null;
}

// Guarda o usuario dentro do request, para as rotas lerem `req.usuario`.
declare module "fastify" {
  interface FastifyRequest {
    usuario: Usuario;
  }
}

/**
 * Cria o "porteiro": um hook que as rotas protegidas usam em `preHandler`.
 * Se o token faltar ou for invalido, responde 401 e a rota nem roda.
 */
export function criarExigirLogin(autenticar: Autenticador) {
  return async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extrairToken(req.headers.authorization);
    const usuario = token ? await autenticar(token) : null;

    if (!usuario) {
      const corpo: RespostaErro = {
        ok: false,
        erro: { codigo: "NAO_AUTENTICADO", mensagem: "Faca login e envie o token em Authorization: Bearer <token>." },
      };
      await reply.code(401).send(corpo);
      return;
    }
    req.usuario = usuario;
  };
}
