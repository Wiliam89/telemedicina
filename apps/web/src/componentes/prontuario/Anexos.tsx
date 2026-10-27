"use client";

import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { AnexoResumo } from "@tele/shared";
import { CATEGORIAS_DE_ANEXO, TAMANHO_MAXIMO_ANEXO } from "@tele/shared/prontuario";
import { Aviso } from "../Aviso";
import { Botao } from "../Botao";
import { Campo, CLASSE_CONTROLE } from "../Campo";
import { acaoNaApi, enviarArquivo } from "@/lib/navegador";

/** Envia um exame ou laudo (PDF ou imagem, ate 15 MB). */
export function EnviarAnexo({ slug, pacienteId, consultaId }: { slug: string; pacienteId: string; consultaId?: string }) {
  const router = useRouter();
  const arquivo = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<keyof typeof CATEGORIAS_DE_ANEXO>("exame_laboratorial");
  const [data, setData] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const f = arquivo.current?.files?.[0];
    if (!f) return setErro("Escolha o arquivo.");
    if (f.size > TAMANHO_MAXIMO_ANEXO) return setErro("O arquivo passa de 15 MB.");
    if (titulo.trim().length < 2) return setErro("Dê um título ao anexo (ex.: Hemograma completo).");

    const dados = new FormData();
    dados.set("titulo", titulo.trim());
    dados.set("categoria", categoria);
    if (data) dados.set("dataDoExame", data);
    if (consultaId) dados.set("consultaId", consultaId);
    dados.set("arquivo", f);

    setEnviando(true);
    const r = await enviarArquivo<AnexoResumo>(`/pacientes/${pacienteId}/anexos`, dados, slug);
    setEnviando(false);
    if (!r.ok) return setErro(r.erro.mensagem);
    setTitulo("");
    setData("");
    if (arquivo.current) arquivo.current.value = "";
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <Botao tamanho="p" onClick={() => setAberto(true)} icone={<Upload className="h-4 w-4" aria-hidden="true" />}>
        Enviar exame
      </Botao>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-xl border border-linha bg-superficie-alt p-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id="anexo-titulo" rotulo="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Hemograma completo" maxLength={160} />
        <div className="space-y-1.5">
          <label htmlFor="anexo-categoria" className="block text-sm font-medium">
            Tipo
          </label>
          <select id="anexo-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value as keyof typeof CATEGORIAS_DE_ANEXO)} className={`${CLASSE_CONTROLE} border-linha`}>
            {Object.entries(CATEGORIAS_DE_ANEXO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Campo id="anexo-data" rotulo="Data do exame (opcional)" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <div className="space-y-1.5">
          <label htmlFor="anexo-arquivo" className="block text-sm font-medium">
            Arquivo
          </label>
          <input
            id="anexo-arquivo"
            ref={arquivo}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-selo-suave file:px-3 file:py-2 file:text-sm file:font-medium file:text-selo-forte hover:file:bg-selo/15"
          />
          <p className="text-xs text-tinta-suave">PDF, JPG, PNG ou WEBP, até 15 MB.</p>
        </div>
      </div>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <div className="flex gap-2">
        <Botao type="submit" carregando={enviando}>
          Enviar
        </Botao>
        <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

/** Pede o link temporario a API e abre o arquivo. */
export function BaixarAnexo({ slug, anexoId }: { slug: string; anexoId: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function baixar() {
    setErro(null);
    setOcupado(true);
    const r = await acaoNaApi<{ url: string }>(`/anexos/${anexoId}/arquivo`, { clinica: slug });
    setOcupado(false);
    if (r.ok) window.open(r.dados.url, "_blank", "noopener");
    else setErro(r.erro.mensagem);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Botao variante="secundario" tamanho="p" carregando={ocupado} onClick={baixar} icone={<Download className="h-4 w-4" aria-hidden="true" />}>
        Abrir
      </Botao>
      {erro ? <span className="text-xs text-alerta">{erro}</span> : null}
    </span>
  );
}
