"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CartaoResumo, LinhaDeAtendimento } from "@tele/shared";
import { rotuloDoPedido } from "@tele/shared/atendimento";
import { TERMO_DE_TELEMEDICINA } from "@tele/shared/consentimento";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { SimularPix } from "@/componentes/pagamento/SimularPix";
import { chamarApi } from "@/lib/api";
import { emReais } from "@/lib/dinheiro";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

export interface EstadoDaFila {
  totalAguardando: number;
  medicosDePlantao: number;
  minhaPosicao: number | null;
  minhaSituacao: string | null;
  minhaEntradaId?: string | null;
  minhaLinha?: LinhaDeAtendimento | null;
  minhaEspecialidade?: string | null;
  /** Modulo 12: a consulta que nasceu do aceite - o destino da sala de video. */
  minhaConsultaId: string | null;
  esperaEstimadaMinutos: number | null;
  pagamentoDisponivel?: boolean;
}

type Passo = "queixa" | "termo" | "pagamento" | "esperando";

/**
 * O ATENDIMENTO IMEDIATO das duas linhas (ADR-0024): pronto atendimento
 * (clinico geral) e teleconsulta (a especialidade escolhida).
 *
 *   queixa -> termo -> pagamento garantido -> fila -> um medico aceita -> video
 *
 * PAGAMENTO (ADR-0023):
 *   com cartao cadastrado  nada e pago agora; o valor e debitado quando a
 *                          consulta termina;
 *   sem cartao             o Pix aparece aqui, ANTES de a consulta comecar.
 *
 * O aviso de emergencia aparece em TODOS os passos, nao so no termo. Quem
 * esta com dor no peito nao deve ler um formulario inteiro para descobrir
 * que devia ter ligado 192.
 */
export function ProntoAtendimento({
  slug,
  estado,
  valorCentavos,
  linha = "pronto_atendimento",
  especialidade = null,
  cartao = null,
  medicosOnline,
}: {
  slug: string;
  estado: EstadoDaFila;
  valorCentavos: number | null;
  linha?: LinhaDeAtendimento;
  especialidade?: string | null;
  cartao?: CartaoResumo | null;
  /** Medicos online que podem atender ESTE pedido. */
  medicosOnline: number;
}) {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>(estado.minhaPosicao ? "esperando" : "queixa");
  const [queixa, setQueixa] = useState("");
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pix, setPix] = useState<{ pagamentoId: string; copiaECola: string | null; qr: string | null; status: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [atual, setAtual] = useState(estado);
  // Tem cartao e prefere o Pix desta vez.
  const [prefiroPix, setPrefiroPix] = useState(false);
  const usaCartao = Boolean(cartao && !cartao.vencido && !prefiroPix);
  const pedido = { linha, ...(linha === "teleconsulta" ? { especialidade } : {}) };

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  // Enquanto espera na fila, pergunta de tempos em tempos se algum medico aceitou.
  useEffect(() => {
    if (passo !== "esperando") return;
    const t = setInterval(async () => {
      const r = await chamarApi<EstadoDaFila>("/fila", { token: await token(), clinica: slug });
      if (r.ok) {
        setAtual(r.dados);
        /**
         * ACEITO. Daqui o paciente vai DIRETO para a sala de video - nao para
         * a agenda. O medico esta na sala esperando, e mandar o paciente para
         * uma lista de consultas significa ele ter que entender sozinho, com
         * pressa, onde clicar. Quem foi chamado cai onde foi chamado.
         */
        if (r.dados.minhaSituacao === "em_atendimento" && r.dados.minhaConsultaId) {
          router.push(`/c/${slug}/consulta/${r.dados.minhaConsultaId}`);
        } else if (!r.dados.minhaPosicao) {
          // Saiu da fila sem atendimento (tempo esgotado, ou encerrada pela equipe).
          setPasso("queixa");
          setErro("Sua espera foi encerrada sem atendimento. Você pode entrar de novo; se pagou por Pix, a plataforma foi avisada sobre o reembolso.");
        }
      }
    }, 4000);
    return () => clearInterval(t);
  }, [passo, slug, router]);

  const entrarNaFila = useCallback(
    async (pagamentoId: string | null) => {
      setErro(null);
      setOcupado(true);
      const r = await chamarApi("/fila", {
        metodo: "POST",
        token: await token(),
        clinica: slug,
        corpo: { queixa: queixa.trim(), ...pedido, ...(pagamentoId ? { pagamentoId } : { usarCartao: true }), consentimento: true },
      });
      setOcupado(false);
      if (r.ok || (!r.ok && r.erro.codigo === "JA_NA_FILA")) {
        setPasso("esperando");
        router.refresh();
        return;
      }
      if (r.erro.codigo === "PAGAMENTO_PENDENTE") {
        const consultaId = (r.erro.detalhes as { consultaId?: string } | undefined)?.consultaId;
        if (consultaId) router.push(`/c/${slug}/pagamento/${consultaId}`);
      }
      setErro(r.erro.mensagem);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queixa, slug, linha, especialidade, router],
  );

  // Pix: enquanto a pessoa paga no banco, a tela pergunta a API se ja confirmou
  // e entra na fila sozinha. Quem decide que pagou e o provedor, nunca a tela.
  useEffect(() => {
    if (passo !== "pagamento" || !pix || pix.status === "confirmado") return;
    const t = setInterval(async () => {
      const r = await chamarApi<{ status: string }>(`/pagamentos/${pix.pagamentoId}`, { token: await token(), clinica: slug });
      if (r.ok && r.dados.status === "confirmado") {
        setPix({ ...pix, status: "confirmado" });
        await entrarNaFila(pix.pagamentoId);
      } else if (r.ok && (r.dados.status === "expirado" || r.dados.status === "recusado")) {
        setPix(null);
        setPasso("termo");
        setErro("O código Pix venceu sem pagamento. Gere outro para continuar.");
      }
    }, 4000);
    return () => clearInterval(t);
  }, [passo, pix, slug, entrarNaFila]);

  const emergencia = (
    <div role="alert" className="rounded-lg border-2 border-alerta bg-alerta-suave px-4 py-3 text-sm text-alerta">
      <strong>Não use este serviço em emergência.</strong> Dor no peito, falta de ar intensa, desmaio, sangramento que
      não para ou sinais de AVC: ligue <strong>192</strong> (SAMU) ou vá ao pronto-socorro mais próximo agora.
    </div>
  );

  async function sair() {
    if (!atual.minhaEntradaId) return;
    setOcupado(true);
    const r = await chamarApi(`/fila/${atual.minhaEntradaId}/desistir`, { metodo: "POST", token: await token(), clinica: slug, corpo: {} });
    setOcupado(false);
    if (r.ok) {
      setAtual({ ...atual, minhaPosicao: null, minhaSituacao: null, minhaEntradaId: null });
      setPasso("queixa");
      router.refresh();
    } else setErro(r.erro.mensagem);
  }

  if (passo === "esperando" || atual.minhaPosicao) {
    return (
      <div className="max-w-lg space-y-5">
        {emergencia}
        <div className="rounded-xl border border-linha bg-superficie p-6 text-center shadow-cartao" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-selo">{rotuloDoPedido(atual.minhaLinha ?? linha, atual.minhaEspecialidade ?? especialidade)}</p>
          <p className="mt-3 text-sm uppercase tracking-[0.15em] text-tinta-suave">Sua posição na fila</p>
          <p className="font-titulo text-6xl text-selo">{atual.minhaPosicao ?? "—"}</p>
          {atual.esperaEstimadaMinutos !== null ? (
            <p className="mt-2 text-tinta-suave">
              Espera estimada: cerca de <strong>{atual.esperaEstimadaMinutos} minuto(s)</strong>
            </p>
          ) : null}
          <p className="mt-1 text-sm text-tinta-suave">
            {atual.medicosDePlantao > 0 ? `Seu pedido foi enviado a ${atual.medicosDePlantao} médico(s) online. O primeiro que aceitar atende você.` : "Nenhum médico online agora para este atendimento."}
          </p>
        </div>
        <Aviso>
          Deixe esta tela aberta. Quando um médico aceitar, ela muda sozinha e a videochamada começa. A estimativa é uma
          média — pode variar conforme a complexidade dos atendimentos.
        </Aviso>
        {atual.medicosDePlantao === 0 ? (
          <Aviso tipo="espera">
            Avisamos os médicos desta linha de atendimento. Você continua na fila e será atendido assim que alguém ficar
            online. Se ninguém aceitar em 2 horas, a espera é encerrada.
          </Aviso>
        ) : null}
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {atual.minhaSituacao === "aguardando" && atual.minhaEntradaId ? (
          <button type="button" onClick={sair} disabled={ocupado} className="text-sm text-alerta underline-offset-4 hover:underline disabled:opacity-50">
            Sair da fila
          </button>
        ) : null}
      </div>
    );
  }

  function seguirParaTermo() {
    if (queixa.trim().length < 5) {
      setErro("Conte em poucas palavras o que você está sentindo.");
      return;
    }
    setErro(null);
    setPasso("termo");
  }

  async function pagarComPix() {
    setErro(null);
    setOcupado(true);
    // A cobranca da fila nao esta ligada a uma consulta: ela nasce solta e
    // e "consumida" quando o paciente entra na fila.
    const r = await chamarApi<{ pagamentoId: string; status: string; pixCopiaECola: string | null; pixQrBase64: string | null }>("/pagamentos/pronto-atendimento", {
      metodo: "POST",
      token: await token(),
      clinica: slug,
      corpo: { metodo: "pix", ...pedido },
    });
    setOcupado(false);
    if (r.ok) {
      // Pagamento anterior ja confirmado e ainda nao usado: entra direto.
      if (r.dados.status === "confirmado") return entrarNaFila(r.dados.pagamentoId);
      setPix({ pagamentoId: r.dados.pagamentoId, copiaECola: r.dados.pixCopiaECola, qr: r.dados.pixQrBase64, status: r.dados.status });
      setPasso("pagamento");
      return;
    }
    if (r.erro.codigo === "PAGAMENTO_PENDENTE") {
      const consultaId = (r.erro.detalhes as { consultaId?: string } | undefined)?.consultaId;
      if (consultaId) router.push(`/c/${slug}/pagamento/${consultaId}`);
    }
    setErro(r.erro.mensagem);
  }

  return (
    <div className="max-w-lg space-y-5">
      {emergencia}

      {passo === "queixa" && estado.pagamentoDisponivel === false ? (
        <Aviso>O atendimento imediato está indisponível no momento, porque a plataforma ainda não está recebendo pagamentos. Tente de novo mais tarde.</Aviso>
      ) : null}

      {passo === "queixa" && estado.pagamentoDisponivel !== false ? (
        <>
          <div className="space-y-1.5">
            <label htmlFor="queixa" className="block text-sm font-medium">O que você está sentindo?</label>
            <p id="queixa-ajuda" className="text-xs text-tinta-suave">Escreva com suas palavras. Só o médico que atender você lê isto.</p>
            <textarea
              id="queixa"
              rows={4}
              maxLength={1000}
              aria-describedby="queixa-ajuda"
              value={queixa}
              onChange={(e) => setQueixa(e.target.value)}
              className="w-full rounded-lg border border-linha bg-superficie px-3 py-2.5 text-base shadow-[inset_0_1px_1px_rgb(15_23_42/0.03)] focus:border-selo focus:outline-none focus:ring-4 focus:ring-selo/15"
              placeholder="Estou com dor de garganta há 2 dias, piora ao engolir..."
            />
          </div>

          {medicosOnline === 0 ? (
            <Aviso tipo="espera">Nenhum médico está online agora para este atendimento. Você pode entrar na fila: todos são avisados, mas a espera pode ser longa. Se preferir, agende um horário.</Aviso>
          ) : (
            <p className="text-sm text-tinta-suave">
              <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-selo align-middle" />
              {medicosOnline} médico(s) online agora.
            </p>
          )}

          {valorCentavos !== null ? (
            <div className="rounded-xl border border-linha bg-superficie p-4 shadow-cartao">
              <p className="text-sm text-tinta-suave">Valor do atendimento</p>
              <p className="font-titulo text-2xl">{emReais(valorCentavos)}</p>
              <p className="mt-1 text-xs text-tinta-suave">
                {cartao && !cartao.vencido ? `Debitado no cartão final ${cartao.ultimos4} só quando a consulta terminar.` : "Pagamento por Pix antes de entrar na fila."}
              </p>
            </div>
          ) : (
            <Aviso>O valor deste atendimento ainda não foi definido. Tente de novo mais tarde.</Aviso>
          )}

          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao onClick={seguirParaTermo} className="w-full" disabled={valorCentavos === null}>Continuar</Botao>
        </>
      ) : null}

      {passo === "termo" ? (
        <>
          <h2 className="text-xl text-tinta">Antes de continuar</h2>
          <div tabIndex={0} className="max-h-80 space-y-4 overflow-y-auto rounded-xl border border-linha bg-superficie p-5 text-sm shadow-cartao">
            {TERMO_DE_TELEMEDICINA.map((item) => (
              <div key={item.titulo}>
                <h3 className="font-medium">{item.titulo}</h3>
                <p className="text-tinta-suave">{item.texto}</p>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-linha bg-superficie px-4 py-3 shadow-cartao">
            <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} className="mt-1" />
            <span className="text-sm">Li e concordo com o atendimento por telemedicina nas condições acima.</span>
          </label>

          {valorCentavos !== null ? (
            <div className="rounded-xl border border-linha bg-superficie-alt p-4 text-sm">
              {usaCartao ? (
                <>
                  <p>
                    <strong>{emReais(valorCentavos)}</strong> no cartão final <strong>{cartao!.ultimos4}</strong>, debitado quando a consulta terminar. Nada é cobrado agora.
                  </p>
                  <button type="button" onClick={() => setPrefiroPix(true)} className="mt-2 text-selo underline underline-offset-4">
                    Prefiro pagar por Pix agora
                  </button>
                </>
              ) : (
                <>
                  <p>
                    <strong>{emReais(valorCentavos)}</strong> por Pix, antes de entrar na fila.
                  </p>
                  {cartao && !cartao.vencido ? (
                    <button type="button" onClick={() => setPrefiroPix(false)} className="mt-2 text-selo underline underline-offset-4">
                      Usar o cartão final {cartao.ultimos4}
                    </button>
                  ) : (
                    <Link href={`/c/${slug}/cartao`} className="mt-2 inline-block text-selo underline underline-offset-4">
                      Cadastrar um cartão e pagar só no final
                    </Link>
                  )}
                </>
              )}
            </div>
          ) : null}

          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <div className="flex gap-3">
            <Botao variante="secundario" onClick={() => setPasso("queixa")}>Voltar</Botao>
            {usaCartao ? (
              <Botao onClick={() => entrarNaFila(null)} carregando={ocupado} disabled={!aceito} className="flex-1">Aceitar e entrar na fila</Botao>
            ) : (
              <Botao onClick={pagarComPix} carregando={ocupado} disabled={!aceito} className="flex-1">Aceitar e pagar com Pix</Botao>
            )}
          </div>
        </>
      ) : null}

      {passo === "pagamento" && pix ? (
        <>
          <h2 className="text-xl text-tinta">Pagamento por Pix</h2>
          {pix.qr ? (
            <div className="flex justify-center rounded-xl border border-linha bg-superficie p-6 shadow-cartao">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${pix.qr}`} alt="QR Code do Pix" className="h-56 w-56" />
            </div>
          ) : null}
          {pix.copiaECola ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pix copia e cola</p>
              <code className="block max-h-24 overflow-y-auto break-all rounded border border-linha bg-papel p-3 font-mono text-xs">{pix.copiaECola}</code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(pix.copiaECola!);
                  setCopiado(true);
                }}
                className="rounded-lg border border-selo px-3 py-1.5 text-sm text-selo"
              >
                {copiado ? "Copiado" : "Copiar código"}
              </button>
            </div>
          ) : null}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Aviso tipo="espera">Aguardando o pagamento. Assim que o banco confirmar, você entra na fila sozinho — pode deixar esta tela aberta.</Aviso>
          <SimularPix slug={slug} pagamentoId={pix.pagamentoId} />
        </>
      ) : null}
    </div>
  );
}
