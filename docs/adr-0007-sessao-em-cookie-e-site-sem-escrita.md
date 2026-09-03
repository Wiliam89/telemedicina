# ADR-0007 - Sessao em cookie; o site le pelo RLS e escreve so pela API

**Status:** aceita
**Data:** 2026-08-27
**Modulo do curso:** 5

## Contexto

O site (Next.js) precisa saber quem esta logado tanto no navegador (para
formularios) quanto no servidor (Server Components, que montam o HTML antes
de enviar). O Supabase Auth entrega tokens de curta duracao (1 h) que
precisam ser renovados sem a pessoa perceber.

## Decisao

1. **A sessao vive em cookie**, gravado pelo cliente do navegador
   (`@supabase/ssr`) e lido pelo servidor e pelo middleware. Nao usamos
   localStorage: o servidor nao o enxerga e ele e mais exposto a scripts.
2. **O middleware renova a sessao a cada requisicao** e faz a portaria das
   paginas: sem login, as telas internas mandam para `/entrar?depois=...`;
   com login, `/entrar` e `/criar-conta` mandam para `/inicio`.
3. **Quem esta logado e sempre confirmado com `getUser()`**, que valida o
   token no Supabase - nunca so lendo o cookie. Um usuario bloqueado deixa
   de entrar na proxima requisicao.
4. **O site nunca escreve no banco.** Toda gravacao passa pela API
   (`POST /perfis` e as que virao), com validacao e auditoria. O cliente
   Supabase do site so existe para login/logout e, quando fizer sentido,
   leituras que o RLS permite.
5. **Server Components chamam a API com o token do cookie** e entregam HTML
   pronto. O navegador nao ve a URL da API nem o token em JavaScript nessas
   telas; nos formularios (Client Components) o token e usado uma vez, na
   chamada, e nao fica em variavel global.
6. **Confirmacao de e-mail ligada em producao**, desligada em
   `telemedicina-dev` para o curso. O formulario de cadastro trata os dois
   casos.

## Consequencias

- Positivas: sessao continua entre abas e sobrevive ao F5; o servidor sabe
  quem e a pessoa antes de montar a tela; nao ha caminho de escrita que
  desvie da auditoria.
- Negativas: uma chamada ao Supabase por requisicao no middleware. Aceito -
  e o preco de nunca confiar num cookie sem verificar.
