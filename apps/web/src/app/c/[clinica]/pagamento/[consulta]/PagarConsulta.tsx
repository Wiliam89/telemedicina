"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CartaoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { SimularPix } from "@/componentes/pagamento/SimularPix";
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
 *
 * DOIS USOS (ADR-0023):
 *   reserva    consulta marcada sem cartao: o Pix confirma o horario;
 *   pendencia  consulta ja realizada cuja cobranca no cartao nao passou:
 *              Pix, ou nova tentativa no cartao cadastrado.
 */
export function PagarConsulta({
  slug,
  consultaId,
  status,
  valorCentavos,
  pendencia = false,
  cartao = null,
}: {
  slug: string;
  consultaId: string;
  status: string;
  valorCentavos: number | null;
  pendencia?: boolean;
  cartao?: CartaoResumo | null;
}) {
  const router = useRouter();
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState<"pix" | "cartao" | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  async function cobrar(metodo: "pix" | "cartao_salvo") {
    setErro(null);
    setCriando(metodo === "pix" ? "pix" : "cartao");
    const r = await chamarApi<Cobranca>(`/consultas/${consultaId}/pagamento`, {
      metodo: "POST",
      token: await token(),
      clinica: slug,
      corpo: { metodo },
    });
    if (r.ok) {
      setCobranca(r.dados);
      if (r.dados.status === "confirmado") router.refresh();
    } else if (r.erro.codigo === "JA_PAGA") {
      router.refresh();
    } else {
      setErro(metodo === "cartao_salvo" && r.status === 400 ? "O cartão foi recusado de novo. Pague por Pix ou cadastre outro cartão." : r.erro.mensagem);
    }
    setCriando(null);
  }

  // Enquanto espera, pergunta a API a cada 4 segundos. Quando confirmar,
  // recarrega a pagina - a consulta ja estara agendada (ou a pendencia, quitada).
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

  if (!pendencia && status === "agendada") {
    return <Aviso tipo="ok">Consulta confirmada. O pagamento foi recebido.</Aviso>;
  }
  if (status === "cancelada") {
    return <Aviso tipo="erro">Esta consulta foi cancelada. Se o pagamento não foi confirmado a tempo, o horário voltou a ficar livre.</Aviso>;
  }
  if (!pendencia && status !== "aguardando_pagamento") {
    return <Aviso tipo="ok">Não há pagamento pendente para esta consulta.</Aviso>;
  }
  if (valorCentavos === null) {
    return <Aviso>O valor desta consulta ainda não foi definido. Fale com o atendimento da plataforma.</Aviso>;
  }

  return (
    <div className="max-w-md space-y-5">
      <div className="rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
        <p className="text-sm text-tinta-suave">Valor da consulta</p>
        <p className="font-titulo text-3xl">{emReais(valorCentavos)}</p>
      </div>

      {!cobranca || cobranca.status === "recusado" ? (
        <>
          {pendencia ? (
            <Aviso tipo="espera">
              Esta consulta já foi realizada, e a cobrança no seu cartão não foi aprovada. Regularize para voltar a marcar atendimentos.
            </Aviso>
          ) : (
            <Aviso>
              Seu horário está <strong>reservado</strong> enquanto você paga. Se o pagamento não for confirmado a tempo, ele
              volta a ficar disponível para outras pessoas.
            </Aviso>
          )}
          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <Botao onClick={() => cobrar("pix")} carregando={criando === "pix"} disabled={criando !== null} className="w-full">
            Pagar com Pix
          </Botao>
          {pendencia ? (
            <>
              {cartao && !cartao.vencido ? (
                <Botao variante="secundario" onClick={() => cobrar("cartao_salvo")} carregando={criando === "cartao"} disabled={criando !== null} className="w-full">
                  Tentar de novo no cartão final {cartao.ultimos4}
                </Botao>
              ) : null}
              <Link href={`/c/${slug}/cartao`} className="block text-center text-sm text-selo underline underline-offset-4">
                Cadastrar outro cartão
              </Link>
            </>
          ) : null}
        </>
      ) : cobranca.status === "confirmado" ? (
        <Aviso tipo="ok">{pendencia ? "Pagamento confirmado. Obrigado: está tudo certo." : "Pagamento confirmado. Sua consulta está agendada."}</Aviso>
      ) : (
        <div className="space-y-4">
          {cobranca.pixQrBase64 ? (
            <div className="flex justify-center rounded-xl border border-linha bg-superficie p-6 shadow-cartao">
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
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(cobranca.pixCopiaECola!);
                  setCopiado(true);
                }}
                className="rounded-lg border border-selo px-3 py-1.5 text-sm text-selo"
              >
                {copiado ? "Copiado" : "Copiar código"}
              </button>
            </div>
          ) : null}
          <Aviso tipo="espera">
            Aguardando o pagamento. Assim que o banco confirmar, esta tela muda sozinha — pode deixar aberta.
            {cobranca.expiraEm ? ` O código vale até ${new Date(cobranca.expiraEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : ""}
          </Aviso>
          <SimularPix slug={slug} pagamentoId={cobranca.pagamentoId} />
        </div>
      )}
    </div>
  );
}
