"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TERMO_DE_TELEMEDICINA } from "@tele/shared/consentimento";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { emReais } from "@/lib/dinheiro";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

interface Estado {
  totalAguardando: number;
  medicosDePlantao: number;
  minhaPosicao: number | null;
  minhaSituacao: string | null;
  esperaEstimadaMinutos: number | null;
}

type Passo = "queixa" | "termo" | "pagamento" | "esperando";

/**
 * O fluxo do mercado, na ordem: queixa -> termo -> pagamento -> fila.
 *
 * O aviso de emergencia aparece em TODOS os passos, nao so no termo. Quem
 * esta com dor no peito nao deve ler um formulario inteiro para descobrir
 * que devia ter ligado 192.
 */
export function ProntoAtendimento({ slug, estado, valorCentavos }: { slug: string; estado: Estado; valorCentavos: number | null }) {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>(estado.minhaPosicao ? "esperando" : "queixa");
  const [queixa, setQueixa] = useState("");
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pix, setPix] = useState<{ pagamentoId: string; copiaECola: string | null; qr: string | null } | null>(null);
  const [atual, setAtual] = useState(estado);

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  // Enquanto espera na fila, pergunta a posicao de tempos em tempos.
  useEffect(() => {
    if (passo !== "esperando") return;
    const t = setInterval(async () => {
      const r = await chamarApi<Estado>("/fila", { token: await token(), clinica: slug });
      if (r.ok) {
        setAtual(r.dados);
        // Chamado: a consulta comecou, a tela do atendimento assume.
        if (r.dados.minhaSituacao === "em_atendimento") router.push(`/c/${slug}/agenda`);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [passo, slug, router]);

  const emergencia = (
    <div role="alert" className="rounded-md border-2 border-alerta bg-alerta-suave px-4 py-3 text-sm text-alerta">
      <strong>Nao use este servico em emergencia.</strong> Dor no peito, falta de ar intensa, desmaio, sangramento que
      nao para ou sinais de AVC: ligue <strong>192</strong> (SAMU) ou va ao pronto-socorro mais proximo agora.
    </div>
  );

  if (passo === "esperando" || atual.minhaPosicao) {
    return (
      <div className="max-w-lg space-y-5">
        {emergencia}
        <div className="rounded-lg border border-linha bg-superficie p-6 text-center">
          <p className="text-sm uppercase tracking-[0.15em] text-tinta-suave">Sua posicao na fila</p>
          <p className="font-titulo text-6xl text-selo">{atual.minhaPosicao ?? "—"}</p>
          {atual.esperaEstimadaMinutos !== null ? (
            <p className="mt-2 text-tinta-suave">
              Espera estimada: cerca de <strong>{atual.esperaEstimadaMinutos} minuto(s)</strong>
            </p>
          ) : null}
          <p className="mt-1 text-sm text-tinta-suave">
            {atual.medicosDePlantao} profissional(is) de plantao · {atual.totalAguardando} na fila
          </p>
        </div>
        <Aviso>
          Deixe esta tela aberta. Quando for a sua vez, ela muda sozinha e a videochamada comeca. A estimativa e uma
          media — pode variar conforme a complexidade dos atendimentos.
        </Aviso>
        {atual.medicosDePlantao === 0 ? (
          <Aviso tipo="erro">
            Nenhum profissional esta de plantao neste momento. Voce continua na fila e sera atendido assim que alguem
            abrir o plantao.
          </Aviso>
        ) : null}
      </div>
    );
  }

  async function seguirParaTermo() {
    if (queixa.trim().length < 5) {
      setErro("Conte em poucas palavras o que voce esta sentindo.");
      return;
    }
    setErro(null);
    setPasso("termo");
  }

  async function pagar() {
    setErro(null);
    setOcupado(true);
    // A cobranca da fila nao esta ligada a uma consulta: ela nasce solta e
    // e "consumida" quando o paciente entra na fila.
    const r = await chamarApi<{ pagamentoId: string; pixCopiaECola: string | null; pixQrBase64: string | null }>(
      "/pagamentos/pronto-atendimento",
      { metodo: "POST", token: await token(), clinica: slug, corpo: { metodo: "pix" } },
    );
    if (r.ok) {
      setPix({ pagamentoId: r.dados.pagamentoId, copiaECola: r.dados.pixCopiaECola, qr: r.dados.pixQrBase64 });
      setPasso("pagamento");
    } else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  async function entrarNaFila() {
    setErro(null);
    setOcupado(true);
    const r = await chamarApi("/fila", {
      metodo: "POST",
      token: await token(),
      clinica: slug,
      corpo: { queixa: queixa.trim(), pagamentoId: pix!.pagamentoId, consentimento: true },
    });
    if (r.ok) {
      setPasso("esperando");
      router.refresh();
    } else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  return (
    <div className="max-w-lg space-y-5">
      {emergencia}

      {passo === "queixa" ? (
        <>
          <div className="space-y-1.5">
            <label htmlFor="queixa" className="block text-sm font-medium">O que voce esta sentindo?</label>
            <p className="text-xs text-tinta-suave">Escreva com suas palavras. Isso ajuda o profissional a se preparar.</p>
            <textarea
              id="queixa"
              rows={4}
              value={queixa}
              onChange={(e) => setQueixa(e.target.value)}
              className="w-full rounded-md border border-linha bg-superficie px-3 py-2 text-base"
              placeholder="Estou com dor de garganta ha 2 dias, piora ao engolir..."
            />
          </div>
          {valorCentavos !== null ? (
            <div className="rounded-lg border border-linha bg-superficie p-4">
              <p className="text-sm text-tinta-suave">Valor do atendimento</p>
              <p className="font-titulo text-2xl">{emReais(valorCentavos)}</p>
            </div>
          ) : (
            <Aviso>Esta clinica ainda nao definiu o valor do pronto atendimento.</Aviso>
          )}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao onClick={seguirParaTermo} className="w-full" disabled={valorCentavos === null}>Continuar</Botao>
        </>
      ) : null}

      {passo === "termo" ? (
        <>
          <h2 className="font-titulo text-2xl tracking-tight">Antes de continuar</h2>
          <div className="max-h-80 space-y-4 overflow-y-auto rounded-lg border border-linha bg-superficie p-5 text-sm">
            {TERMO_DE_TELEMEDICINA.map((item) => (
              <div key={item.titulo}>
                <h3 className="font-medium">{item.titulo}</h3>
                <p className="text-tinta-suave">{item.texto}</p>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-3 rounded-md border border-linha bg-superficie px-4 py-3">
            <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} className="mt-1" />
            <span className="text-sm">
              Li e concordo com o atendimento por telemedicina nas condicoes acima.
            </span>
          </label>
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <div className="flex gap-3">
            <Botao variante="secundario" onClick={() => setPasso("queixa")}>Voltar</Botao>
            <Botao onClick={pagar} carregando={ocupado} disabled={!aceito} className="flex-1">Aceitar e pagar</Botao>
          </div>
        </>
      ) : null}

      {passo === "pagamento" && pix ? (
        <>
          <h2 className="font-titulo text-2xl tracking-tight">Pagamento</h2>
          {pix.qr ? (
            <div className="flex justify-center rounded-lg border border-linha bg-superficie p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${pix.qr}`} alt="QR Code do Pix" className="h-56 w-56" />
            </div>
          ) : null}
          {pix.copiaECola ? (
            <code className="block max-h-24 overflow-y-auto break-all rounded border border-linha bg-papel p-3 font-mono text-xs">
              {pix.copiaECola}
            </code>
          ) : null}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Aviso>Assim que o pagamento for confirmado, toque no botao abaixo para entrar na fila.</Aviso>
          <Botao onClick={entrarNaFila} carregando={ocupado} className="w-full">Ja paguei — entrar na fila</Botao>
        </>
      ) : null}
    </div>
  );
}
