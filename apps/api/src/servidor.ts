import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
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
import { rotasPerfis } from "./rotas/perfis.js";

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
  /** Padrao: le apps/api/.env. Os testes passam valores falsos. */
  ambiente?: Ambiente;
  /** Padrao: pergunta ao Supabase Auth. Os testes passam um falso. */
  autenticar?: Autenticador;
}

export async function criarServidor(opcoes: OpcoesServidor = {}) {
  const ambiente = opcoes.ambiente ?? carregarAmbiente();
  const autenticar = opcoes.autenticar ?? criarAutenticadorSupabase(ambiente);

  // Uma unica conexao com o banco para a API inteira (Modulo 3).
  const banco = criarBanco(ambiente.DATABASE_URL);

  const app = Fastify({
    logger: {
      level: ambiente.NODE_ENV === "production" ? "info" : ambiente.NODE_ENV === "test" ? "silent" : "debug",
      // NUNCA registrar tokens nem cookies no log.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: ambiente.ORIGEM_PERMITIDA.split(",").map((o) => o.trim()),
    credentials: true,
    // Sem isto o navegador recusa o cabecalho que diz em qual clinica estamos.
    allowedHeaders: ["content-type", "authorization", "x-clinica"],
  });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  app.setErrorHandler(tratarErro);

  /**
   * GET /saude
   *
   * 1. Pergunta ao Supabase Auth se ele esta no ar, usando a chave secreta.
   * 2. Pergunta ao Postgres se as tabelas existem e as migracoes foram
   *    aplicadas (Modulo 3) e se o RLS esta ligado com as politicas (Modulo 4).
   */
  app.get("/saude", async (): Promise<Resposta<StatusSaude>> => {
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
      dados: { api: "no_ar", supabase, banco: estadoBanco, seguranca, versao: "0.1.0", horario: new Date().toISOString() },
    };
  });

  await app.register(rotasPerfis, { banco, autenticar });
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
    })
    .catch((erro) => {
      console.error("Falha ao iniciar a API:", erro);
      process.exit(1);
    });
}
