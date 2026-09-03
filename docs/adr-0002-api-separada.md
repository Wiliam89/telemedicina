# ADR-0002: API propria (Fastify) separada do Next.js

**Data:** 2026-08-26
**Status:** aceita

## Contexto
O Next.js consegue executar codigo de servidor (Route Handlers, Server
Actions). Para muitos produtos isso basta. Dado clinico, porem, exige uma
fronteira nitida e auditavel.

## Decisao
Toda regra de negocio, toda regra legal e todo acesso ao banco com
credencial privilegiada vivem em `apps/api`. O frontend (`apps/web`) nunca
possui a chave secreta do Supabase e nunca fala com o banco para dado
clinico.

## Consequencias
- Um unico lugar grava a trilha de auditoria.
- Um aplicativo movel futuro consome a mesma API sem reescrever regras.
- Em auditoria, aponta-se para um servico e diz-se "as regras estao aqui".
- Custo: dois processos para rodar em desenvolvimento (`pnpm dev` sobe os dois).
