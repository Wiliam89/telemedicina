/**
 * Inspeciona o banco e responde: as tabelas do Modulo 3 estao la? As
 * migracoes foram todas aplicadas? A chave para auth.users e os gatilhos
 * existem? Usado por `pnpm db:verificar-tabelas`, pelo `pnpm verificar`
 * ([6/6]) e pela rota GET /saude da API (quarta luz do painel).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";

/** As tabelas que a migracao 0000 cria. Se mudar o schema, atualize aqui. */
export const TABELAS_ESPERADAS = ["clinicas", "perfis", "vinculos", "convites", "medicos", "pacientes", "disponibilidades", "bloqueios", "consultas", "plantoes", "precos", "pagamentos", "fila_atendimento", "evolucoes", "documentos", "auditoria"] as const;

export const PASTA_MIGRACOES = resolve(import.meta.dirname, "../drizzle");

export interface EstadoBanco {
  tabelasEncontradas: string[];
  tabelasFaltando: string[];
  migracoesEsperadas: number;
  migracoesAplicadas: number;
  chaveParaAuth: boolean;
  gatilhos: string[];
  /** Modulo 4: tabelas (das esperadas) que estao SEM row level security. */
  tabelasSemRls: string[];
  /** Modulo 4: quantas politicas existem no schema public. */
  politicas: number;
  /** Modulo 4: authenticated NAO consegue alterar/apagar auditoria? */
  auditoriaProtegida: boolean;
  /** Modulo 6: authenticated NAO consegue mexer em vinculos (papel)? */
  vinculosProtegidos: boolean;
  /** Modulo 6: quantas das 5 funcoes de contexto multi-clinica existem. */
  funcoesDeContexto: number;
}

/** Quantas migracoes existem na pasta drizzle/ (le o journal do Drizzle). */
export function contarMigracoesNaPasta(): number {
  try {
    const journal = JSON.parse(readFileSync(resolve(PASTA_MIGRACOES, "meta/_journal.json"), "utf8")) as {
      entries: unknown[];
    };
    return journal.entries.length;
  } catch {
    return 0;
  }
}

export async function inspecionarBanco(sql: Sql): Promise<EstadoBanco> {
  const tabelas = await sql<{ nome: string }[]>`
    select table_name as nome
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  const encontradas = tabelas.map((t) => t.nome);
  const faltando = TABELAS_ESPERADAS.filter((t) => !encontradas.includes(t));

  // O Drizzle registra cada migracao aplicada em drizzle.__drizzle_migrations.
  // Se a tabela ainda nao existe (banco nunca migrado), a consulta falha: 0.
  const [migracoes] = await sql<{ total: number }[]>`
    select count(*)::int as total from drizzle.__drizzle_migrations
  `.catch(() => [{ total: 0 }]);

  const [fk] = await sql<{ existe: boolean }[]>`
    select exists (
      select 1 from pg_constraint where conname = 'perfis_id_auth_users_id_fk'
    ) as existe
  `;

  const gatilhos = await sql<{ nome: string }[]>`
    select tgname as nome from pg_trigger
    where tgname in ('perfis_atualizado_em', 'consultas_atualizado_em') and not tgisinternal
    order by tgname
  `;

  // --- Modulo 4: RLS ---------------------------------------------------------
  const rls = await sql<{ nome: string; ativo: boolean }[]>`
    select c.relname as nome, c.relrowsecurity as ativo
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `;
  const semRls = TABELAS_ESPERADAS.filter((t) => rls.some((r) => r.nome === t && !r.ativo));

  const [pol] = await sql<{ total: number }[]>`
    select count(*)::int as total from pg_policies where schemaname = 'public'
  `;

  // Protegida = o papel "authenticated" nao tem UPDATE nem DELETE em auditoria.
  const [priv] = await sql<{ pode: boolean }[]>`
    select bool_or(privilege_type in ('UPDATE', 'DELETE')) as pode
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'auditoria' and grantee = 'authenticated'
  `;

  // Modulo 6: papel so muda pela API. Nem INSERT, nem UPDATE, nem DELETE.
  const [privVinculos] = await sql<{ pode: boolean }[]>`
    select bool_or(privilege_type in ('INSERT', 'UPDATE', 'DELETE')) as pode
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'vinculos' and grantee = 'authenticated'
  `;

  // Modulo 6: as funcoes de contexto multi-clinica (papel_atual sumiu na 0004).
  const [fn] = await sql<{ total: number }[]>`
    select count(distinct p.proname)::int as total
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('papel_na_clinica', 'tem_vinculo', 'tem_papel', 'minhas_clinicas', 'compartilha_clinica')
  `;

  return {
    tabelasEncontradas: encontradas,
    tabelasFaltando: [...faltando],
    migracoesEsperadas: contarMigracoesNaPasta(),
    migracoesAplicadas: migracoes?.total ?? 0,
    chaveParaAuth: fk?.existe ?? false,
    gatilhos: gatilhos.map((g) => g.nome),
    tabelasSemRls: [...semRls],
    politicas: pol?.total ?? 0,
    auditoriaProtegida: !(priv?.pode ?? false),
    vinculosProtegidos: !(privVinculos?.pode ?? false),
    funcoesDeContexto: fn?.total ?? 0,
  };
}

/** Modulo 4: a seguranca por linha esta completa? */
export function rlsCompleto(e: EstadoBanco): boolean {
  return (
    e.tabelasFaltando.length === 0 &&
    e.tabelasSemRls.length === 0 &&
    e.politicas >= POLITICAS_ESPERADAS &&
    e.auditoriaProtegida &&
    e.funcoesDeContexto === 5 &&
    e.vinculosProtegidos
  );
}

/** Quantas politicas a migracao 0002 cria. Se adicionar politica, atualize. */
export const POLITICAS_ESPERADAS = 30;

/** Resumo em uma palavra, usado pela API e pelo painel. */
export function resumirEstado(e: EstadoBanco): "migrado" | "faltam_migracoes" | "sem_tabelas" {
  if (e.tabelasFaltando.length === TABELAS_ESPERADAS.length) return "sem_tabelas";
  if (e.tabelasFaltando.length > 0 || e.migracoesAplicadas < e.migracoesEsperadas) return "faltam_migracoes";
  return "migrado";
}
