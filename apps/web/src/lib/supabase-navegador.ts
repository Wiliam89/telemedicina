"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ambiente } from "./ambiente";

/**
 * Cliente do Supabase que roda NO NAVEGADOR.
 *
 * So usa a chave publicavel. Ela sozinha nao abre nada: quem decide o que
 * ela enxerga sao as politicas RLS do banco (Modulo 4).
 */
export function criarClienteNavegador() {
  return createBrowserClient(ambiente.supabaseUrl, ambiente.supabasePublishableKey);
}
