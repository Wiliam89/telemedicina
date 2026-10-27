"use client";

import { Check, Copy, DoorClosed, DoorOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StatusClinica } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { Etiqueta } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * Abrir a clinica para pacientes e divulgar a porta de entrada.
 * Enquanto "em implantacao", o link publico avisa que a clinica nao esta
 * aceitando pacientes - a equipe monta tudo sem pressa.
 */
export function SituacaoDaClinica({ slug, status }: { slug: string; status: StatusClinica }) {
  const router = useRouter();
  const [link, setLink] = useState(`/entrar-na-clinica/${slug}`);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => setLink(`${window.location.origin}/entrar-na-clinica/${slug}`), [slug]);

  async function mudar(novo: "ativa" | "em_implantacao") {
    setErro(null);
    setOcupado(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi("/clinicas/atual/status", { metodo: "POST", token: data.session?.access_token, clinica: slug, corpo: { status: novo } });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  async function copiar() {
    await navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const ativa = status === "ativa";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {ativa ? <Etiqueta tom="selo">Aberta para pacientes</Etiqueta> : <Etiqueta tom="espera">Em implantação</Etiqueta>}
          <p className="text-sm text-tinta-suave">
            {ativa ? "Pacientes podem se cadastrar pelo link abaixo." : "Pacientes ainda não conseguem entrar pelo link público."}
          </p>
        </div>
        {status === "suspensa" || status === "encerrada" ? null : ativa ? (
          <Botao variante="secundario" tamanho="p" carregando={ocupado} onClick={() => mudar("em_implantacao")} icone={<DoorClosed className="h-4 w-4" aria-hidden="true" />}>
            Fechar para novos pacientes
          </Botao>
        ) : (
          <Botao tamanho="p" carregando={ocupado} onClick={() => mudar("ativa")} icone={<DoorOpen className="h-4 w-4" aria-hidden="true" />}>
            Abrir clínica
          </Botao>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="link-entrada" className="block text-sm font-medium">
          Link de entrada do paciente
        </label>
        <div className="flex gap-2">
          <input id="link-entrada" readOnly value={link} className={`${CLASSE_CONTROLE} border-linha font-mono text-sm`} onFocus={(e) => e.target.select()} />
          <Botao variante="secundario" onClick={copiar} icone={copiado ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}>
            {copiado ? "Copiado" : "Copiar"}
          </Botao>
        </div>
        <p className="text-xs text-tinta-suave">Divulgue no site da clínica, num QR Code na recepção ou por WhatsApp.</p>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}
