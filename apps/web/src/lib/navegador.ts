"use client";

import type { Resposta } from "@tele/shared";
import { chamarApi } from "./api";
import { ambiente } from "./ambiente";
import { criarClienteNavegador } from "./supabase-navegador";

/** O token da sessao atual, lido no navegador. */
export async function tokenDoNavegador(): Promise<string | null> {
  const { data } = await criarClienteNavegador().auth.getSession();
  return data.session?.access_token ?? null;
}

/** chamarApi com o token da sessao - o que todo formulario do site faz. */
export async function acaoNaApi<T>(
  rota: string,
  opcoes: { metodo?: "GET" | "POST" | "PUT" | "PATCH"; corpo?: unknown; clinica?: string | null } = {},
) {
  return chamarApi<T>(rota, { ...opcoes, token: await tokenDoNavegador() });
}

/** Envio de arquivo (multipart). chamarApi so fala JSON. */
export async function enviarArquivo<T>(rota: string, dados: FormData, clinica: string): Promise<{ status: number } & Resposta<T>> {
  try {
    const token = await tokenDoNavegador();
    const r = await fetch(`${ambiente.apiUrl}${rota}`, {
      method: "POST",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-clinica": clinica },
      body: dados,
    });
    return { status: r.status, ...((await r.json()) as Resposta<T>) };
  } catch {
    return { status: 0, ok: false, erro: { codigo: "API_FORA_DO_AR", mensagem: "Não foi possível enviar o arquivo. Confira a conexão e tente de novo." } };
  }
}
