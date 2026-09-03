/**
 * Testes que nao precisam de banco: conferem que o schema em TypeScript e a
 * pasta drizzle/ estao coerentes entre si. Rode na raiz: pnpm test
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";
import { contarMigracoesNaPasta, PASTA_MIGRACOES, POLITICAS_ESPERADAS, TABELAS_ESPERADAS } from "./estado-banco.js";

describe("schema e migracoes", () => {
  it("1. o schema exporta exatamente as tabelas que o verificador espera", () => {
    const nomes = [
      schema.clinicas, schema.perfis, schema.vinculos, schema.convites,
      schema.medicos, schema.pacientes, schema.disponibilidades, schema.bloqueios,
      schema.consultas, schema.plantoes, schema.precos, schema.pagamentos, schema.filaAtendimento,
      schema.evolucoes, schema.documentos, schema.auditoria,
    ].map(getTableName);
    expect(nomes.sort()).toEqual([...TABELAS_ESPERADAS].sort());
  });

  it("2. cada migracao do journal existe como arquivo .sql", () => {
    const journal = JSON.parse(readFileSync(resolve(PASTA_MIGRACOES, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.length).toBe(contarMigracoesNaPasta());
    for (const { tag } of journal.entries) {
      expect(existsSync(resolve(PASTA_MIGRACOES, `${tag}.sql`)), `${tag}.sql nao existe`).toBe(true);
    }
  });

  it("3. cada tabela esperada nasce em alguma migracao e o RLS e ligado nela", () => {
    // Le TODAS as migracoes juntas: uma tabela criada na 0000 ou na 0003 vale igual.
    const journal = JSON.parse(readFileSync(resolve(PASTA_MIGRACOES, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tudo = journal.entries.map((e) => readFileSync(resolve(PASTA_MIGRACOES, `${e.tag}.sql`), "utf8")).join("\n");

    for (const t of TABELAS_ESPERADAS) {
      expect(tudo, `${t} nunca e criada`).toContain(`CREATE TABLE "${t}"`);
      expect(tudo, `${t} nunca liga o RLS`).toMatch(new RegExp(`ALTER TABLE "${t}"\\s+ENABLE ROW LEVEL SECURITY`));
    }
    expect(tudo).toContain('REFERENCES "auth"."users"("id")');
    expect(tudo).toContain("definir_atualizado_em");
  });

  it("4. o numero de politicas em vigor bate com POLITICAS_ESPERADAS", () => {
    const journal = JSON.parse(readFileSync(resolve(PASTA_MIGRACOES, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tudo = journal.entries.map((e) => readFileSync(resolve(PASTA_MIGRACOES, `${e.tag}.sql`), "utf8")).join("\n");
    const criadas = (tudo.match(/CREATE POLICY/g) ?? []).length;
    const removidas = (tudo.match(/DROP POLICY/g) ?? []).length;
    expect(criadas - removidas).toBe(POLITICAS_ESPERADAS);
  });

  it("5. o papel authenticated nao escreve em vinculos nem altera a auditoria", () => {
    const m5 = readFileSync(resolve(PASTA_MIGRACOES, "0005_rls_multi_clinica.sql"), "utf8");
    expect(m5).toContain('REVOKE INSERT, UPDATE, DELETE ON "vinculos"');
    const m2 = readFileSync(resolve(PASTA_MIGRACOES, "0002_rls_e_politicas.sql"), "utf8");
    expect(m2).toContain('REVOKE UPDATE, DELETE ON "auditoria"');
  });
});
