/**
 * Roda antes de todo arquivo de teste. Os testes leem DATABASE_URL direto e
 * criam e apagam dados: com um banco remoto, isso aconteceria onde estao os
 * dados de verdade. So passa com autorizacao explicita para aquele ambiente.
 */
import { ehEnderecoLocal } from "@tele/db";

const url = process.env.DATABASE_URL;
if (url && !ehEnderecoLocal(url) && process.env.PERMITIR_BANCO_REMOTO_EM_TESTE !== "sim") {
  throw new Error("Testes recusados: DATABASE_URL aponta para um banco remoto. Use um banco descartavel local (pnpm test:banco, com DATABASE_URL_TESTE).");
}
