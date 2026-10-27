/**
 * Identidade da instalacao, num lugar so. Cada instalacao configura a sua
 * em apps/web/.env.local; sem isso, usa os padroes (marcados como "a
 * preencher" nos textos legais, para ninguem publicar sem revisar).
 */
const env = (v: string | undefined, padrao: string) => v?.trim() || padrao;

export const NOME_DA_PLATAFORMA = env(process.env.NEXT_PUBLIC_NOME_PLATAFORMA, "TeleSaúde");

/** Quem opera a plataforma (operador de dados das clinicas - ADR-0018). */
export const EMPRESA = {
  razaoSocial: env(process.env.NEXT_PUBLIC_EMPRESA_RAZAO_SOCIAL, "[razão social a preencher]"),
  cnpj: env(process.env.NEXT_PUBLIC_EMPRESA_CNPJ, "[CNPJ a preencher]"),
  endereco: env(process.env.NEXT_PUBLIC_EMPRESA_ENDERECO, "[endereço a preencher]"),
};

/** Encarregado pelo tratamento de dados pessoais (DPO) - LGPD art. 41. */
export const ENCARREGADO = {
  nome: env(process.env.NEXT_PUBLIC_ENCARREGADO_NOME, "[nome do encarregado a preencher]"),
  email: env(process.env.NEXT_PUBLIC_ENCARREGADO_EMAIL, "privacidade@exemplo.com.br"),
};
