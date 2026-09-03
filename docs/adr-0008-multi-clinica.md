# ADR-0008 - Plataforma multi-clinica: uma instalacao, muitas clinicas isoladas

**Status:** aceita
**Data:** 2026-08-27
**Modulo do curso:** 6

## Contexto

A plataforma sera vendida a varias clinicas, que convivem na mesma
instalacao. Isso exige responder tres perguntas antes de qualquer tela:

1. Uma pessoa pertence a uma clinica ou ao sistema?
2. Uma clinica pode ver o prontuario que outra produziu?
3. Onde o isolamento e garantido - na tela, na API ou no banco?

## Decisao

### 1. A pessoa e global; o papel e por clinica

Um login, um `perfil` (nome, CPF, telefone) e, se for medica, um `medico`
(CRM). O que a pessoa E em cada lugar mora em `vinculos` (pessoa x clinica
x papel x status). E o modelo que os sistemas de gestao clinica do mercado
usam: o profissional e cadastrado na clinica, com papel e permissoes
proprios, e pode atuar em mais de uma.

O papel saiu de `perfis` (onde estava desde o Modulo 4). Papeis:
`paciente`, `medico`, `recepcao`, `admin_clinica`.

### 2. Isolamento total entre clinicas

Dado assistencial pertence a uma clinica e nao atravessa a fronteira.
Uma medica que atende nas Clinicas A e B nao ve, logada em A, o que
registrou em B. Um paciente atendido nas duas tem historico separado.

Motivo: a guarda do prontuario e da instituicao que o produziu, e
compartilhar dado de saude entre controladores diferentes sem consentimento
especifico do titular nao se sustenta na LGPD. Compartilhamento entre
clinicas, se um dia existir, sera funcionalidade explicita, com registro do
consentimento - nunca o padrao.

Dentro da clinica vale o contrario: a equipe assistencial ve o historico do
paciente ainda que ele passe por varios profissionais - e o que faz um
prontuario ser util.

### 3. O isolamento e garantido no banco

Toda politica de RLS pergunta duas coisas: "esta linha e sua?" e "esta linha
e da clinica onde voce tem vinculo ativo?". Nao ha estado de sessao: cada
consulta se defende sozinha, venha da API, do site ou de alguem com a chave
publica na mao.

A API tambem exige a clinica (cabecalho `X-Clinica`) e recusa 403 sem
vinculo. Sao duas trancas para a mesma porta: a API usa a chave secreta, que
ignora o RLS, entao ela precisa se disciplinar - e o RLS existe para o dia
em que ela falhar.

### 4. Nao usamos claim de clinica no token

A alternativa comum e por `clinica_id` no JWT. Recusada: claims em
metadados do usuario podem ser alterados pelo proprio usuario e nao servem
para autorizacao; um claim fica velho (suspender um vinculo so teria efeito
no proximo login); e claim customizado exige configurar hook no painel,
contrariando a ADR-0004. Lemos `vinculos`, com indice proprio, e envolvemos
as funcoes em `(SELECT ...)` para o Postgres avaliar uma vez por consulta.

### 5. O papel so muda pela API

`vinculos` nao aceita INSERT, UPDATE nem DELETE de usuario - nem por
politica, nem por privilegio. A razao tecnica: `WITH CHECK` nao compara o
valor novo com o antigo, entao "pode editar a linha" viraria "pode editar o
papel". Promover alguem e rota da API, com auditoria.

### 6. Endereco por caminho (`/c/<slug>`), nao por subdominio

O plano inicial era subdominio (`clinica.plataforma.com.br`), como e comum
em SaaS B2B. Ficou para depois: em desenvolvimento, o cookie de sessao
gravado em `clinica.localhost` nao e visto em `localhost`, o que quebraria o
login e a troca de clinica. Como a API recebe a clinica por cabecalho, migrar
para subdominio depois nao muda nada no servidor - so o roteamento do site.

### 7. `suporte_plataforma` nunca acessa prontuario

Nossa equipe tem uma marca em `perfis`, para tarefas operacionais. Ela nao e
papel de vinculo e nao aparece em nenhuma politica de leitura de dado
assistencial. Acesso de suporte a dado de paciente, se um dia for necessario,
sera funcionalidade propria, com consentimento e auditoria - nunca um
privilegio silencioso.

## Consequencias

- Positivas: um cliente novo e uma linha em `clinicas`, nao um deploy; o
  isolamento e demonstravel em SQL, o que vale numa auditoria; a mesma
  pessoa atende em varios lugares sem ter varias contas.
- Negativas: toda tabela assistencial nova nasce com `clinica_id` e com
  politicas que checam vinculo - e um passo a mais, sempre. Toda rota nova
  de dentro da clinica precisa do contexto. Aceito: e o preco de nao
  vazar prontuario entre clientes.
- Na LGPD, cada clinica e controladora dos dados dos seus pacientes e a
  plataforma e operadora. Isso exige contrato de tratamento de dados com
  cada cliente - assunto juridico, fora do escopo tecnico, mas que nasce
  desta decisao.
