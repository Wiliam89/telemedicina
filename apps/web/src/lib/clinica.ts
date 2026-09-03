import { notFound, redirect } from "next/navigation";
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
 */
export async function contextoDaClinica(slug: string): Promise<{
  token: string;
  perfil: PerfilResposta;
  clinica: ClinicaResumo;
}> {
  const token = await tokenAtual();
  const r = await chamarApi<PerfilResposta>("/perfis/eu", { token });

  if (!r.ok && r.status === 404) redirect("/completar-perfil");
  if (!r.ok) throw new Error(r.erro.mensagem);
  if (r.dados.clinicas.length === 0) redirect("/clinicas");

  const clinica = r.dados.clinicas.find((c) => c.slug === slug);
  if (!clinica) notFound();

  return { token: token!, perfil: r.dados, clinica };
}
