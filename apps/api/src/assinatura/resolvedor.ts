/**
 * =====================================================================
 * QUAL PROVEDOR USAR, PARA CADA CLINICA
 * =====================================================================
 *
 * Duas formas de operar convivem, e a escolha e comercial, nao tecnica:
 *
 *   a) A CLINICA tem contrato proprio com o provedor. As credenciais dela
 *      ficam na tabela `clinicas` (com o segredo cifrado) e a fatura vai
 *      para ela.
 *   b) A CLINICA nao tem. Usa-se a credencial da PLATAFORMA, de
 *      apps/api/.env.
 *
 * Em ambos os casos os creditos de assinatura saem do certificado do
 * MEDICO - a credencial da aplicacao so autoriza o software a pedir.
 *
 * O resolvedor guarda o provedor montado em memoria por alguns minutos:
 * montar um adaptador e barato, mas decifrar a cada assinatura nao
 * precisa acontecer.
 */
import { eq } from "drizzle-orm";
import { clinicas, type Banco } from "@tele/db";
import type { Ambiente } from "../ambiente.js";
import { decifrar, lerChave } from "../criptografia.js";
import { ProvedorBirdId } from "./provedor-birdid.js";
import { ProvedorLocalDeTeste } from "./provedor-local.js";
import type { ProvedorDeAssinatura } from "./provedor.js";

const VALIDADE_DO_CACHE_MS = 5 * 60 * 1000;

export class ResolvedorDeProvedor {
  private readonly cache = new Map<string, { provedor: ProvedorDeAssinatura; ate: number }>();
  private readonly padrao: ProvedorDeAssinatura;

  constructor(
    private readonly banco: Banco,
    private readonly ambiente: Ambiente,
  ) {
    this.padrao = criarProvedorDaPlataforma(ambiente);
  }

  /** O provedor desta clinica: o dela, se houver; senao o da plataforma. */
  async para(clinicaId: string): Promise<ProvedorDeAssinatura> {
    const emCache = this.cache.get(clinicaId);
    if (emCache && emCache.ate > Date.now()) return emCache.provedor;

    const [c] = await this.banco
      .select({
        provedor: clinicas.assinaturaProvedor,
        url: clinicas.assinaturaUrl,
        clientId: clinicas.assinaturaClientId,
        secretCifrado: clinicas.assinaturaClientSecretCifrado,
      })
      .from(clinicas)
      .where(eq(clinicas.id, clinicaId))
      .limit(1);

    let provedor = this.padrao;

    if (c?.provedor === "birdid" && c.url && c.clientId && c.secretCifrado) {
      if (!this.ambiente.CHAVE_CRIPTOGRAFIA) {
        throw new Error("Esta clinica tem credenciais proprias de assinatura, mas CHAVE_CRIPTOGRAFIA nao esta definida em apps/api/.env.");
      }
      provedor = new ProvedorBirdId({
        urlBase: c.url,
        clientId: c.clientId,
        clientSecret: decifrar(c.secretCifrado, lerChave(this.ambiente.CHAVE_CRIPTOGRAFIA)),
      });
    }

    this.cache.set(clinicaId, { provedor, ate: Date.now() + VALIDADE_DO_CACHE_MS });
    return provedor;
  }

  /** Chamado quando a clinica troca as credenciais. */
  esquecer(clinicaId: string): void {
    this.cache.delete(clinicaId);
  }
}

/**
 * O provedor da plataforma, de apps/api/.env.
 *
 * A TRAVA: o provedor local assina com certificado fora da cadeia
 * ICP-Brasil - sem valor legal. Em producao a API se recusa a subir com
 * ele. Melhor nao iniciar do que emitir receita que a farmacia recusa.
 */
export function criarProvedorDaPlataforma(ambiente: Ambiente): ProvedorDeAssinatura {
  if (ambiente.ASSINATURA_PROVEDOR === "birdid") {
    if (!ambiente.ASSINATURA_URL || !ambiente.ASSINATURA_CLIENT_ID || !ambiente.ASSINATURA_CLIENT_SECRET) {
      throw new Error("ASSINATURA_PROVEDOR=birdid exige ASSINATURA_URL, ASSINATURA_CLIENT_ID e ASSINATURA_CLIENT_SECRET em apps/api/.env.");
    }
    return new ProvedorBirdId({
      urlBase: ambiente.ASSINATURA_URL,
      clientId: ambiente.ASSINATURA_CLIENT_ID,
      clientSecret: ambiente.ASSINATURA_CLIENT_SECRET,
    });
  }

  if (ambiente.NODE_ENV === "production") {
    throw new Error(
      "O provedor de assinatura local NAO tem valor legal e nao pode ser usado em producao. " +
        "Configure ASSINATURA_PROVEDOR=birdid com as credenciais, ou cadastre credenciais por clinica.",
    );
  }
  return new ProvedorLocalDeTeste();
}
