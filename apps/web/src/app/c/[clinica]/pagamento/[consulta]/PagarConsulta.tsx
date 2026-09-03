"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { emReais } from "@/lib/dinheiro";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

interface Cobranca {
  pagamentoId: string;
  status: string;
  valorCentavos: number;
  pixCopiaECola: string | null;
  pixQrBase64: string | null;
  expiraEm: string | null;
}

/**
 * Pagar com Pix. Enquanto a pessoa paga no aplicativo do banco, a tela
 * pergunta a API de tempos em tempos se ja confirmou.
 *
 * REPARE NO QUE A TELA **NAO** FAZ: ela nao decide que o pagamento
 * aconteceu. Quem decide e o provedor, avisando a API por webhook. A tela
 * so pergunta "ja?" - e por isso nao ha como "confirmar" um pagamento
 * fechando a janela na hora certa.
 */
export function PagarConsulta({
  slug,
  consultaId,
  status,
  valorCentavos,
}: {
  slug: string;
  consultaId: string;
  status: string;
  valorCentavos: number | null;
}) {
  const router = useRouter();
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  async function gerarPix() {
    setErro(null);
    setCriando(true);
    const r = await chamarApi<Cobranca>(`/consultas/${consultaId}/pagamento`, {
      metodo: "POST",
      token: await token(),
      clinica: slug,
      corpo: { metodo: "pix" },
    });
    if (r.ok) setCobranca(r.dados);
    else setErro(r.erro.mensagem);
    setCriando(false);
  }

  // Enquanto espera, pergunta a API a cada 4 segundos. Quando confirmar,
  // recarrega a pagina - a consulta ja estara agendada.
  useEffect(() => {
    if (!cobranca || cobranca.status === "confirmado") return;
    const t = setInterval(async () => {
      const r = await chamarApi<{ status: string }>(`/pagamentos/${cobranca.pagamentoId}`, { token: await token(), clinica: slug });
      if (r.ok && r.dados.status !== cobranca.status) {
        setCobranca({ ...cobranca, status: r.dados.status });
        if (r.dados.status === "confirmado") router.refresh();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [cobranca, slug, router]);

  if (status === "agendada") {
    return <Aviso tipo="ok">Consulta confirmada. O pagamento foi recebido.</Aviso>;
  }
  if (status === "cancelada") {
    return <Aviso tipo="erro">Esta consulta foi cancelada. Se o pagamento nao foi confirmado a tempo, o horario voltou a ficar livre.</Aviso>;
  }
  if (valorCentavos === null) {
    return <Aviso>Esta clinica ainda nao definiu o valor da consulta. Fale com a administracao.</Aviso>;
  }

  return (
    <div className="max-w-md space-y-5">
      <div className="rounded-lg border border-linha bg-superficie p-5">
        <p className="text-sm text-tinta-suave">Valor da consulta</p>
        <p className="font-titulo text-3xl">{emReais(valorCentavos)}</p>
      </div>

      {!cobranca ? (
        <>
          <Aviso>
            Seu horario esta <strong>reservado</strong> enquanto voce paga. Se o pagamento nao for confirmado a tempo, ele
            volta a ficar disponivel para outras pessoas.
          </Aviso>
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao onClick={gerarPix} carregando={criando} className="w-full">
            Pagar com Pix
          </Botao>
        </>
      ) : cobranca.status === "confirmado" ? (
        <Aviso tipo="ok">Pagamento confirmado. Sua consulta esta agendada.</Aviso>
      ) : (
        <div className="space-y-4">
          {cobranca.pixQrBase64 ? (
            <div className="flex justify-center rounded-lg border border-linha bg-superficie p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${cobranca.pixQrBase64}`} alt="QR Code do Pix" className="h-56 w-56" />
            </div>
          ) : null}

          {cobranca.pixCopiaECola ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pix copia e cola</p>
              <code className="block max-h-24 overflow-y-auto break-all rounded border border-linha bg-papel p-3 font-mono text-xs">
                {cobranca.pixCopiaECola}
              </code>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(cobranca.pixCopiaECola!);
                  setCopiado(true);
                }}
                className="rounded-md border border-selo px-3 py-1.5 text-sm text-selo"
              >
                {copiado ? "Copiado" : "Copiar codigo"}
              </button>
            </div>
          ) : null}

          <Aviso>
            Aguardando o pagamento. Assim que o banco confirmar, esta tela muda sozinha — pode deixar aberta.
            {cobranca.expiraEm ? ` O codigo vale ate ${new Date(cobranca.expiraEm).toLocaleTimeString("pt-BR")}.` : ""}
          </Aviso>
        </div>
      )}
    </div>
  );
}
