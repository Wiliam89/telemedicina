import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Cria a conexao com o Postgres.
 *
 * `max: 10`      -> no maximo 10 conexoes abertas ao mesmo tempo.
 * `prepare: false` -> obrigatorio quando ha o "pooler" do Supabase na frente
 *                     (e ha, no endereco que voce copiou do botao Connect).
 * `onnotice`       -> silencia os avisos "ja existe, pulando" que o Postgres
 *                     emite quando uma migracao roda pela segunda vez.
 */
export function criarBanco(urlConexao: string) {
  const cliente = postgres(urlConexao, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return drizzle(cliente);
}

export type Banco = ReturnType<typeof criarBanco>;
