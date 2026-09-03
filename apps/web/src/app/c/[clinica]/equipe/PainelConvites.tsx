"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ConviteCriado, ConviteResumo, PapelVinculo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

const PAPEIS: PapelVinculo[] = ["medico", "recepcao", "admin_clinica"];

/**
 * Convidar alguem. O link aparece UMA vez, aqui, logo depois de criar:
 * o sistema guarda so o hash do codigo, entao nem nos conseguimos mostra-lo
 * de novo. Se a pessoa perder, o caminho e revogar e convidar outra vez.
 */
export function PainelConvites({ slug, pendentes }: { slug: string; pendentes: ConviteResumo[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<PapelVinculo>("medico");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [novoLink, setNovoLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function convidar(ev: FormEvent) {
    ev.preventDefault();
    setErro(null);
    setNovoLink(null);
    setCarregando(true);

    const { data } = await criarClienteNavegador().auth.getSession();
    const token = data.session?.access_token;
    const r = await chamarApi<ConviteCriado>("/convites", { metodo: "POST", token, clinica: slug, corpo: { email: email.trim(), papel } });

    if (r.ok) {
      setNovoLink(r.dados.linkDeAceite);
      setEmail("");
      setCopiado(false);
      router.refresh();
    } else setErro(r.erro.mensagem);
    setCarregando(false);
  }

  async function revogar(id: string) {
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<{ revogado: true }>(`/convites/${id}/revogar`, { metodo: "POST", token: data.session?.access_token, clinica: slug });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
  }

  return (
    <section className="space-y-4">
      <h2 className="font-titulo text-2xl tracking-tight">Convidar profissional</h2>

      <form onSubmit={convidar} className="grid gap-4 rounded-lg border border-linha bg-superficie p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" noValidate>
        <Campo id="email" rotulo="E-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="space-y-1.5">
          <label htmlFor="papel" className="block text-sm font-medium">Entrara como</label>
          <select id="papel" value={papel} onChange={(e) => setPapel(e.target.value as PapelVinculo)} className="w-full rounded-md border border-linha bg-superficie px-3 py-2 text-base">
            {PAPEIS.map((p) => (
              <option key={p} value={p}>{NOME_DO_PAPEL[p]}</option>
            ))}
          </select>
        </div>
        <Botao type="submit" carregando={carregando}>Gerar convite</Botao>
      </form>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {novoLink ? (
        <Aviso tipo="ok">
          <p className="mb-2 font-medium">Convite criado. Copie o link e entregue a pessoa — ele nao sera mostrado de novo.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="block max-w-full overflow-x-auto rounded bg-superficie px-2 py-1 text-xs">{novoLink}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(novoLink);
                setCopiado(true);
              }}
              className="rounded border border-selo px-2 py-1 text-xs"
            >
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
        </Aviso>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-tinta-suave">Convites pendentes</h3>
        {pendentes.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhum convite aguardando resposta.</p>
        ) : (
          <ul className="divide-y divide-linha overflow-hidden rounded-lg border border-linha bg-superficie">
            {pendentes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium">{c.email}</p>
                  <p className="text-sm text-tinta-suave">
                    {NOME_DO_PAPEL[c.papel]} · vence em {new Date(c.expiraEm).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <button onClick={() => revogar(c.id)} className="text-sm text-alerta underline-offset-4 hover:underline">
                  Revogar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
