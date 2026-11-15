"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { MedicoNaAdministracao } from "@tele/shared";
import { formatarPercentual, lerPercentual } from "@tele/shared/admin";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { acaoNaApi } from "@/lib/navegador";

export interface Configuracoes {
  nomeFantasia: string;
  razaoSocial: string;
  cnpj: string;
  fusoHorario: string;
  responsavelTecnicoId: string | null;
  repassePadraoBps: number | null;
  /** ADR-0027: o prazo de retorno SUGERIDO ao medico (o medico decide; CFM 1.958/2010). */
  retornoPrazoMaximoDias: number;
}

const FUSOS = [
  ["America/Sao_Paulo", "Brasília (SP, RJ, MG, Sul, Nordeste...)"],
  ["America/Manaus", "Amazonas, Roraima, Rondônia, MT, MS"],
  ["America/Rio_Branco", "Acre"],
  ["America/Noronha", "Fernando de Noronha"],
] as const;

export function FormularioDeConfiguracoes({ slug, inicial, medicos }: { slug: string; inicial: Configuracoes; medicos: MedicoNaAdministracao[] }) {
  const router = useRouter();
  const [nome, setNome] = useState(inicial.nomeFantasia);
  const [razao, setRazao] = useState(inicial.razaoSocial);
  const [fuso, setFuso] = useState(inicial.fusoHorario);
  const [rt, setRt] = useState(inicial.responsavelTecnicoId ?? "");
  const [percentual, setPercentual] = useState(inicial.repassePadraoBps === null ? "" : String(inicial.repassePadraoBps / 100).replace(".", ","));
  const [prazoRetorno, setPrazoRetorno] = useState(String(inicial.retornoPrazoMaximoDias ?? 30));
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const aptos = medicos.filter((m) => m.status === "ativo" && m.situacaoCrm === "verificado");

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);
    const bps = percentual.trim() === "" ? null : lerPercentual(percentual);
    if (percentual.trim() !== "" && bps === null) return setErro("Porcentagem inválida: use um número de 0 a 100, com até duas casas (ex.: 70 ou 72,5).");
    const corpo: Record<string, unknown> = {};
    if (nome.trim() !== inicial.nomeFantasia) corpo.nomeFantasia = nome.trim();
    if (razao.trim() !== inicial.razaoSocial) corpo.razaoSocial = razao.trim();
    if (fuso !== inicial.fusoHorario) corpo.fusoHorario = fuso;
    if (rt && rt !== inicial.responsavelTecnicoId) corpo.responsavelTecnicoId = rt;
    if (bps !== inicial.repassePadraoBps) corpo.repassePadraoBps = bps;
    const prazo = Number(prazoRetorno);
    if (!Number.isInteger(prazo) || prazo < 1 || prazo > 90) return setErro("Prazo sugerido de retorno inválido: use um número de 1 a 90 dias.");
    if (prazo !== inicial.retornoPrazoMaximoDias) corpo.retornoPrazoMaximoDias = prazo;
    if (Object.keys(corpo).length === 0) return setOk("Nada mudou.");
    setOcupado(true);
    const r = await acaoNaApi("/admin/configuracoes", { metodo: "PATCH", clinica: slug, corpo });
    setOcupado(false);
    if (!r.ok) {
      const detalhes = Array.isArray(r.erro.detalhes) ? (r.erro.detalhes as { problema: string }[]).map((d) => d.problema).join(" ") : "";
      return setErro(detalhes || r.erro.mensagem);
    }
    setOk("Configurações salvas.");
    router.refresh();
  }

  return (
    <form onSubmit={salvar} className="max-w-2xl space-y-8" noValidate>
      <fieldset className="space-y-5 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
        <legend className="px-1 font-titulo text-base">Quanto fica com o médico</legend>
        <div className="max-w-xs">
          <Campo
            id="percentual"
            rotulo="Porcentagem padrão do médico (%)"
            inputMode="decimal"
            placeholder="70"
            value={percentual}
            onChange={(e) => setPercentual(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))}
            ajuda={`Hoje: ${formatarPercentual(inicial.repassePadraoBps)}. Ex.: com 70%, numa consulta de R$ 100,00 o médico ganha R$ 70,00.`}
          />
        </div>
        <p className="text-sm text-tinta-suave">Vale para médicos sem porcentagem própria (definida na tela Médicos) e só para consultas marcadas a partir de agora.</p>
      </fieldset>

      <fieldset className="space-y-5 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
        <legend className="px-1 font-titulo text-base">Retorno sem custo</legend>
        <div className="max-w-xs">
          <Campo
            id="prazo-retorno"
            rotulo="Prazo sugerido do retorno (dias)"
            inputMode="numeric"
            placeholder="30"
            value={prazoRetorno}
            onChange={(e) => setPrazoRetorno(e.target.value.replace(/\D/g, "").slice(0, 2))}
            ajuda="É o prazo que vale quando o médico não digita outro. O médico pode escolher mais ou menos dias (até 180)."
          />
        </div>
        <p className="text-sm text-tinta-suave">
          Pela Resolução CFM 1.958/2010, o retorno para mostrar exames pedidos na consulta não é cobrado, e o prazo é decisão do médico: a plataforma
          só sugere um padrão, não limita. Se aparecer uma queixa nova, é consulta nova. O retorno não gera repasse ao médico, porque faz parte da
          consulta original.
        </p>
      </fieldset>

      <fieldset className="space-y-5 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
        <legend className="px-1 font-titulo text-base">Empresa</legend>
        <Campo id="nome" rotulo="Nome que os pacientes veem" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Campo id="razao" rotulo="Razão social" value={razao} onChange={(e) => setRazao(e.target.value)} ajuda="Aparece nos documentos médicos." />
        <p className="text-sm text-tinta-suave">CNPJ: <span className="font-mono">{inicial.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}</span> (para mudar, fale com o suporte técnico: ele identifica os documentos já emitidos).</p>
        <div className="space-y-1.5">
          <label htmlFor="rt" className="block text-sm font-medium">Responsável técnico (médico)</label>
          <select id="rt" value={rt} onChange={(e) => setRt(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`}>
            {inicial.responsavelTecnicoId ? null : <option value="">Ainda não definido</option>}
            {aptos.map((m) => (
              <option key={m.id} value={m.id}>{m.nomeCompleto} — CRM {m.crm}-{m.crmUf}</option>
            ))}
          </select>
          <p className="text-xs text-tinta-suave">Exigência do CFM para serviços de telemedicina. Só aparecem médicos ativos com CRM verificado.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fuso" className="block text-sm font-medium">Fuso horário da agenda</label>
          <select id="fuso" value={fuso} onChange={(e) => setFuso(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`}>
            {FUSOS.map(([v, n]) => (
              <option key={v} value={v}>{n}</option>
            ))}
            {!FUSOS.some(([v]) => v === fuso) ? <option value={fuso}>{fuso}</option> : null}
          </select>
          <p className="text-xs text-tinta-suave">Consultas já marcadas não mudam de horário; muda a leitura dos horários de atendimento dos médicos.</p>
        </div>
      </fieldset>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
      <Botao type="submit" carregando={ocupado}>Salvar configurações</Botao>
    </form>
  );
}
