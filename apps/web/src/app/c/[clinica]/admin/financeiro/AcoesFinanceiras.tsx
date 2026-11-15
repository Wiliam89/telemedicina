"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { emReais, paraCentavos } from "@/lib/dinheiro";
import { acaoNaApi } from "@/lib/navegador";

const hojeLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * REGISTRAR UM REPASSE. A transferencia ao medico e feita por fora (Pix ou
 * TED no banco da empresa); aqui fica o registro de que ela aconteceu, e o
 * saldo do medico diminui.
 */
export function RegistrarRepasse({ slug, medicoId, medicoNome, saldoCentavos }: { slug: string; medicoId: string; medicoNome: string; saldoCentavos: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState((saldoCentavos / 100).toFixed(2).replace(".", ","));
  const [data, setData] = useState(hojeLocal());
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (saldoCentavos <= 0) return null;
  if (!aberto) {
    return (
      <Botao type="button" tamanho="p" variante="secundario" onClick={() => setAberto(true)}>
        Registrar pagamento
      </Botao>
    );
  }

  async function salvar() {
    setErro(null);
    const centavos = paraCentavos(valor);
    if (!centavos || centavos <= 0) return setErro("Informe o valor transferido.");
    if (centavos > saldoCentavos) return setErro(`O valor passa do saldo a receber (${emReais(saldoCentavos)}).`);
    if (referencia.trim().length < 2) return setErro("Diga como o valor foi enviado (ex.: Pix, TED, número do comprovante).");
    setOcupado(true);
    const r = await acaoNaApi("/admin/repasses", { metodo: "POST", clinica: slug, corpo: { medicoId, valorCentavos: centavos, pagoEm: data, referencia: referencia.trim(), observacao: observacao.trim() || undefined } });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro.mensagem);
    setAberto(false);
    router.refresh();
  }

  return (
    <div className="mt-3 w-full space-y-3 rounded-lg border border-linha bg-superficie-alt p-4">
      <p className="text-sm">
        Registrar uma transferência já feita para <strong>{medicoNome}</strong>.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo id={`valor-${medicoId}`} rotulo="Valor (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        <Campo id={`data-${medicoId}`} rotulo="Data do pagamento" type="date" max={hojeLocal()} value={data} onChange={(e) => setData(e.target.value)} />
        <Campo id={`ref-${medicoId}`} rotulo="Como foi pago" placeholder="Pix, TED, comprovante..." value={referencia} onChange={(e) => setReferencia(e.target.value.slice(0, 120))} ajuda="Nunca anote dados bancários completos." />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`obs-${medicoId}`} className="block text-sm font-medium">Observação (opcional)</label>
        <textarea id={`obs-${medicoId}`} rows={2} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`} />
      </div>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <div className="flex flex-wrap gap-3">
        <Botao type="button" tamanho="p" onClick={salvar} carregando={ocupado}>Registrar</Botao>
        <Botao type="button" tamanho="p" variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao>
      </div>
    </div>
  );
}

/** Desfazer um registro feito por engano. O registro continua no histórico, riscado. */
export function CancelarRepasse({ slug, repasseId }: { slug: string; repasseId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="text-xs text-alerta underline-offset-4 hover:underline">
        Cancelar registro
      </button>
    );
  }
  return (
    <div className="mt-2 flex w-full flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <Campo id={`motivo-${repasseId}`} rotulo="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erro} />
      </div>
      <Botao
        type="button"
        tamanho="p"
        variante="perigo"
        carregando={ocupado}
        onClick={async () => {
          if (motivo.trim().length < 5) return setErro("Explique o motivo.");
          setOcupado(true);
          const r = await acaoNaApi(`/admin/repasses/${repasseId}/cancelar`, { metodo: "POST", clinica: slug, corpo: { motivo: motivo.trim() } });
          setOcupado(false);
          if (!r.ok) return setErro(r.erro.mensagem);
          router.refresh();
        }}
      >
        Confirmar
      </Botao>
    </div>
  );
}

/** Devolver o dinheiro ao paciente pelo provedor de pagamento. */
export function Reembolsar({ slug, pagamentoId, valorCentavos }: { slug: string; pagamentoId: string; valorCentavos: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!aberto) {
    return (
      <Botao type="button" tamanho="p" variante="secundario" onClick={() => setAberto(true)}>
        Reembolsar
      </Botao>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border border-alerta/30 bg-alerta-suave p-3">
      <p className="text-sm text-alerta">
        Devolver <strong>{emReais(valorCentavos)}</strong> ao paciente pelo serviço de pagamento. Isso não pode ser desfeito.
      </p>
      <Campo id={`reemb-${pagamentoId}`} rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erro} />
      <div className="flex flex-wrap gap-2">
        <Botao
          type="button"
          tamanho="p"
          variante="perigo"
          carregando={ocupado}
          onClick={async () => {
            if (motivo.trim().length < 5) return setErro("Explique o motivo do reembolso.");
            setOcupado(true);
            const r = await acaoNaApi(`/admin/pagamentos/${pagamentoId}/reembolsar`, { metodo: "POST", clinica: slug, corpo: { motivo: motivo.trim() } });
            setOcupado(false);
            if (!r.ok) return setErro(r.erro.mensagem);
            router.refresh();
          }}
        >
          Confirmar reembolso
        </Botao>
        <Botao type="button" tamanho="p" variante="fantasma" onClick={() => setAberto(false)}>Voltar</Botao>
      </div>
    </div>
  );
}
