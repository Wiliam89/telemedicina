import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { criarBanco, inspecionarBanco, resumirEstado, rlsCompleto } from "@tele/db";
import type { Resposta, StatusSaude } from "@tele/shared";
import { carregarAmbiente, type Ambiente } from "./ambiente.js";
import { criarAutenticadorSupabase, type Autenticador } from "./autenticacao.js";
import { tratarErro } from "./erros.js";
import { rotasClinicas } from "./rotas/clinicas.js";
import { ArmazenamentoDeDocumentos, ResolvedorDeProvedor } from "./assinatura/index.js";
import { lerChave } from "./criptografia.js";
import { rotasAgenda } from "./rotas/agenda.js";
import { rotasAssinatura } from "./rotas/assinar.js";
import { ResolvedorDePagamento } from "./pagamento/index.js";
import { rotasDocumentos } from "./rotas/documentos.js";
import { rotasFila } from "./rotas/fila.js";
import { rotasPagamentos } from "./rotas/pagamentos.js";
import { rotasEquipe } from "./rotas/equipe.js";
import { rotasProntuario } from "./rotas/prontuario.js";
import { rotasLgpd } from "./rotas/lgpd.js";
import { rotasNotificacoes } from "./rotas/notificacoes.js";
import { rotasIndicadores } from "./rotas/indicadores.js";
import { EnviadorConsole, EnviadorResend, rodarAgendador, type EnviadorDeEmail } from "./notificacoes/index.js";
import { rotasPacientes } from "./rotas/pacientes.js";
import { rotasPerfis } from "./rotas/perfis.js";
import { rotasVideo } from "./rotas/video.js";
import { criarProvedorDeVideo } from "./video/resolvedor.js";
import type { ProvedorDeVideo } from "./video/provedor.js";
import { ArmazenamentoSupabaseDeAnexos, type ArmazenamentoDeAnexos } from "./anexos/armazenamento.js";

/**
 * =====================================================================
 * PONTO DE ENTRADA DA API
 * =====================================================================
 *
 * O que sobe aqui, nesta ordem (a ordem importa - um plugin registrado
 * depois nao protege o que veio antes):
 *
 *   1. helmet      -> cabecalhos de seguranca do navegador
 *   2. cors        -> so o nosso site pode chamar a API
 *   3. rate-limit  -> 100 chamadas por minuto por IP
 *   4. tratamento de erros -> toda falha sai no envelope RespostaErro
 *   5. rotas:
 *        GET  /saude        (publica)   API, Supabase, banco e seguranca
 *        POST /perfis       (login)     cria o perfil da pessoa logada
 *        GET  /perfis/eu    (login)     le o proprio perfil
 *        GET  /medicos      (login)     lista os medicos
 */

export interface OpcoesServidor {
  /** Padrao: Supabase Storage. Os testes passam um armazenamento em memoria. */
  armazenamento?: ArmazenamentoDeDocumentos;
  armazenamentoDeAnexos?: ArmazenamentoDeAnexos;
  enviadorDeEmail?: EnviadorDeEmail;
  /** Padrao: le apps/api/.env. Os testes passam valores falsos. */
  ambiente?: Ambiente;
  /** Padrao: pergunta ao Supabase Auth. Os testes passam um falso. */
  autenticar?: Autenticador;
  /** Padrao: decidido por VIDEO_PROVEDOR. Os testes passam um dublê. */
  provedorDeVideo?: ProvedorDeVideo;
}

export async function criarServidor(opcoes: OpcoesServidor = {}) {
  const ambiente = opcoes.ambiente ?? carregarAmbiente();
  const autenticar = opcoes.autenticar ?? criarAutenticadorSupabase(ambiente);

  // Uma unica conexao com o banco para a API inteira (Modulo 3).
  const banco = criarBanco(ambiente.DATABASE_URL, { max: ambiente.DB_POOL_MAX });

  /**
   * O provedor de video e escolhido UMA VEZ, aqui. Se a configuracao
   * estiver errada (ou for o simulado em producao sem autorizacao
   * explicita), esta linha lanca e a API nao sobe - que e exatamente o que
   * se quer: melhor quebrar no terminal agora do que no meio de uma
   * consulta (Modulo 12).
   */
  const provedorDeVideo = opcoes.provedorDeVideo ?? criarProvedorDeVideo(ambiente);

  const app = Fastify({
    logger: {
      level: ambiente.NODE_ENV === "production" ? "info" : ambiente.NODE_ENV === "test" ? "silent" : "debug",
      // NUNCA registrar tokens nem cookies no log.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
    // Identificador da requisicao: vem do balanceador (x-request-id) ou e
    // gerado aqui, aparece em todo log e volta no cabecalho da resposta -
    // e com ele que se acha, no log, o erro que o usuario relatou.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
  });
  app.addHook("onSend", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: ambiente.ORIGEM_PERMITIDA.split(",").map((o) => o.trim()),
    credentials: true,
    // Sem isto o navegador recusa o cabecalho que diz em qual clinica estamos.
    allowedHeaders: ["content-type", "authorization", "x-clinica"],
  });
  // Limite geral por IP. Rotas caras ou sensiveis tem limite proprio
  // (config.rateLimit na rota). O contador e por instancia; para um limite
  // global entre instancias, ligue um Redis ao plugin (ADR-0020).
  await app.register(rateLimit, { max: ambiente.LIMITE_POR_MINUTO, timeWindow: "1 minute" });
  // Exames e laudos chegam como arquivo (ADR-0015). O limite real por
  // arquivo e conferido na rota; este e o teto da requisicao inteira.
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 } });
  app.setErrorHandler(tratarErro);

  /**
   * GET /saude
   *
   * 1. Pergunta ao Supabase Auth se ele esta no ar, usando a chave secreta.
   * 2. Pergunta ao Postgres se as tabelas existem e as migracoes foram
   *    aplicadas (Modulo 3) e se o RLS esta ligado com as politicas (Modulo 4).
   */
  // Sondas para o orquestrador (Render, Fly, Kubernetes):
  //   /vivo   o processo responde? (nunca toca o banco - reiniciar nao cura banco fora)
  //   /pronto pode receber trafego? (o banco responde em ate 2 s)
  app.get("/vivo", { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get("/pronto", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await Promise.race([banco.$client`select 1`, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000))]);
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, erro: { codigo: "BANCO_INDISPONIVEL", mensagem: "O banco nao respondeu." } });
    }
  });

  app.get("/saude", async (): Promise<Resposta<StatusSaude>> => {
    // Quem consome precisa saber se o que sai daqui vale de verdade.
    const documentosComValorLegal = ambiente.ASSINATURA_PROVEDOR !== "local_teste";
    // E se ha videochamada de verdade. O site mostra tarja quando nao ha.
    const videoReal = provedorDeVideo.videoReal;
    let supabase: StatusSaude["supabase"] = "falhou";
    let estadoBanco: StatusSaude["banco"] = { estado: "falhou", migracoesAplicadas: 0, migracoesEsperadas: 0, tabelas: [] };
    let seguranca: StatusSaude["seguranca"] = { estado: "desconhecido", tabelasSemRls: [], politicas: 0 };

    try {
      const resposta = await fetch(`${ambiente.SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: ambiente.SUPABASE_SECRET_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (resposta.ok) supabase = "conectado";
    } catch (erro) {
      app.log.warn({ erro }, "Supabase nao respondeu ao /auth/v1/health");
    }

    try {
      // O site espera no maximo 5 s pela API; o banco tem 3 s para responder.
      const e = await Promise.race([
        inspecionarBanco(banco.$client),
        new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error("Postgres nao respondeu em 3 s")), 3000)),
      ]);
      estadoBanco = {
        estado: resumirEstado(e),
        migracoesAplicadas: e.migracoesAplicadas,
        migracoesEsperadas: e.migracoesEsperadas,
        tabelas: e.tabelasEncontradas,
      };
      seguranca = {
        estado: rlsCompleto(e) ? "protegido" : "incompleto",
        tabelasSemRls: e.tabelasSemRls,
        politicas: e.politicas,
      };
    } catch (erro) {
      app.log.warn({ erro }, "Postgres nao respondeu (DATABASE_URL)");
    }

    return {
      ok: true,
      dados: { api: "no_ar", supabase, banco: estadoBanco, seguranca, documentosComValorLegal, videoReal, versao: "0.1.0", horario: new Date().toISOString() },
    };
  });

  await app.register(rotasPerfis, { banco, autenticar });
  await app.register(rotasLgpd, { banco, autenticar });
  await app.register(rotasNotificacoes, { banco, autenticar });
  await app.register(rotasIndicadores, { banco, autenticar });

  // --- agendador de avisos (ADR-0019) ----------------------------------------
  const enviador: EnviadorDeEmail =
    opcoes.enviadorDeEmail ??
    (ambiente.EMAIL_PROVEDOR === "resend" && ambiente.EMAIL_API_KEY && ambiente.EMAIL_REMETENTE
      ? new EnviadorResend(ambiente.EMAIL_API_KEY, ambiente.EMAIL_REMETENTE)
      : new EnviadorConsole((m) => app.log.info(m)));
  if (ambiente.EMAIL_PROVEDOR === "resend" && !enviador.real) {
    app.log.warn("EMAIL_PROVEDOR=resend sem EMAIL_API_KEY/EMAIL_REMETENTE: os e-mails NAO serao enviados (so a central da plataforma).");
  }
  const urlDoSite = ambiente.ORIGEM_PERMITIDA.split(",")[0]!.trim();
  // Nos testes o agendador nao roda sozinho: eles chamam rodarAgendador().
  if (ambiente.NODE_ENV !== "test") {
    let rodando = false;
    const ciclo = setInterval(async () => {
      if (rodando) return; // um ciclo lento nao empilha outro
      rodando = true;
      try {
        const r = await rodarAgendador(banco, enviador, { urlDoSite, plataforma: ambiente.NOME_PLATAFORMA });
        if (r.lembretes || r.enviados || r.falhas) app.log.info({ agendador: r }, "agendador de avisos");
      } catch (erro) {
        app.log.error({ erro }, "agendador de avisos falhou");
      } finally {
        rodando = false;
      }
    }, 60_000);
    ciclo.unref();
    app.addHook("onClose", async () => clearInterval(ciclo));
  }
  const resolvedor = new ResolvedorDeProvedor(banco, ambiente);
  const chaveDeCriptografia = ambiente.CHAVE_CRIPTOGRAFIA ? lerChave(ambiente.CHAVE_CRIPTOGRAFIA) : null;

  await app.register(rotasClinicas, { banco, autenticar, resolvedor, chaveDeCriptografia });
  await app.register(rotasEquipe, { banco, autenticar, urlDoSite: ambiente.ORIGEM_PERMITIDA.split(",")[0]!.trim() });
  await app.register(rotasAgenda, { banco, autenticar });
  await app.register(rotasFila, { banco, autenticar });
  await app.register(rotasPagamentos, {
    banco,
    autenticar,
    resolvedor: new ResolvedorDePagamento(banco, ambiente),
    urlPublicaDaApi: ambiente.URL_PUBLICA_API ?? `http://localhost:${ambiente.PORT}`,
    segredoDoWebhook: ambiente.PAGAMENTO_WEBHOOK_SEGREDO ?? "segredo-de-desenvolvimento",
  });
  await app.register(rotasProntuario, { banco, autenticar });
  await app.register(rotasDocumentos, { banco, autenticar });
  await app.register(rotasPacientes, {
    banco,
    autenticar,
    armazenamento: opcoes.armazenamentoDeAnexos ?? new ArmazenamentoSupabaseDeAnexos(ambiente.SUPABASE_URL, ambiente.SUPABASE_SECRET_KEY),
  });
  await app.register(rotasVideo, { banco, autenticar, provedor: provedorDeVideo });
  await app.register(rotasAssinatura, {
    banco,
    autenticar,
    resolvedor,
    armazenamento: opcoes.armazenamento ?? new ArmazenamentoDeDocumentos(ambiente.SUPABASE_URL, ambiente.SUPABASE_SECRET_KEY),
    urlDoSite: ambiente.ORIGEM_PERMITIDA.split(",")[0]!.trim(),
  });

  // Fecha a conexao com o banco quando a API e desligada (Ctrl+C).
  app.addHook("onClose", async () => {
    await banco.$client.end({ timeout: 2 });
  });

  return { app, ambiente };
}

/* So inicia de verdade quando este arquivo e executado diretamente
   (e nao quando e importado por um teste). */
const executadoDiretamente = process.argv[1]?.endsWith("servidor.ts") || process.argv[1]?.endsWith("servidor.js");

if (executadoDiretamente) {
  criarServidor()
    .then(async ({ app, ambiente }) => {
      await app.listen({ port: ambiente.PORT, host: "0.0.0.0" });
      app.log.info(`API no ar em http://localhost:${ambiente.PORT}/saude`);

      // Desligamento gracioso: no deploy o orquestrador manda SIGTERM. Paramos
      // de aceitar conexoes, terminamos as requisicoes em andamento, paramos
      // o agendador e fechamos o banco - ninguem perde uma gravacao no meio.
      let desligando = false;
      for (const sinal of ["SIGTERM", "SIGINT"] as const) {
        process.on(sinal, async () => {
          if (desligando) return;
          desligando = true;
          app.log.info(`${sinal} recebido: encerrando com calma...`);
          const limite = setTimeout(() => process.exit(1), 15_000);
          limite.unref();
          await app.close();
          process.exit(0);
        });
      }
    })
    .catch((erro) => {
      console.error("Falha ao iniciar a API:", erro);
      process.exit(1);
    });
}
