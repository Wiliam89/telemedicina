import { z } from "zod";

/**
 * =====================================================================
 * VALIDACAO DAS VARIAVEIS DE AMBIENTE
 * =====================================================================
 *
 * Os valores vem de apps/api/.env (o script `pnpm dev` carrega o arquivo).
 *
 * Regra: se algo estiver errado, a API se RECUSA a subir e diz exatamente
 * qual variavel esta com problema. E muito melhor quebrar agora, no seu
 * terminal, do que descobrir no meio de um atendimento.
 * Isso se chama "falhar cedo e alto".
 */

const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  PORT: z.coerce.number().int().min(1).max(65535).default(3333),

  SUPABASE_URL: z
    .string()
    .url("SUPABASE_URL precisa ser uma URL (https://xxxx.supabase.co)"),

  SUPABASE_SECRET_KEY: z
    .string()
    .min(20, "SUPABASE_SECRET_KEY esta vazia ou curta demais")
    .refine(
      (v) => !v.startsWith("sb_publishable_"),
      "SUPABASE_SECRET_KEY recebeu uma chave PUBLICAVEL. A API precisa da chave secreta (sb_secret_...).",
    ),

  DATABASE_URL: z
    .string()
    .startsWith("postgresql://", "DATABASE_URL precisa comecar com postgresql://")
    .refine((v) => !v.includes("[YOUR-PASSWORD]"), "DATABASE_URL ainda contem [YOUR-PASSWORD]"),

  /**
   * Provedor de assinatura ICP-Brasil. "local_teste" so vale fora de
   * producao: ele assina com certificado proprio, sem valor legal.
   */
  ASSINATURA_PROVEDOR: z.enum(["local_teste", "birdid"]).default("local_teste"),
  /**
   * AMBIENTE DE HOMOLOGACAO.
   *
   * A API se recusa a subir em producao com o provedor de assinatura de
   * teste - e faz isso de proposito: documento assinado por ele NAO tem
   * valor legal, e a farmacia recusaria a receita.
   *
   * Mas existe um caso legitimo no meio: a plataforma publicada na
   * internet para demonstracao, treinamento ou homologacao, onde nao ha
   * paciente real. Para esse caso, declare aqui - EXPLICITAMENTE:
   *
   *   PERMITIR_ASSINATURA_SEM_VALOR_LEGAL=sim
   *
   * Com isso a API sobe, avisa no log a cada inicializacao, e informa em
   * /saude que este ambiente nao produz documento com valor legal - para
   * o site exibir a tarja.
   *
   * NUNCA use isto num ambiente com paciente de verdade.
   */
  PERMITIR_ASSINATURA_SEM_VALOR_LEGAL: z
    .enum(["sim", "nao"])
    .default("nao")
    .transform((v) => v === "sim"),
  /**
   * Chave para cifrar segredos que precisam voltar em claro (hoje: o
   * client secret que cada clinica pode ter no provedor de assinatura).
   * 32 bytes em base64. Gere com:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  CHAVE_CRIPTOGRAFIA: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "deve ter 32 bytes em base64 (gere com node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")")
    .optional(),
  /** URL do provedor. Homologacao primeiro, producao depois. */
  ASSINATURA_URL: z.string().url("deve ser a URL do provedor de assinatura").optional(),
  ASSINATURA_CLIENT_ID: z.string().min(1).optional(),
  ASSINATURA_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * Endereco PUBLICO desta API - e para ca que o provedor de pagamento
   * manda as notificacoes. Em desenvolvimento, use um tunel (ngrok,
   * cloudflared): localhost nao e alcancavel de fora.
   */
  URL_PUBLICA_API: z.string().url("deve ser a URL publica da API").optional(),
  /**
   * Segredo do webhook de pagamento, definido no painel do provedor. E com
   * ele que conferimos que a notificacao veio mesmo de la.
   */
  PAGAMENTO_WEBHOOK_SEGREDO: z.string().min(8, "use um segredo com ao menos 8 caracteres").optional(),

  /**
   * Provedor da videochamada (Modulo 12). "local_teste" NAO faz
   * videochamada nenhuma: ele deixa o fluxo rodar na sua maquina sem conta
   * em servico nenhum, e mostra um aviso no lugar da imagem.
   */
  VIDEO_PROVEDOR: z.enum(["local_teste", "daily"]).default("local_teste"),
  /**
   * Chave da API do Daily (painel do Daily > Developers). Fica no servidor
   * e NUNCA vai para o navegador: com ela se cria sala na conta inteira. O
   * que o navegador recebe e um token de entrada, de uma pessoa, por
   * poucos minutos.
   */
  VIDEO_API_KEY: z.string().min(10, "VIDEO_API_KEY esta vazia ou curta demais").optional(),
  /**
   * O mesmo caso da assinatura sem valor legal: a plataforma publicada para
   * DEMONSTRACAO, sem paciente real, precisa subir sem conta de video. Para
   * esse caso, declare - EXPLICITAMENTE:
   *
   *   PERMITIR_VIDEO_SIMULADO=sim
   *
   * Com isso a API sobe, avisa no log a cada inicializacao, e informa em
   * /saude que aqui nao ha videochamada - para o site exibir a tarja.
   *
   * NUNCA use isto num ambiente com paciente de verdade.
   */
  PERMITIR_VIDEO_SIMULADO: z
    .enum(["sim", "nao"])
    .default("nao")
    .transform((v) => v === "sim"),

  ORIGEM_PERMITIDA: z.string().default("http://localhost:3000"),
});

export type Ambiente = z.infer<typeof esquema>;

/**
 * Separada em funcao para poder ser testada com valores falsos.
 * Em producao e chamada uma unica vez, no inicio do servidor.
 */
export function carregarAmbiente(origem: NodeJS.ProcessEnv = process.env): Ambiente {
  const resultado = esquema.safeParse(origem);

  if (!resultado.success) {
    const erros = resultado.error.flatten().fieldErrors;
    console.error("\nA API nao pode subir. Variaveis de ambiente invalidas em apps/api/.env:\n");
    for (const [nome, mensagens] of Object.entries(erros)) {
      console.error(`  ${nome}: ${mensagens?.join("; ")}`);
    }
    console.error("\nRode  pnpm verificar  na raiz do projeto para ver onde pegar cada valor.\n");
    process.exit(1);
  }

  return resultado.data;
}
