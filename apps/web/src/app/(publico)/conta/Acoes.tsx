"use client";

import { Download, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ClinicaResumo, TipoConsentimento } from "@tele/shared";
import { NOME_DO_CONSENTIMENTO, TIPOS_DE_SOLICITACAO, type TipoSolicitacao } from "@tele/shared/lgpd";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { ambiente } from "@/lib/ambiente";
import { acaoNaApi, tokenDoNavegador } from "@/lib/navegador";
import { soDigitos } from "@/lib/validacao";

/** Correcao do proprio cadastro (LGPD art. 18, III). */
export function CorrigirDados({ nome, telefone }: { nome: string; telefone: string | null }) {
  const router = useRouter();
  const [n, setN] = useState(nome);
  const [t, setT] = useState(telefone ?? "");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSalvando(true);
    const r = await acaoNaApi("/perfis/eu", { metodo: "PATCH", corpo: { nomeCompleto: n.trim(), telefone: t ? soDigitos(t) : null } });
    setSalvando(false);
    if (!r.ok) return setMsg({ tipo: "erro", texto: r.erro.mensagem });
    setMsg({ tipo: "ok", texto: "Dados atualizados." });
    router.refresh();
  }

  return (
    <form onSubmit={salvar} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="conta-nome" rotulo="Nome completo" value={n} onChange={(e) => setN(e.target.value)} autoComplete="name" />
        <Campo id="conta-telefone" rotulo="Telefone" value={t} onChange={(e) => setT(e.target.value)} inputMode="numeric" autoComplete="tel" placeholder="11 99999-0000" />
      </div>
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      <Botao type="submit" variante="secundario" carregando={salvando}>
        Salvar correção
      </Botao>
    </form>
  );
}

/** Copia de tudo, em JSON (portabilidade - art. 18, V). */
export function BaixarMeusDados() {
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  async function baixar() {
    setErro(null);
    setBaixando(true);
    try {
      const token = await tokenDoNavegador();
      const r = await fetch(`${ambiente.apiUrl}/lgpd/meus-dados`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error("Não foi possível gerar a cópia agora. Tente de novo em instantes.");
      const url = URL.createObjectURL(await r.blob());
      Object.assign(document.createElement("a"), { href: url, download: `meus-dados-${new Date().toISOString().slice(0, 10)}.json` }).click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro((e as Error).message);
    }
    setBaixando(false);
  }

  return (
    <div className="space-y-3">
      <Botao onClick={baixar} carregando={baixando} icone={<Download className="h-4 w-4" aria-hidden="true" />}>
        Baixar meus dados (JSON)
      </Botao>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}

/** Revogar um consentimento (art. 8, par. 5). */
export function RevogarConsentimento({ tipo }: { tipo: TipoConsentimento }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function revogar() {
    const aviso =
      tipo === "telemedicina"
        ? "Sem este consentimento você não poderá ser atendido por telemedicina. Revogar?"
        : `Sem aceitar "${NOME_DO_CONSENTIMENTO[tipo]}" você não poderá continuar usando a plataforma. Revogar?`;
    if (!window.confirm(aviso)) return;
    setOcupado(true);
    await acaoNaApi("/lgpd/consentimentos/revogar", { metodo: "POST", corpo: { tipo } });
    setOcupado(false);
    router.refresh();
  }

  return (
    <Botao variante="fantasma" tamanho="p" onClick={revogar} carregando={ocupado} className="text-alerta hover:text-alerta">
      Revogar
    </Botao>
  );
}

/** Pedido ao controlador (clinica) ou a plataforma (art. 18). */
export function NovoPedido({ clinicas }: { clinicas: ClinicaResumo[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoSolicitacao>("confirmacao_e_acesso");
  const [destino, setDestino] = useState(clinicas[0]?.slug ?? "");
  const [descricao, setDescricao] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setEnviando(true);
    const r = await acaoNaApi("/lgpd/solicitacoes", { metodo: "POST", corpo: { tipo, descricao: descricao.trim(), ...(destino ? { clinica: destino } : {}) } });
    setEnviando(false);
    if (!r.ok) {
      const det = Array.isArray(r.erro.detalhes) ? (r.erro.detalhes as { problema: string }[]).map((d) => d.problema).join(" ") : "";
      return setMsg({ tipo: "erro", texto: det || r.erro.mensagem });
    }
    setDescricao("");
    setMsg({ tipo: "ok", texto: "Pedido registrado. A resposta chega em até 15 dias e aparece aqui." });
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="pedido-tipo" className="block text-sm font-medium">
            O que você quer
          </label>
          <select id="pedido-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoSolicitacao)} className={`${CLASSE_CONTROLE} border-linha`}>
            {Object.entries(TIPOS_DE_SOLICITACAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pedido-destino" className="block text-sm font-medium">
            Para quem
          </label>
          <select id="pedido-destino" value={destino} onChange={(e) => setDestino(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`}>
            {clinicas.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.nomeFantasia} (dados do atendimento)
              </option>
            ))}
            <option value="">Plataforma (dados da conta)</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pedido-descricao" className="block text-sm font-medium">
          Descreva o pedido
        </label>
        <textarea id="pedido-descricao" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`} maxLength={3000} />
        {tipo === "anonimizacao_ou_exclusao" ? (
          <p className="text-xs text-tinta-suave">O prontuário é guardado por 20 anos por lei (Lei 13.787/2018); a resposta dirá o que foi excluído e o que precisa ficar.</p>
        ) : null}
      </div>
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      <Botao type="submit" carregando={enviando} icone={<Send className="h-4 w-4" aria-hidden="true" />}>
        Enviar pedido
      </Botao>
    </form>
  );
}
