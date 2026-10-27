"use client";

import { CloudUpload, Download, FileSignature, KeyRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { DocumentoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { ambiente } from "@/lib/ambiente";
import { acaoNaApi, enviarArquivo, tokenDoNavegador } from "@/lib/navegador";

type Modo = "nuvem" | "externa";

/**
 * Dois jeitos de assinar, como nas plataformas de mercado:
 *
 *   NUVEM    CPF + codigo de 6 digitos do aplicativo do certificado; a
 *            plataforma envia so o resumo criptografico ao provedor.
 *   EXTERNA  baixar o PDF, assinar no programa que o medico ja usa (app do
 *            certificado em nuvem, Assinador ITI, token A3) e enviar de
 *            volta. A API confere que e ESTE documento e que quem assinou
 *            foi o proprio medico antes de aceitar (ADR-0017).
 *
 * O codigo do aplicativo NAO fica guardado: e usado uma vez e some.
 */
export function AssinarDocumento({ slug, documento }: { slug: string; documento: DocumentoResumo }) {
  const router = useRouter();
  const [modo, setModo] = useState<Modo | null>(null);
  const [cpf, setCpf] = useState("");
  const [otp, setOtp] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [baixado, setBaixado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  if (documento.status !== "emitido") return null;

  function fechar() {
    setModo(null);
    setErro(null);
    setOtp("");
  }

  async function assinarNaNuvem(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    const r = await acaoNaApi<DocumentoResumo>(`/documentos/${documento.id}/assinar`, {
      metodo: "POST",
      clinica: slug,
      corpo: { cpf: cpf.replace(/\D/g, ""), otp: otp.trim() },
    });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro.mensagem);
    fechar();
    router.refresh();
  }

  async function baixarPdf() {
    setErro(null);
    setOcupado(true);
    try {
      const token = await tokenDoNavegador();
      const r = await fetch(`${ambiente.apiUrl}/documentos/${documento.id}/pdf`, {
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-clinica": slug },
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { erro?: { mensagem: string } } | null;
        throw new Error(corpo?.erro?.mensagem ?? "Não foi possível gerar o PDF.");
      }
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `${documento.tipo.replace(/_/g, "-")}-${documento.numero}-${documento.ano}.pdf` });
      a.click();
      URL.revokeObjectURL(url);
      setBaixado(true);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  async function enviarAssinado(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const f = arquivo.current?.files?.[0];
    if (!f) return setErro("Escolha o PDF assinado.");
    const dados = new FormData();
    dados.set("arquivo", f);
    setOcupado(true);
    const r = await enviarArquivo<DocumentoResumo>(`/documentos/${documento.id}/assinatura-externa`, dados, slug);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro.mensagem);
    fechar();
    router.refresh();
  }

  if (!modo) {
    return (
      <div className="flex flex-wrap gap-2">
        <Botao tamanho="p" onClick={() => setModo("nuvem")} icone={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
          Assinar com certificado em nuvem
        </Botao>
        <Botao tamanho="p" variante="secundario" onClick={() => setModo("externa")} icone={<FileSignature className="h-4 w-4" aria-hidden="true" />}>
          Assinar fora da plataforma
        </Botao>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 rounded-xl border border-linha bg-superficie-alt p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{modo === "nuvem" ? "Certificado em nuvem" : "Assinar fora da plataforma"}</p>
        <button type="button" onClick={fechar} className="rounded-lg p-1 text-tinta-suave hover:bg-marinho-suave" aria-label="Fechar">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {modo === "nuvem" ? (
        <form onSubmit={assinarNaNuvem} className="space-y-3" noValidate>
          <p className="text-sm text-tinta-suave">
            Abra o aplicativo do seu certificado e informe o código de 6 dígitos. A assinatura é feita com o <strong>seu</strong> certificado - a
            plataforma envia apenas o resumo criptográfico do documento.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id={`cpf-${documento.id}`} rotulo="CPF do titular" inputMode="numeric" autoComplete="off" required value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
            <Campo
              id={`otp-${documento.id}`}
              rotulo="Código do aplicativo"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="font-mono"
            />
          </div>
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao type="submit" carregando={ocupado}>
            Assinar
          </Botao>
        </form>
      ) : (
        <form onSubmit={enviarAssinado} className="space-y-4" noValidate>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-marinho text-xs font-semibold text-white">1</span>
              <div className="space-y-2">
                <p>Baixe o PDF deste documento.</p>
                <Botao type="button" variante="secundario" tamanho="p" carregando={ocupado && !baixado} onClick={baixarPdf} icone={<Download className="h-4 w-4" aria-hidden="true" />}>
                  {baixado ? "Baixar de novo" : "Baixar PDF"}
                </Botao>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-marinho text-xs font-semibold text-white">2</span>
              <p>
                Assine no programa que você já usa: o aplicativo do seu certificado em nuvem (VIDaaS, BirdID, SafeID...), o Assinador do ITI ou o leitor de PDF
                com token A3. <strong>Não edite o PDF</strong> - só assine.
              </p>
            </li>
            <li className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-marinho text-xs font-semibold text-white">3</span>
              <div className="w-full space-y-2">
                <p>Envie o PDF assinado. Conferimos a assinatura, se o arquivo é este documento e se o certificado é seu.</p>
                <input
                  ref={arquivo}
                  type="file"
                  accept="application/pdf"
                  aria-label="PDF assinado"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-selo-suave file:px-3 file:py-2 file:text-sm file:font-medium file:text-selo-forte"
                />
              </div>
            </li>
          </ol>
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao type="submit" carregando={ocupado && baixado} icone={<CloudUpload className="h-4 w-4" aria-hidden="true" />}>
            Enviar PDF assinado
          </Botao>
        </form>
      )}
    </div>
  );
}
