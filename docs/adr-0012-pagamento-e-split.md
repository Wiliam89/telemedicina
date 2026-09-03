# ADR-0012 - Pagamento: split no provedor, webhook como fonte da verdade

**Status:** aceita
**Data:** 2026-09-01
**Modulo do curso:** 10

## Contexto

O paciente so entra na fila ou confirma consulta depois de pagar. Isso
coloca a plataforma no meio de um fluxo financeiro - e ali existem regras
que nao sao de engenharia, mas do Banco Central.

## Decisao

### 1. O split e executado pelo PROVEDOR, nunca por nos

Nos dizemos quanto e de cada parte; quem divide e liquida e o gateway.

O motivo e regulatorio: receber o valor cheio na conta da plataforma e
repassar depois caracteriza participacao em arranjo de pagamento (Circular
BACEN 3.682/2013) e exigiria licenca de Instituicao de Pagamento. A
"solucao simples" aqui e ilegal.

Consequencia pratica: a clinica precisa autorizar a plataforma no provedor
(OAuth) para que ele possa depositar na conta dela. Clinica sem essa
autorizacao nao cobra - e a mensagem diz isso com todas as letras.

### 2. O token do vendedor VENCE, e isso e um alarme

No Mercado Pago o token dura seis meses; vencido, os repasses param. Nao e
detalhe de implementacao: e uma clinica descobrindo que nao recebe.
Guardamos `pagamento_token_expira_em` e avisamos a partir de 15 dias antes,
na resposta da cobranca e no `pnpm verificar`.

### 3. O estado do pagamento vem do provedor, nunca da tela

"O usuario voltou para a pagina de sucesso" nao e prova de pagamento - e
so uma pagina, e qualquer pessoa consegue abri-la. A confirmacao chega por
webhook.

E o webhook nao acredita no que recebe: depois de conferir a assinatura,
a API vai ao provedor PERGUNTAR o estado real. O corpo da notificacao diz
"algo mudou", nao "esta pago"; confiar nele seria confiar em quem pode ter
forjado o valor.

### 4. Webhook: assinatura, resposta rapida, idempotencia

Tres cuidados, nesta ordem:

- **Assinatura HMAC.** Sem conferir, qualquer um que descubra a URL cria
  pagamento fantasma e ganha atendimento de graca. A comparacao e de tempo
  constante, e notificacao com timestamp velho e recusada (protege contra
  reenvio de uma capturada no passado).
- **Responder 2xx rapido.** O provedor reenvia em intervalos crescentes
  ate receber 2xx - e reenviar significa processar de novo.
- **Idempotencia.** A mesma notificacao chega varias vezes. O
  processamento compara o estado atual antes de agir; se ja esta aplicado,
  nao faz nada e nao gera auditoria duplicada.

### 5. Nao tocamos em dado de cartao

O navegador tokeniza direto com o provedor e a API recebe so o token.
Numero de cartao nunca passa pelo nosso servidor nem entra no nosso log -
e o que mantem a plataforma fora do escopo pesado do PCI DSS.

Cartao usa PRE-AUTORIZACAO: o valor e reservado na emissao e capturado
depois. Assim nao se cobra por consulta em que o medico faltou.

### 6. Enquanto o paciente paga, o horario fica reservado

A consulta nasce em `aguardando_pagamento`, e esse estado entrou na trava
de exclusao junto com `agendada`. Sem isso o paciente pagaria e
descobriria que perdeu o horario - o pior erro possivel numa agenda.

A reserva tem prazo obrigatorio (o banco recusa reserva sem prazo). Vencida,
ela nao ocupa mais horario, e o pagamento recusado ou expirado cancela a
consulta liberando a vaga.

### 7. Valores em centavos, comissao arredondada para baixo

Tudo inteiro, sempre. E a comissao arredonda PARA BAIXO: na duvida sobre um
centavo, ele fica com a clinica. Alem de ser a escolha justa, garante que a
soma das partes nunca passe do total - o que o banco recusaria.

A comissao e congelada no momento em que o preco e definido: mudar a
comissao depois nao pode alterar retroativamente o que ja foi combinado.

### 8. O paciente ve o preco; nao ve a comissao

Quanto a plataforma retem e assunto entre ela e a clinica. A rota de
precos nao devolve esse campo para quem nao e administracao.

### 9. Autocadastro do paciente numa clinica

Faltava a porta mais comum: a pessoa que chega pelo site da clinica ou pelo
QR Code da recepcao. `POST /clinicas/:slug/entrar` resolve - e concede
APENAS o papel de paciente. Medico e recepcao continuam entrando so por
convite da administracao; senao qualquer pessoa se cadastraria como medica
da clinica.

## Consequencias

- Positivas: a plataforma nao movimenta dinheiro de terceiros, entao nao
  precisa de licenca; o dado de cartao nunca a toca; um webhook forjado
  nao libera atendimento.
- Negativas: cada clinica precisa conectar uma conta antes de cobrar, e
  reconecta-la a cada seis meses. E atrito real de operacao - por isso o
  aviso antecipado.
- Pendente: a politica de reembolso (quanto se devolve conforme a
  antecedencia do cancelamento) esta modelada no banco mas ainda nao tem
  regra automatica; hoje o estorno e manual. Entra junto com a
  administracao da clinica.
