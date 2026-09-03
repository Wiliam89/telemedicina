# ADR-0006 - RLS ligado em toda tabela; a API escreve, o banco decide quem le

**Status:** aceita
**Data:** 2026-08-27
**Modulo do curso:** 4

## Contexto

A chave publica do Supabase vai para o navegador de qualquer pessoa
(ADR-0003). Com ela, qualquer um pode chamar o banco diretamente, sem passar
pela API. Se nada limitar o que essa chave enxerga, o prontuario inteiro
fica a um `select *` de distancia.

O Postgres tem Row Level Security (RLS): regras, por tabela, que dizem quais
linhas cada usuario logado pode ver, inserir, alterar ou apagar. O Supabase
identifica o usuario pelo token (`auth.uid()`).

## Decisao

1. **RLS ligado nas cinco tabelas**, sempre. Tabela nova nasce com RLS ligado
   e com politicas na mesma migracao; sem politica, ninguem ve nada - e esse
   e o padrao desejado.
2. **A API escreve.** Cadastro, agendamento e tudo que muda dado passa pela
   API, que usa a chave secreta (ignora o RLS) e registra auditoria na mesma
   transacao. O site nunca grava direto no banco.
3. **O banco decide quem le.** As politicas (migracao 0002) sao a ultima
   linha de defesa: mesmo que o site tenha um bug, mesmo que alguem use a
   chave publica fora do site, cada um so ve o que e seu. Paciente ve o
   proprio; medico ve quem atende; admin ve tudo; auditoria so o admin le e
   ninguem altera.
4. **Ninguem muda o proprio papel.** A politica de UPDATE em perfis exige
   `papel = papel_atual()`. Promover alguem a admin e tarefa da API com
   auditoria (modulo futuro), nunca do usuario.
5. `papel_atual()` e `SECURITY DEFINER` com `search_path` vazio: le perfis
   sem cair na recursao do RLS e sem risco de sequestro de schema.
6. O `pnpm verificar` ([7/7]) e a quinta luz do painel falham se alguma
   tabela estiver sem RLS, se faltar politica ou se `authenticated` tiver
   UPDATE/DELETE em auditoria.

## Consequencias

- Positivas: defesa em profundidade - API, RLS e auditoria se cobrem; a
  prestacao de contas da LGPD (art. 46, medidas de seguranca) vira SQL
  versionado.
- Negativas: toda tabela nova exige pensar nas politicas antes de existir.
  Aceito - em dado de saude, e a ordem certa.
