import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { ClinicaResumo, PerfilResposta } from "@tele/shared";
import { chamarApi } from "./api";
import { tokenAtual } from "./supabase-servidor";

/**
 * Carrega, de uma vez, o que toda tela de dentro da clinica precisa:
 * o token, o perfil e a clinica atual (a do endereco /c/<slug>).
 *
 * Redireciona quando o caminho ainda nao pode ser percorrido:
 *   sem perfil            -> /completar-perfil
 *   sem nenhuma clinica   -> /clinicas
 *   slug que nao e minha  -> 404 (nao dizemos se a clinica existe: quem nao
 *                            tem vinculo nao precisa saber quem e cliente)
 *
 * Envolvida em cache(): o layout do painel e a pagina chamam as duas, e
 * dentro da mesma requisicao a API e consultada uma vez so.
 */
export const contextoDaClinica = cache(async function contextoDaClinica(slug: string): Promise<{
  token: string;
  perfil: PerfilResposta;
  clinica: ClinicaResumo;
}> {
  const token = await tokenAtual();
  const r = await chamarApi<PerfilResposta>("/perfis/eu", { token });

  if (!r.ok && r.status === 404) redirect("/completar-perfil");
  if (!r.ok) throw new Error(r.erro.mensagem);
  // LGPD (ADR-0018): sem o aceite da versao atual, nao entra.
  if ((r.dados.consentimentosPendentes ?? []).length > 0) redirect(`/aceitar-termos?depois=${encodeURIComponent(`/c/${slug}/inicio`)}`);
  if (r.dados.clinicas.length === 0) redirect("/clinicas");

  const clinica = r.dados.clinicas.find((c) => c.slug === slug);
  if (!clinica) notFound();

  return { token: token!, perfil: r.dados, clinica };
});
