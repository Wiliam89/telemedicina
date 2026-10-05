/**
 * =====================================================================
 * QUANDO A SALA DE VIDEO ABRE, E QUANDO FECHA
 * =====================================================================
 *
 * Esta regra fica aqui, em @tele/shared, porque DUAS partes precisam dela
 * e precisam concordar:
 *
 *   - a API, para decidir se entrega o token de entrada;
 *   - a tela, para dizer "a sala abre as 14:45" em vez de deixar a pessoa
 *     clicando num botao que nao funciona.
 *
 * Se cada lado tivesse a sua copia, um dia uma mudaria e a outra nao - e o
 * resultado seria a tela prometendo uma entrada que a API recusa. Uma
 * fonte so, usada pelos dois. (A API e a palavra final: a tela so antecipa
 * o que ela vai responder.)
 *
 * POR QUE EXISTE JANELA, E NAO "entra quando quiser":
 * uma consulta e as 15h. Sem janela, o paciente poderia entrar na sala as
 * 9h da manha e ficar la; o medico, na terca, entraria na sala da consulta
 * de quinta. A janela e o que faz a sala existir no horario do atendimento,
 * e nao como um lugar permanente.
 */

/**
 * Quanto antes do horario a sala abre. Serve para a pessoa testar camera e
 * microfone com calma, que e o que resolve a maior parte dos "nao estou
 * conseguindo entrar" antes de virar problema.
 */
export const MINUTOS_ANTES = 15;

/**
 * Quanto depois do fim previsto a sala continua aberta. Consulta atrasa, e
 * uma sala que fecha na hora exata derrubaria o atendimento no meio.
 */
export const MINUTOS_DEPOIS = 30;

export type StatusParaVideo = "aguardando_pagamento" | "agendada" | "em_andamento" | "concluida" | "cancelada";

export type MotivoDeRecusa = "aguardando_pagamento" | "cancelada" | "concluida" | "cedo_demais" | "tarde_demais";

export type DecisaoDeEntrada =
  | { pode: true; abreEm: Date; fechaEm: Date }
  | { pode: false; motivo: MotivoDeRecusa; mensagem: string; abreEm: Date; fechaEm: Date };

export function janelaDaSala(inicio: Date, fim: Date): { abreEm: Date; fechaEm: Date } {
  return {
    abreEm: new Date(inicio.getTime() - MINUTOS_ANTES * 60_000),
    fechaEm: new Date(fim.getTime() + MINUTOS_DEPOIS * 60_000),
  };
}

/**
 * A pergunta inteira: esta pessoa pode entrar na sala desta consulta agora?
 *
 * Esta funcao NAO responde "quem e esta pessoa" - isso e da API, que
 * compara com o paciente e o medico da consulta. Aqui so se decide o que
 * depende do estado e do relogio.
 */
export function decidirEntrada(entrada: {
  status: StatusParaVideo;
  inicio: Date;
  fim: Date;
  agora: Date;
}): DecisaoDeEntrada {
  const { abreEm, fechaEm } = janelaDaSala(entrada.inicio, entrada.fim);
  const recusar = (motivo: MotivoDeRecusa, mensagem: string): DecisaoDeEntrada => ({
    pode: false,
    motivo,
    mensagem,
    abreEm,
    fechaEm,
  });

  // O estado vem antes do relogio: uma consulta cancelada nao abre sala nem
  // no horario certo.
  if (entrada.status === "aguardando_pagamento") {
    return recusar(
      "aguardando_pagamento",
      "Esta consulta ainda esta aguardando o pagamento. A sala abre depois que o pagamento for confirmado.",
    );
  }
  if (entrada.status === "cancelada") {
    return recusar("cancelada", "Esta consulta foi cancelada, e a sala nao abre.");
  }
  if (entrada.status === "concluida") {
    return recusar("concluida", "Este atendimento foi encerrado. A sala desta consulta nao existe mais.");
  }

  if (entrada.agora.getTime() < abreEm.getTime()) {
    return recusar("cedo_demais", `A sala desta consulta abre ${MINUTOS_ANTES} minutos antes do horario marcado.`);
  }
  if (entrada.agora.getTime() > fechaEm.getTime()) {
    return recusar("tarde_demais", "O horario desta consulta passou, e a sala foi fechada.");
  }

  return { pode: true, abreEm, fechaEm };
}

/** O que a API devolve quando a entrada e liberada. */
export interface EntradaNaSala {
  provedor: "local_teste" | "daily";
  /**
   * `false` significa: nao ha videochamada neste ambiente. A tela mostra o
   * aviso em vez de tentar abrir a camera.
   */
  videoReal: boolean;
  /** Endereco da sala no provedor. Sozinho nao abre nada. */
  url: string;
  /** A credencial de entrada DESTA pessoa. Curta, e nao guardada em banco. */
  token: string;
  tokenExpiraEm: string;
  papel: "anfitriao" | "participante";
  /** Quem esta do outro lado, para a tela dizer com quem se vai falar. */
  outraPessoa: { nome: string; papel: "medico" | "paciente" };
  fechaEm: string;
}
