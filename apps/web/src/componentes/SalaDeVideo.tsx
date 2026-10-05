"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntradaNaSala } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * =====================================================================
 * A SALA DE VIDEO
 * =====================================================================
 *
 * Esta e a unica tela da plataforma que precisa da camera e do microfone da
 * pessoa. Por isso ela tem uma regra que nenhuma outra tem: NADA e ligado
 * sem alguem clicar.
 *
 * Nao e preciosismo. Um componente que pede camera ao carregar faz o
 * navegador mostrar o pedido de permissao no meio de outra coisa, e a pessoa
 * nega por reflexo - e dai nao consegue mais entrar sem mexer em
 * configuracao do navegador, que e onde o atendimento morre. Quem clica em
 * "entrar na sala" sabe o que vem depois.
 *
 * O QUE ACONTECE QUANDO SE CLICA:
 *   1. pedimos o token a nossa API (ela decide se a pessoa pode entrar);
 *   2. montamos o quadro do provedor dentro desta pagina;
 *   3. entramos na sala com o token.
 *
 * O token NAO vem no HTML da pagina. Ele e buscado no momento do clique, e
 * vive so na memoria desta aba. Token no HTML ficaria no cache do
 * navegador, no historico e em qualquer print da tela.
 *
 * A TELA NAO E A AUTORIDADE. Ela esconde o botao quando sabe que nao da
 * para entrar, mas quem decide e a API: se alguem forcar o clique, a
 * resposta e a mesma recusa.
 */

interface Props {
  slug: string;
  consultaId: string;
  /** "medico" muda duas coisas: o layout e quem pode encerrar. */
  comoMedico?: boolean;
  /** Chamado depois de encerrar, para a tela de fora se atualizar. */
  aoEncerrar?: () => void;
}

type Fase = "fechada" | "entrando" | "na_sala" | "encerrada";

export function SalaDeVideo({ slug, consultaId, comoMedico = false, aoEncerrar }: Props) {
  const [fase, setFase] = useState<Fase>("fechada");
  const [erro, setErro] = useState<string | null>(null);
  const [entrada, setEntrada] = useState<EntradaNaSala | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /**
   * O objeto de chamada do provedor fica numa ref, nao em estado: ele nao e
   * algo que a tela desenha, e guardar em estado faria o React redesenhar a
   * cada mudanca dele - desmontando o video no meio da consulta.
   */
  const chamada = useRef<DailyCall | null>(null);
  const caixa = useRef<HTMLDivElement | null>(null);

  async function token() {
    const { data } = await criarClienteNavegador().auth.getSession();
    return data.session?.access_token;
  }

  /**
   * Desmontar com cuidado e metade do trabalho: o objeto de chamada mantem a
   * camera ligada, e so esta funcao a desliga. Sem ela, a luzinha da webcam
   * fica acesa depois de a consulta acabar - e com razao a pessoa desconfia.
   */
  const desmontar = useCallback(() => {
    const atual = chamada.current;
    chamada.current = null;
    if (atual) void atual.destroy();
  }, []);

  // Sair da pagina (fechar a aba, navegar, recarregar) tambem desliga.
  useEffect(() => desmontar, [desmontar]);

  async function entrar() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await chamarApi<EntradaNaSala>(`/consultas/${consultaId}/sala`, {
        metodo: "POST",
        token: await token(),
        clinica: slug,
      });
      if (!r.ok) {
        setErro(r.erro.mensagem);
        return;
      }
      setEntrada(r.dados);

      // Ambiente de demonstracao: nao ha video. O painel simulado assume, e
      // nenhuma camera e aberta.
      if (!r.dados.videoReal) {
        setFase("na_sala");
        return;
      }

      setFase("entrando");

      /**
       * A biblioteca do provedor so e BAIXADA AGORA, no clique.
       *
       * Ela pesa algumas centenas de kilobytes. Importada no topo do
       * arquivo, viria junto com a tela de atendimento inteira - e o medico
       * esperaria por um video que talvez nem va abrir naquele momento. Numa
       * conexao ruim, isso e a tela demorando para aparecer.
       */
      const { default: DailyIframe } = await import("@daily-co/daily-js");

      // Se por algum motivo ja houvesse um quadro montado, ele sai primeiro:
      // dois quadros na mesma pagina disputariam a camera.
      desmontar();

      const quadro = DailyIframe.createFrame(caixa.current!, {
        iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "6px" },
        showLeaveButton: true,
        showFullscreenButton: true,
      });
      chamada.current = quadro;

      quadro.on("left-meeting", () => {
        desmontar();
        setFase("fechada");
      });
      quadro.on("error", (evento) => {
        setErro(evento?.errorMsg ?? "A videochamada falhou. Tente entrar novamente.");
        desmontar();
        setFase("fechada");
      });

      await quadro.join({ url: r.dados.url, token: r.dados.token });
      setFase("na_sala");
    } catch {
      setErro("Nao foi possivel abrir a sala. Verifique se o navegador tem permissao para usar camera e microfone.");
      desmontar();
      setFase("fechada");
    } finally {
      setOcupado(false);
    }
  }

  async function encerrar() {
    setOcupado(true);
    try {
      const r = await chamarApi(`/consultas/${consultaId}/sala/encerrar`, {
        metodo: "POST",
        token: await token(),
        clinica: slug,
      });
      if (!r.ok) {
        setErro(r.erro.mensagem);
        return;
      }
      desmontar();
      setFase("encerrada");
      aoEncerrar?.();
    } finally {
      setOcupado(false);
    }
  }

  if (fase === "encerrada") {
    return (
      <Aviso tipo="ok">
        Atendimento encerrado. A sala foi fechada e nao abre novamente - se precisar de outro atendimento, e uma nova
        consulta.
      </Aviso>
    );
  }

  return (
    <section className="space-y-3" aria-label="Sala de atendimento por video">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-titulo text-xl tracking-tight">Atendimento por video</h2>
          {entrada ? (
            <p className="text-sm text-tinta-suave">
              {entrada.outraPessoa.papel === "medico" ? "Com o medico" : "Com o paciente"}{" "}
              {entrada.outraPessoa.nome}
            </p>
          ) : (
            <p className="text-sm text-tinta-suave">A camera so e ligada depois que voce clicar.</p>
          )}
        </div>

        {fase === "fechada" ? (
          <Botao onClick={entrar} disabled={ocupado}>
            {ocupado ? "Abrindo..." : "Entrar na sala"}
          </Botao>
        ) : null}

        {comoMedico && (fase === "na_sala" || fase === "entrando") ? (
          <Botao variante="secundario" onClick={encerrar} disabled={ocupado}>
            Encerrar atendimento
          </Botao>
        ) : null}
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {/*
        O quadro do provedor e montado AQUI DENTRO, por isso esta caixa
        existe no HTML desde o inicio mesmo vazia: a biblioteca precisa de um
        elemento ja presente na pagina para pendurar o video.
      */}
      <div
        ref={caixa}
        className={
          fase === "fechada" || (entrada && !entrada.videoReal)
            ? "hidden"
            : "aspect-video w-full overflow-hidden rounded-md border border-linha bg-tinta"
        }
      />

      {fase === "entrando" ? <p className="text-sm text-tinta-suave">Conectando a sala...</p> : null}

      {entrada && !entrada.videoReal && fase === "na_sala" ? (
        <div className="space-y-3 rounded-md border border-linha bg-superficie p-6">
          <p className="text-sm font-medium">
            Este ambiente nao faz videochamada. Nenhuma camera foi aberta.
          </p>
          <p className="text-sm text-tinta-suave">
            O provedor de video esta no modo simulado, usado para rodar o projeto sem contratar um servico de video.
            Todo o resto do atendimento funciona normalmente: o prontuario, a receita e o encerramento.
          </p>
          <p className="text-sm text-tinta-suave">
            Para ter video de verdade, configure <code className="rounded bg-papel px-1">VIDEO_PROVEDOR=daily</code> e{" "}
            <code className="rounded bg-papel px-1">VIDEO_API_KEY</code> em{" "}
            <code className="rounded bg-papel px-1">apps/api/.env</code>.
          </p>
          {comoMedico ? null : (
            <p className="text-sm text-tinta-suave">
              Voce entraria nesta sala como <strong>{entrada.papel === "anfitriao" ? "anfitriao" : "participante"}</strong>.
            </p>
          )}
        </div>
      ) : null}

      {fase === "na_sala" && entrada?.videoReal ? (
        <p className="text-xs text-tinta-suave">
          Esta chamada nao e gravada. O que fica registrado e o que o medico escrever no prontuario.
        </p>
      ) : null}
    </section>
  );
}
