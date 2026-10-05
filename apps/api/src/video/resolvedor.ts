/**
 * Qual provedor de video a plataforma usa, decidido UMA VEZ, quando a API
 * sobe.
 *
 * Por que aqui e nao na hora da consulta: se a chave do Daily estiver
 * faltando, quem precisa descobrir isso e a pessoa que subiu o servidor, no
 * terminal dela, agora. Descobrir no meio de um atendimento - com paciente
 * do outro lado esperando a imagem aparecer - e a pior hora possivel.
 * Mesmo principio do ambiente.ts: falhar cedo e alto.
 *
 * Diferente do pagamento, o video NAO e por clinica. A sala e infraestrutura
 * da plataforma, nao recebimento de ninguem: nao ha dinheiro a depositar na
 * conta de cada clinica, e uma conta de video por clinica multiplicaria o
 * custo e o trabalho de operacao sem nada em troca.
 */
import type { Ambiente } from "../ambiente.js";
import { ProvedorDailyDeVideo } from "./provedor-daily.js";
import { ProvedorLocalDeVideo } from "./provedor-local.js";
import type { ProvedorDeVideo } from "./provedor.js";

export function criarProvedorDeVideo(ambiente: Ambiente): ProvedorDeVideo {
  if (ambiente.VIDEO_PROVEDOR === "daily") {
    if (!ambiente.VIDEO_API_KEY) {
      throw new Error("VIDEO_PROVEDOR=daily exige VIDEO_API_KEY em apps/api/.env (painel do Daily > Developers).");
    }
    return new ProvedorDailyDeVideo(ambiente.VIDEO_API_KEY);
  }

  if (ambiente.NODE_ENV === "production" && !ambiente.PERMITIR_VIDEO_SIMULADO) {
    throw new Error(
      "O provedor de video local NAO faz videochamada e nao pode ser usado em producao.\n" +
        "  - Para valer: VIDEO_PROVEDOR=daily com VIDEO_API_KEY (ver o guia de credenciais).\n" +
        "  - Para um ambiente de DEMONSTRACAO, sem paciente real: PERMITIR_VIDEO_SIMULADO=sim",
    );
  }

  if (ambiente.NODE_ENV === "production") {
    // Aviso a cada inicializacao: e facil esquecer que um ambiente subiu
    // assim e depois trata-lo como se fosse producao de verdade.
    console.warn(
      "\n  ATENCAO: video simulado ligado (PERMITIR_VIDEO_SIMULADO=sim).\n" +
        "  NAO ha videochamada neste ambiente. Nao use com paciente real.\n",
    );
  }
  return new ProvedorLocalDeVideo();
}
