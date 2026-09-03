"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentoResumo, TipoDocumento } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

const TIPOS: { valor: TipoDocumento; rotulo: string }[] = [
  { valor: "receita_simples", rotulo: "Receita" },
  { valor: "atestado", rotulo: "Atestado" },
  { valor: "pedido_exame", rotulo: "Pedido de exame" },
  { valor: "declaracao_comparecimento", rotulo: "Declaracao de comparecimento" },
];

interface Item {
  medicamento: string;
  posologia: string;
  quantidade: string;
}

/**
 * Emissao de documento. O que sai daqui e imutavel: o conteudo e congelado,
 * o hash calculado e o numero reservado. Errou? Cancela e emite outro - e
 * a tela diz isso antes, nao depois.
 */
export function EmitirDocumento({ slug, consultaId, emitidos }: { slug: string; consultaId: string; emitidos: DocumentoResumo[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoDocumento>("receita_simples");
  const [itens, setItens] = useState<Item[]>([{ medicamento: "", posologia: "", quantidade: "" }]);
  const [dias, setDias] = useState("1");
  const [cid10, setCid10] = useState("");
  const [exames, setExames] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [emitindo, setEmitindo] = useState(false);

  async function emitir() {
    setErro(null);
    setEmitindo(true);

    const conteudo: Record<string, unknown> = {};
    if (tipo === "receita_simples") {
      const limpos = itens.filter((i) => i.medicamento.trim() && i.posologia.trim());
      if (limpos.length === 0) {
        setErro("Informe ao menos um medicamento com a posologia.");
        setEmitindo(false);
        return;
      }
      conteudo.itens = limpos.map((i) => ({
        medicamento: i.medicamento.trim(),
        posologia: i.posologia.trim(),
        ...(i.quantidade.trim() ? { quantidade: i.quantidade.trim() } : {}),
      }));
    }
    if (tipo === "atestado") {
      conteudo.diasAfastamento = Number(dias);
      // O CID so vai se o medico marcar - e ele so marca com autorizacao
      // do paciente (art. 76 do Codigo de Etica Medica).
      if (cid10.trim()) conteudo.cid10 = cid10.trim().toUpperCase();
    }
    if (tipo === "pedido_exame") {
      const lista = exames.split("\n").map((e) => e.trim()).filter(Boolean);
      if (lista.length === 0) {
        setErro("Escreva ao menos um exame, um por linha.");
        setEmitindo(false);
        return;
      }
      conteudo.exames = lista;
    }
    if (tipo === "declaracao_comparecimento") conteudo.texto = "Declaro que o paciente compareceu a esta consulta.";
    if (observacoes.trim()) conteudo.observacoes = observacoes.trim();

    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<DocumentoResumo>("/documentos", {
      metodo: "POST",
      token: data.session?.access_token,
      clinica: slug,
      corpo: { consultaId, tipo, conteudo },
    });

    if (r.ok) {
      setItens([{ medicamento: "", posologia: "", quantidade: "" }]);
      setExames("");
      setObservacoes("");
      router.refresh();
    } else setErro(r.erro.mensagem);
    setEmitindo(false);
  }

  async function cancelar(id: string) {
    const motivo = window.prompt("Por que este documento esta sendo cancelado?\n(o documento nao e apagado: fica registrado como cancelado)");
    if (!motivo || motivo.trim().length < 5) return;
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi(`/documentos/${id}/cancelar`, { metodo: "POST", token: data.session?.access_token, clinica: slug, corpo: { motivo: motivo.trim() } });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
  }

  return (
    <aside className="space-y-5 rounded-lg border border-linha bg-superficie p-5">
      <h2 className="font-titulo text-xl tracking-tight">Emitir documento</h2>

      <div className="space-y-1.5">
        <label htmlFor="tipo" className="block text-sm font-medium">Tipo</label>
        <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumento)} className="w-full rounded-md border border-linha bg-superficie px-3 py-2">
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>{t.rotulo}</option>
          ))}
        </select>
      </div>

      {tipo === "receita_simples" ? (
        <div className="space-y-3">
          {itens.map((item, i) => (
            <div key={i} className="space-y-2 rounded border border-linha p-3">
              <Campo id={`med-${i}`} rotulo="Medicamento" value={item.medicamento} onChange={(e) => setItens((a) => a.map((x, j) => (i === j ? { ...x, medicamento: e.target.value } : x)))} placeholder="Dipirona 500mg" />
              <Campo id={`pos-${i}`} rotulo="Posologia" value={item.posologia} onChange={(e) => setItens((a) => a.map((x, j) => (i === j ? { ...x, posologia: e.target.value } : x)))} placeholder="1 comprimido de 6 em 6 horas por 3 dias" />
              <Campo id={`qtd-${i}`} rotulo="Quantidade (opcional)" value={item.quantidade} onChange={(e) => setItens((a) => a.map((x, j) => (i === j ? { ...x, quantidade: e.target.value } : x)))} placeholder="1 caixa" />
              {itens.length > 1 ? (
                <button onClick={() => setItens((a) => a.filter((_, j) => j !== i))} className="text-sm text-alerta underline-offset-4 hover:underline">Remover</button>
              ) : null}
            </div>
          ))}
          <button onClick={() => setItens((a) => [...a, { medicamento: "", posologia: "", quantidade: "" }])} className="text-sm text-selo underline-offset-4 hover:underline">
            Adicionar medicamento
          </button>
        </div>
      ) : null}

      {tipo === "atestado" ? (
        <div className="space-y-3">
          <Campo id="dias" rotulo="Dias de afastamento" type="number" min={1} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />
          <Campo id="cid-doc" rotulo="CID-10 (so com autorizacao do paciente)" value={cid10} onChange={(e) => setCid10(e.target.value.toUpperCase())} placeholder="J02" ajuda="O art. 76 do Codigo de Etica Medica proibe revelar o diagnostico em atestado sem autorizacao." />
        </div>
      ) : null}

      {tipo === "pedido_exame" ? (
        <div className="space-y-1.5">
          <label htmlFor="exames" className="block text-sm font-medium">Exames (um por linha)</label>
          <textarea id="exames" rows={4} value={exames} onChange={(e) => setExames(e.target.value)} className="w-full rounded-md border border-linha bg-superficie px-3 py-2" placeholder={"Hemograma completo\nGlicemia de jejum"} />
        </div>
      ) : null}

      <Campo id="obs" rotulo="Observacoes (opcional)" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <Botao onClick={emitir} carregando={emitindo} className="w-full">Emitir</Botao>
      <p className="text-xs text-tinta-suave">
        Documento emitido nao pode ser alterado. Se houver erro, cancele e emita outro — o cancelamento fica registrado.
      </p>

      {emitidos.length > 0 ? (
        <div className="space-y-2 border-t border-linha pt-4">
          <h3 className="text-sm font-medium text-tinta-suave">Emitidos</h3>
          <ul className="space-y-2">
            {emitidos.map((d) => (
              <li key={d.id} className="text-sm">
                <p className="font-medium">{d.tipo.replace(/_/g, " ")} · no {d.numero}/{d.ano}</p>
                <p className="font-mono text-xs text-tinta-suave">{d.codigoValidacao}</p>
                <button onClick={() => cancelar(d.id)} className="text-xs text-alerta underline-offset-4 hover:underline">Cancelar</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
