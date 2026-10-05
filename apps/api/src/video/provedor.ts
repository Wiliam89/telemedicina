/**
 * =====================================================================
 * O CONTRATO DE UM PROVEDOR DE VIDEO
 * =====================================================================
 *
 * Daily, Twilio Video, Vonage e LiveKit resolvem o mesmo problema com APIs
 * diferentes. Esta interface e o que a plataforma conhece - trocar de
 * provedor e escrever um arquivo novo aqui dentro, nao mexer nas telas.
 *
 * POR QUE PROVEDOR, E NAO WEBRTC NOSSO (ADR-0014):
 * videochamada entre duas pessoas em redes domesticas quase sempre precisa
 * de servidor no meio (TURN para atravessar o roteador, SFU para
 * redistribuir o video). Isso e maquina ligada 24 horas, custando mesmo
 * parada, e virando problema nosso quando cai no meio de uma consulta.
 *
 * QUATRO REGRAS QUE ESTAO NO DESENHO, NAO NA IMPLEMENTACAO:
 *
 * 1. A SALA E PRIVADA E SO ABRE COM TOKEN. O endereco da sala nao e
 *    segredo - ele aparece na barra do navegador, vai para o historico,
 *    pode ser colado num grupo sem pensar. O que abre a porta e o token, e
 *    ele e de UMA pessoa, para UMA consulta, por pouco tempo.
 *
 * 2. DUAS PESSOAS, NO MAXIMO. O limite esta no provedor, nao so no nosso
 *    codigo. Mesmo que um token vaze, nao ha lugar para um terceiro
 *    sentar: a sala comporta o paciente e o medico, e ninguem mais.
 *
 * 3. NAO HA GRAVACAO. Nao e que esteja desligada por configuracao nossa: a
 *    sala e criada sem a capacidade de gravar. O termo que o paciente le
 *    diz "a videochamada nao e gravada" (@tele/shared/consentimento), e o
 *    codigo tem que estar do mesmo lado dessa frase.
 *
 * 4. A SALA MORRE COM A CONSULTA. Expira sozinha na hora marcada, e e
 *    apagada quando o medico encerra. Sala que fica aberta para sempre e
 *    porta destrancada para sempre.
 */

/** Quem esta entrando. O medico conduz; o paciente participa. */
export type PapelNaSala = "anfitriao" | "participante";

/**
 * Nunca mais de dois numa consulta. Esta constante vai para o provedor na
 * criacao da sala - e por isso que o limite vale mesmo que nosso codigo
 * erre depois.
 */
export const MAXIMO_DE_PARTICIPANTES = 2;

export interface PedidoDeSala {
  /**
   * Nome que identifica a sala no provedor. Derivado da consulta, para que
   * duas chamadas para a mesma consulta cheguem na mesma sala.
   */
  nome: string;
  /** Quando a sala deixa de existir. O provedor derruba quem estiver nela. */
  expiraEm: Date;
}

export interface SalaCriada {
  nome: string;
  url: string;
  expiraEm: Date;
}

export interface PedidoDeToken {
  nomeDaSala: string;
  /** Como o nome aparece na tela do outro. */
  nomeDaPessoa: string;
  /**
   * Nosso identificador do perfil. O provedor devolve isso nos eventos, e e
   * assim que sabemos quem entrou e quando - sem depender do nome digitado.
   */
  pessoaId: string;
  papel: PapelNaSala;
  /** Quando o token perde a validade. Curto de proposito. */
  expiraEm: Date;
}

export interface TokenDeEntrada {
  token: string;
  expiraEm: Date;
}

export interface ProvedorDeVideo {
  readonly nome: "local_teste" | "daily";
  readonly rotulo: string;
  /**
   * `false` avisa a plataforma inteira que aqui nao ha video de verdade: a
   * API recusa subir assim em producao e a tela mostra o aviso no lugar da
   * imagem.
   */
  readonly videoReal: boolean;

  /** Cria a sala, ou devolve a que ja existe com este nome. */
  criarSala(pedido: PedidoDeSala): Promise<SalaCriada>;
  /** Um token por pessoa, por entrada. Nao guardamos o que sai daqui. */
  emitirToken(pedido: PedidoDeToken): Promise<TokenDeEntrada>;
  /** Apaga a sala no provedor. Depois disto, token vazado nao abre nada. */
  apagarSala(nome: string): Promise<void>;
}

export type CodigoDeErroDeVideo =
  | "PROVEDOR_INDISPONIVEL"
  | "CREDENCIAL_INVALIDA"
  | "SALA_NAO_ENCONTRADA"
  | "FALHA";

export class ErroDeVideo extends Error {
  constructor(
    readonly codigo: CodigoDeErroDeVideo,
    mensagem: string,
    readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = "ErroDeVideo";
  }
}
