# ADR-0004 - Toda mudanca no banco e uma migracao versionada (Drizzle)

**Status:** aceita
**Data:** 2026-08-27
**Modulo do curso:** 3

## Contexto

O painel do Supabase permite criar e alterar tabelas com cliques (Table
Editor). E rapido, mas deixa tres problemas em um sistema de saude:

- nao ha historico de quem mudou o que, nem quando;
- o banco de desenvolvimento e o de producao acabam diferentes sem que
  ninguem perceba;
- nao e possivel recriar o banco do zero (numa auditoria, num desastre,
  num novo ambiente) a partir do codigo.

## Decisao

1. As tabelas sao descritas em TypeScript, em `packages/db/src/schema/`.
   Esse codigo e a unica fonte da verdade sobre a estrutura do banco.
2. Toda mudanca vira um arquivo `.sql` numerado em `packages/db/drizzle/`,
   gerado pelo `pnpm db:gerar` (ou escrito a mao com `--custom` quando o
   Drizzle nao sabe gerar - ex.: chave para `auth.users`, gatilhos).
3. Os arquivos sao aplicados, em ordem, pelo `pnpm db:migrar`. O Drizzle
   registra o que ja rodou em `drizzle.__drizzle_migrations`; rodar de novo
   nao repete nada.
4. Ninguem cria ou altera tabela pelo painel do Supabase. O `pnpm verificar`
   confere se o banco tem exatamente as migracoes da pasta.
5. Migracao aplicada em producao nunca e editada: corrigiu-se com a proxima.

## Consequencias

- Positivas: o Git guarda a historia completa do banco (prestacao de contas,
  LGPD art. 6, X); dev e prod ficam identicos; qualquer pessoa recria o
  banco com dois comandos.
- Negativas: um passo a mais para cada mudanca de tabela. Aceito.
