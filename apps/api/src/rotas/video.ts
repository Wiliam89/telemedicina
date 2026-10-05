/**
 * =====================================================================
 * A SALA DE VIDEO DA CONSULTA
 * =====================================================================
 *
 *   POST /consultas/:id/sala           entrar (devolve o token de entrada)
 *   POST /consultas/:id/sala/encerrar  o medico fecha a sala
 *   GET  /consultas/:id/sala           so olhar: a sala esta aberta?
 *
 * ESTE ARQUIVO E, ANTES DE TUDO, UM PORTEIRO. Para liberar a entrada ele
 * faz QUATRO perguntas, e todas as quatro tem que passar:
 *
 *   1. Esta consulta existe nesta clinica?
 *   2. Voce e o PACIENTE ou o MEDICO desta consulta?
 *   3. A consulta esta num estado que abre sala?
 *   4. Estamos dentro da janela de horario dela?
 *
 * A pergunta 2 e a que diferencia esta rota de todas as outras da
 * plataforma. Em toda outra, "papel na clinica" basta: recepcao mexe na
 * agenda, administracao ve pagamento. Aqui nao existe papel que sirva. Uma
 * consulta e entre duas pessoas, e so essas duas entram - nem a recepcao,
 * nem a administracao da clinica, nem quem mantem a plataforma. Nao ha
 * parametro para isso; nao e configuravel; e assim.
 *
 * E O TOKEN NAO E GUARDADO EM LUGAR NENHUM. Cada entrada emite um novo, no
 * nome de quem pediu, valido ate o fim da janela. Token em banco seria uma
 * credencial parada esperando vazamento - e, pior, uma credencial que
 * continuaria valendo depois de quem a pediu perder o direito de entrar.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consultas, filaAtendimento, perfis, salasDeVideo, type Banco } from "@tele/db";
import type { EntradaNaSala, Resposta } from "@tele/shared";
import { decidirEntrada, janelaDaSala } from "@tele/shared/video";
import { registrarAuditoria } from "../auditoria.js";
import type { Autenticador } from "../autenticacao.js";
import { criarExigirClinica } from "../contexto.js";
import { ErroHttp } from "../erros.js";
import { ErroDeVideo, type ProvedorDeVideo } from "../video/provedor.js";

/**
 * O nome da sala no provedor. Derivado da consulta, para que duas entradas
 * na mesma consulta caiam na MESMA sala - inclusive depois de recarregar a
 * pagina.
 *
 * Note que e o id da consulta, nao nome de paciente nem CPF: o nome da sala
 * aparece na URL, vai para o historico do navegador e para o log do
 * provedor. Nada que identifique a pessoa deve passar por ali.
 */
function nomeDaSala(consultaId: string): string {
  return `consulta-${consultaId}`;
}

export async function rotasVideo(
  app: FastifyInstance,
  opcoes: { banco: Banco; autenticar: Autenticador; provedor: ProvedorDeVideo },
): Promise<void> {
  const { banco, provedor } = opcoes;
  const dentroDaClinica = criarExigirClinica(banco, opcoes.autenticar);

  /**
   * Faz as quatro perguntas do cabecalho e devolve o que a rota precisa.
   * Separada porque as tres rotas abaixo fazem as mesmas verificacoes - e
   * porque verificacao de acesso repetida em tres lugares e verificacao que
   * um dia vai divergir em um deles.
   */
  async function conferirAcesso(
    clinicaId: string,
    consultaId: string,
    usuarioId: string,
  ): Promise<{
    consulta: { id: string; status: string; inicio: Date; fim: Date; pacienteId: string; medicoId: string };
    souMedico: boolean;
  }> {
    const [consulta] = await banco
      .select({
        id: consultas.id,
        status: consultas.status,
        inicio: consultas.inicio,
        fim: consultas.fim,
        pacienteId: consultas.pacienteId,
        medicoId: consultas.medicoId,
      })
      .from(consultas)
      .where(and(eq(consultas.id, consultaId), eq(consultas.clinicaId, clinicaId)))
      .limit(1);

    if (!consulta) throw new ErroHttp(404, "CONSULTA_NAO_ENCONTRADA", "Esta consulta nao existe nesta clinica.");

    const souMedico = consulta.medicoId === usuarioId;
    const souPaciente = consulta.pacienteId === usuarioId;

    /**
     * 403, e com uma mensagem que nao conta nada. Quem nao e da consulta
     * nao precisa saber que ela existe, de quem e, nem a que horas e - isso
     * por si ja seria informacao de saude sobre outra pessoa.
     */
    if (!souMedico && !souPaciente) {
      throw new ErroHttp(
        403,
        "FORA_DA_CONSULTA",
        "Somente o paciente e o medico desta consulta entram na sala de atendimento.",
      );
    }

    return { consulta, souMedico };
  }

  /** O nome de quem esta do outro lado, para a tela dizer com quem se vai falar. */
  async function nomeDe(perfilId: string): Promise<string> {
    const [p] = await banco.select({ nome: perfis.nomeCompleto }).from(perfis).where(eq(perfis.id, perfilId)).limit(1);
    return p?.nome ?? "";
  }

  // --- entrar ---------------------------------------------------------------

  app.post("/consultas/:id/sala", { preHandler: dentroDaClinica }, async (req): Promise<Resposta<EntradaNaSala>> => {
    const { id: consultaId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { consulta, souMedico } = await conferirAcesso(req.contexto.clinicaId, consultaId, req.usuario.id);

    const agora = new Date();
    const decisao = decidirEntrada({
      status: consulta.status as never,
      inicio: consulta.inicio,
      fim: consulta.fim,
      agora,
    });
    if (!decisao.pode) {
      // 409: o pedido esta correto, o momento e que nao. A tela usa o
      // codigo para dizer o que fazer em vez de so mostrar "erro".
      throw new ErroHttp(409, `SALA_${decisao.motivo.toUpperCase()}`, decisao.mensagem, {
        abreEm: decisao.abreEm.toISOString(),
        fechaEm: decisao.fechaEm.toISOString(),
      });
    }

    const { fechaEm } = janelaDaSala(consulta.inicio, consulta.fim);

    try {
      /**
       * A sala nasce na primeira entrada. Quem chegar depois - normalmente o
       * paciente, que fica esperando - reaproveita a mesma linha.
       *
       * `onConflictDoNothing` + releitura em vez de "procura, e se nao achar
       * cria": se as duas pessoas clicarem no mesmo instante, o indice unico
       * de `consulta_id` decide, e as duas acabam na mesma sala. Com o
       * "procura e cria" as duas poderiam criar salas diferentes e ficar
       * cada uma esperando a outra numa sala vazia.
       */
      const sala = await provedor.criarSala({ nome: nomeDaSala(consultaId), expiraEm: fechaEm });

      await banco
        .insert(salasDeVideo)
        .values({
          clinicaId: req.contexto.clinicaId,
          consultaId,
          provedor: provedor.nome,
          nomeNoProvedor: sala.nome,
          url: sala.url,
          expiraEm: sala.expiraEm,
        })
        .onConflictDoNothing({ target: salasDeVideo.consultaId });

      const [registrada] = await banco
        .select({ url: salasDeVideo.url, nome: salasDeVideo.nomeNoProvedor, encerradaEm: salasDeVideo.encerradaEm })
        .from(salasDeVideo)
        .where(eq(salasDeVideo.consultaId, consultaId))
        .limit(1);

      if (registrada?.encerradaEm) {
        throw new ErroHttp(
          409,
          "SALA_ENCERRADA",
          "O medico encerrou este atendimento. A sala foi fechada e nao abre de novo.",
        );
      }

      const entrada = await provedor.emitirToken({
        nomeDaSala: registrada?.nome ?? sala.nome,
        nomeDaPessoa: await nomeDe(req.usuario.id),
        pessoaId: req.usuario.id,
        papel: souMedico ? "anfitriao" : "participante",
        expiraEm: fechaEm,
      });

      /**
       * Registrar a entrada e exigencia de prontuario, nao zelo nosso: para
       * um atendimento a distancia, "quem esteve na sala e quando" e parte
       * do que prova que o atendimento aconteceu. A auditoria e imutavel
       * (Modulo 4), inclusive para quem tem a chave secreta.
       */
      await registrarAuditoria(banco, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "video.entrou",
        tabela: "salas_de_video",
        registroId: consultaId,
        detalhes: { papel: souMedico ? "medico" : "paciente", provedor: provedor.nome },
        ip: req.ip,
      });

      return {
        ok: true,
        dados: {
          provedor: provedor.nome,
          videoReal: provedor.videoReal,
          url: registrada?.url ?? sala.url,
          token: entrada.token,
          tokenExpiraEm: entrada.expiraEm.toISOString(),
          papel: souMedico ? "anfitriao" : "participante",
          outraPessoa: souMedico
            ? { nome: await nomeDe(consulta.pacienteId), papel: "paciente" }
            : { nome: await nomeDe(consulta.medicoId), papel: "medico" },
          fechaEm: fechaEm.toISOString(),
        },
      };
    } catch (erro) {
      if (erro instanceof ErroDeVideo) {
        // Falha do provedor nao e erro do usuario: 502, com a mensagem que
        // o adaptador escreveu pensando em quem esta na tela.
        throw new ErroHttp(erro.codigo === "PROVEDOR_INDISPONIVEL" ? 503 : 502, erro.codigo, erro.message);
      }
      throw erro;
    }
  });

  // --- olhar sem entrar -----------------------------------------------------

  /**
   * Para a tela decidir o que mostrar ANTES de pedir token: "a sala abre as
   * 14:45" e melhor que um botao que responde erro. Nao emite token, e por
   * isso nao abre nada.
   */
  app.get(
    "/consultas/:id/sala",
    { preHandler: dentroDaClinica },
    async (req): Promise<Resposta<{ pode: boolean; motivo?: string; mensagem?: string; abreEm: string; fechaEm: string; encerrada: boolean }>> => {
      const { id: consultaId } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { consulta } = await conferirAcesso(req.contexto.clinicaId, consultaId, req.usuario.id);

      const decisao = decidirEntrada({
        status: consulta.status as never,
        inicio: consulta.inicio,
        fim: consulta.fim,
        agora: new Date(),
      });

      const [sala] = await banco
        .select({ encerradaEm: salasDeVideo.encerradaEm })
        .from(salasDeVideo)
        .where(eq(salasDeVideo.consultaId, consultaId))
        .limit(1);

      return {
        ok: true,
        dados: {
          pode: decisao.pode && !sala?.encerradaEm,
          ...(decisao.pode ? {} : { motivo: decisao.motivo, mensagem: decisao.mensagem }),
          abreEm: decisao.abreEm.toISOString(),
          fechaEm: decisao.fechaEm.toISOString(),
          encerrada: Boolean(sala?.encerradaEm),
        },
      };
    },
  );

  // --- encerrar -------------------------------------------------------------

  /**
   * So o MEDICO encerra. Nao e hierarquia: e que encerrar fecha a sala para
   * os dois, e o paciente podendo fazer isso poderia derrubar o medico no
   * meio do atendimento - por engano, inclusive.
   *
   * Encerrar faz tres coisas, nesta ordem: apaga a sala no provedor, marca a
   * hora no banco e conclui a consulta. Apagar no provedor e o que faz um
   * token vazado deixar de valer; sem isso, o resto seria so anotacao.
   */
  app.post(
    "/consultas/:id/sala/encerrar",
    { preHandler: dentroDaClinica },
    async (req): Promise<Resposta<{ encerrada: true }>> => {
      const { id: consultaId } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { souMedico } = await conferirAcesso(req.contexto.clinicaId, consultaId, req.usuario.id);

      if (!souMedico) {
        throw new ErroHttp(403, "SO_O_MEDICO_ENCERRA", "Somente o medico da consulta encerra o atendimento.");
      }

      const [sala] = await banco
        .select({ nome: salasDeVideo.nomeNoProvedor, encerradaEm: salasDeVideo.encerradaEm })
        .from(salasDeVideo)
        .where(eq(salasDeVideo.consultaId, consultaId))
        .limit(1);

      if (sala && !sala.encerradaEm) {
        try {
          await provedor.apagarSala(sala.nome);
        } catch (erro) {
          // O provedor nao respondeu. Seguimos marcando o encerramento: a
          // sala expira sozinha no fim da janela, e deixar a consulta
          // "em_andamento" para sempre seria pior.
          req.log.warn({ erro, consultaId }, "nao foi possivel apagar a sala no provedor");
        }

        await banco
          .update(salasDeVideo)
          .set({ encerradaEm: new Date() })
          .where(and(eq(salasDeVideo.consultaId, consultaId), isNull(salasDeVideo.encerradaEm)));
      }

      const agora = new Date();
      await banco
        .update(consultas)
        .set({ status: "concluida", atualizadoEm: agora })
        .where(and(eq(consultas.id, consultaId), eq(consultas.status, "em_andamento")));

      /**
       * Atendimento de plantao: a linha da fila tambem se encerra. Sem isto,
       * o paciente continuaria aparecendo como "em atendimento" na fila
       * depois de a consulta ter acabado.
       */
      await banco
        .update(filaAtendimento)
        .set({ status: "atendido", encerradoEm: agora })
        .where(and(eq(filaAtendimento.consultaId, consultaId), eq(filaAtendimento.status, "em_atendimento")));

      await registrarAuditoria(banco, {
        quem: req.usuario.id,
        clinicaId: req.contexto.clinicaId,
        acao: "video.encerrou",
        tabela: "salas_de_video",
        registroId: consultaId,
        detalhes: {},
        ip: req.ip,
      });

      return { ok: true, dados: { encerrada: true } };
    },
  );
}
