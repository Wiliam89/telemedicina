/**
 * =====================================================================
 * DAILY - PROVEDOR DE VIDEO DE VERDADE
 * =====================================================================
 *
 * O que este arquivo faz e traduzir: a plataforma pede "cria uma sala",
 * "me da um token", e aqui isso vira chamada HTTP na API do Daily.
 *
 * Tres endpoints, e nada mais:
 *   POST   /v1/rooms            cria a sala
 *   GET    /v1/rooms/:nome      le a sala que ja existe
 *   POST   /v1/meeting-tokens   emite o token de entrada de UMA pessoa
 *   DELETE /v1/rooms/:nome      apaga a sala no fim
 *
 * A chave da API fica no servidor e nunca sai dele. O navegador recebe
 * apenas o token de entrada - que vale para uma sala, uma pessoa e poucos
 * minutos. Se a chave da API fosse para o navegador, quem abrisse o
 * inspecionar elemento poderia criar salas na conta da clinica.
 *
 * SOBRE AS DATAS: o Daily trabalha com "unix time" - segundos contados
 * desde 1970. JavaScript conta em milissegundos, por isso o `/ 1000` em
 * todo lugar onde uma data vira numero.
 */
import {
  ErroDeVideo,
  MAXIMO_DE_PARTICIPANTES,
  type PedidoDeSala,
  type PedidoDeToken,
  type ProvedorDeVideo,
  type SalaCriada,
  type TokenDeEntrada,
} from "./provedor.js";

const BASE = "https://api.daily.co/v1";

/** Chamada que nao responde nao pode travar o atendimento para sempre. */
const TEMPO_LIMITE_MS = 10_000;

interface SalaNoDaily {
  name: string;
  url: string;
  config?: { exp?: number };
}

export class ProvedorDailyDeVideo implements ProvedorDeVideo {
  readonly nome = "daily" as const;
  readonly rotulo = "Daily";
  readonly videoReal = true;

  constructor(private readonly chaveDaApi: string) {}

  async criarSala(pedido: PedidoDeSala): Promise<SalaCriada> {
    const expiraUnix = Math.floor(pedido.expiraEm.getTime() / 1000);

    const criada = await this.chamar<SalaNoDaily>("POST", "/rooms", {
      name: pedido.nome,
      /**
       * `private` e o coracao da seguranca: sem token, nem quem tem o
       * endereco entra. Uma sala `public` seria aberta a quem recebesse o
       * link - e link circula.
       */
      privacy: "private",
      properties: {
        exp: expiraUnix,
        /** Expirou: o provedor derruba quem estiver dentro. */
        eject_at_room_exp: true,
        /** A regra das duas pessoas, aplicada por quem hospeda. */
        max_participants: MAXIMO_DE_PARTICIPANTES,
        /**
         * "Knocking" e a fila de espera na porta: sem token, a pessoa bate
         * e pede para entrar. Desligado de proposito - aqui a entrada e
         * decidida ANTES, por quem a consulta pertence. Ligado, ele abriria
         * um caminho de "pedir para entrar" para qualquer estranho que
         * tivesse o endereco, e alguem acabaria clicando em aceitar.
         */
        enable_knocking: false,
        /**
         * Sem bate-papo escrito. O que e clinicamente relevante tem que ir
         * para o prontuario, que fica registrado e assinado - nao para uma
         * conversa que desaparece quando a sala fecha. Chat aqui seria
         * registro medico fora do registro medico.
         */
        enable_chat: false,
        /** Compartilhar tela serve: exame, imagem, resultado. */
        enable_screenshare: true,
        /**
         * A tela de "testar camera e microfone" antes de entrar. E o que
         * evita o paciente aparecer sem saber que esta aparecendo, e o que
         * resolve metade dos "nao funciona" sem ninguem ligar para o
         * suporte.
         */
        enable_prejoin_ui: true,
      },
    }).catch(async (erro: unknown) => {
      // Sala com este nome ja existe - e o caso normal de recarregar a
      // pagina. Aproveitamos a que esta la: as duas pessoas precisam cair
      // no MESMO lugar.
      if (erro instanceof ErroDeVideo && erro.codigo === "SALA_NAO_ENCONTRADA") {
        return this.chamar<SalaNoDaily>("GET", `/rooms/${encodeURIComponent(pedido.nome)}`);
      }
      throw erro;
    });

    return {
      nome: criada.name,
      url: criada.url,
      expiraEm: criada.config?.exp ? new Date(criada.config.exp * 1000) : pedido.expiraEm,
    };
  }

  async emitirToken(pedido: PedidoDeToken): Promise<TokenDeEntrada> {
    const resposta = await this.chamar<{ token: string }>("POST", "/meeting-tokens", {
      properties: {
        /** O token vale para esta sala, e so para ela. */
        room_name: pedido.nomeDaSala,
        exp: Math.floor(pedido.expiraEm.getTime() / 1000),
        /**
         * Anfitriao (o medico) pode encerrar a chamada para os dois. O
         * paciente nao - senao poderia derrubar o medico do atendimento.
         */
        is_owner: pedido.papel === "anfitriao",
        user_name: pedido.nomeDaPessoa,
        /** O Daily aceita ate 36 caracteres aqui. UUID tem exatamente 36. */
        user_id: pedido.pessoaId,
        /** Token venceu enquanto a pessoa estava dentro: ela sai. */
        eject_at_token_exp: true,
      },
    });

    return { token: resposta.token, expiraEm: pedido.expiraEm };
  }

  async apagarSala(nome: string): Promise<void> {
    try {
      await this.chamar("DELETE", `/rooms/${encodeURIComponent(nome)}`);
    } catch (erro) {
      // Sala ja nao existe e exatamente o estado que queriamos. Nao e erro.
      if (erro instanceof ErroDeVideo && erro.codigo === "SALA_NAO_ENCONTRADA") return;
      throw erro;
    }
  }

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(`${BASE}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.chaveDaApi}`,
          ...(corpo ? { "Content-Type": "application/json" } : {}),
        },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch (causa) {
      throw new ErroDeVideo(
        "PROVEDOR_INDISPONIVEL",
        "Nao foi possivel falar com o servico de videochamada. Tente entrar novamente em alguns segundos.",
        causa,
      );
    }

    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeVideo(
        "CREDENCIAL_INVALIDA",
        "A chave do servico de videochamada foi recusada. Confira VIDEO_API_KEY em apps/api/.env.",
      );
    }

    const texto = await resposta.text();

    if (!resposta.ok) {
      // O Daily responde 404 para sala inexistente e 400 com "already
      // exists" para sala repetida. Os dois caem no mesmo tratamento de
      // quem chamou: "use a sala que ja esta la".
      if (resposta.status === 404 || texto.includes("already exists")) {
        throw new ErroDeVideo("SALA_NAO_ENCONTRADA", "A sala pedida nao existe no provedor.");
      }
      throw new ErroDeVideo("FALHA", `O servico de videochamada respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
    }

    if (!texto) return undefined as T;
    try {
      return JSON.parse(texto) as T;
    } catch (causa) {
      throw new ErroDeVideo("FALHA", "O servico de videochamada respondeu algo que nao e JSON.", causa);
    }
  }
}
