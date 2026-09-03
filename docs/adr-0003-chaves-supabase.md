# ADR-0003: Separacao das chaves do Supabase

**Data:** 2026-08-26
**Status:** aceita

## Contexto
O Supabase fornece uma chave publicavel (`sb_publishable_...`, antiga
`anon`) e chaves secretas (`sb_secret_...`, antiga `service_role`). A chave
secreta ignora todas as politicas de seguranca em nivel de linha (RLS).
No Next.js, toda variavel com prefixo `NEXT_PUBLIC_` e embutida no
JavaScript enviado ao navegador.

## Decisao
- `apps/web/.env.local` contem apenas a chave publicavel.
- `apps/api/.env` contem a chave secreta e a `DATABASE_URL`.
- Nenhum arquivo `.env` entra no Git; apenas os `.env.example`.
- `pnpm verificar` falha se encontrar `sb_secret_` em variavel `NEXT_PUBLIC_`.

## Consequencias
- Se a chave secreta vazar (commit acidental, log, print), o procedimento e
  rotacionar imediatamente em Project Settings > API Keys e tratar como
  incidente de seguranca - apagar o arquivo nao remove o historico do Git.
