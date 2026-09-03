"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { DocumentoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * Assinar com certificado em nuvem: CPF do titular e o codigo de 6 digitos
 * que o medico le no aplicativo do certificado.
 *
 * O codigo NAO fica guardado em lugar nenhum - nem em estado global, nem
 * em cookie. Ele e usado uma vez, na chamada, e some. O token que o
 * provedor devolve tambem vale para uma assinatura so.
 */
export function AssinarDocumento({ slug, documento }: { slug: string; documento: DocumentoResumo }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [cpf, setCpf] = useState("");
  const [otp, setOtp] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [assinando, setAssinando] = useState(false);

  async function assinar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAssinando(true);

    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<DocumentoResumo>(`/documentos/${documento.id}/assinar`, {
      metodo: "POST",
      token: data.session?.access_token,
      clinica: slug,
      corpo: { cpf: cpf.replace(/\D/g, ""), otp: otp.trim() },
    });

    if (r.ok) {
      setOtp("");
      setAberto(false);
      router.refresh();
    } else setErro(r.erro.mensagem);
    setAssinando(false);
  }

  if (documento.status !== "emitido") return null;

  if (!aberto) {
    return (
      <Botao variante="secundario" onClick={() => setAberto(true)} className="px-3 py-1.5 text-sm">
        Assinar digitalmente
      </Botao>
    );
  }

  return (
    <form onSubmit={assinar} className="w-full space-y-3 rounded-md border border-linha bg-papel p-4" noValidate>
      <p className="text-sm text-tinta-suave">
        Abra o aplicativo do seu certificado e informe o codigo de 6 digitos. A assinatura e feita com o <strong>seu</strong>{" "}
        certificado — a plataforma envia apenas o resumo criptografico do documento, nunca o conteudo.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id={`cpf-${documento.id}`} rotulo="CPF do titular" inputMode="numeric" autoComplete="off" required value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
        <Campo id={`otp-${documento.id}`} rotulo="Codigo do aplicativo" inputMode="numeric" autoComplete="one-time-code" required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="font-mono" />
      </div>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <div className="flex gap-3">
        <Botao type="submit" carregando={assinando}>Assinar</Botao>
        <Botao type="button" variante="secundario" onClick={() => setAberto(false)}>Cancelar</Botao>
      </div>
    </form>
  );
}
