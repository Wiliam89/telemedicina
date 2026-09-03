# ADR-0010 - Prontuario imutavel, documentos verificaveis e o dinheiro

**Status:** aceita
**Data:** 2026-09-01
**Modulo do curso:** 8

## Contexto

Ate aqui a plataforma agendava. A partir daqui ela PRODUZ: registro clinico
que vale como prova e documento que a farmacia, o RH e o laboratorio
aceitam. Isso muda o padrao de exigencia.

A Resolucao CFM 1.821/2007 exige que o sistema permita a uma pericia tirar
conclusoes sobre a validade do que foi registrado, e define autenticacao
individual, log de auditoria, criptografia, backup e controle por perfil,
com guarda de 20 anos. A certificacao SBIS/CFM organiza isso em niveis:
o NGS1 trata de acesso e autenticacao; o NGS2 exige assinatura digital
ICP-Brasil - e so ele dispensa o papel impresso e assinado.

Este modulo entrega tudo que o NGS2 pede menos a assinatura, que vem no
Modulo 9. A escolha e proposital: o modelo de documento tem de estar certo
ANTES de haver assinatura, porque assinar o artefato errado e pior que nao
assinar.

## Decisao

### 1. Prontuario finalizado e imutavel - no banco, nao no codigo

Enquanto e rascunho, o medico edita. Ao finalizar, gatilhos do Postgres
impedem UPDATE e DELETE. Gatilho vale para todo mundo: para a API com
chave secreta, para o administrador, para nos. Um registro que o fornecedor
do software pode reescrever nao serve de prova - nem para o medico, nem
contra ele.

### 2. Correcao se faz por adendo, nunca por rasura

Errou depois de finalizar? Escreve-se um adendo apontando para a evolucao
original, que permanece intacta. Adendo de adendo e recusado: todos apontam
para a original, senao a historia vira corrente e ninguem sabe qual e o
texto valido.

### 3. Documento emitido e imutavel; erro se cancela, nao se apaga

Conteudo, hash, numero, codigo e as partes envolvidas nunca mudam. As
unicas transicoes aceitas sao emitido -> assinado (Modulo 9) e
emitido/assinado -> cancelado com motivo. Cancelado nao volta atras.

### 4. Numeracao sequencial por clinica e ano, a prova de corrida

Como talonario: 1/2026, 2/2026. Dois medicos emitindo no mesmo segundo nao
podem receber o mesmo numero, entao a numeracao usa bloqueio consultivo
por clinica+ano, com indice unico como rede embaixo.

### 5. O hash e do texto canonico, montado em lugar unico

O texto que o paciente ve tem de ser byte a byte o texto cujo hash foi
guardado. Por isso a montagem vive em `@tele/shared`, com separadores,
ordem dos campos e quebras de linha definidos ali - e sempre `\n`, nunca
`\r\n`: o hash nao pode depender do sistema operacional.

### 6. A validacao publica prova autenticidade sem revelar clinica

`GET /validar/<codigo>` e a unica rota publica da plataforma. Devolve tipo,
numero, data, CRM do medico, clinica e as INICIAIS do paciente. Nunca o
conteudo. Quem tem o documento ja sabe o que esta escrito; quem nao tem nao
descobre ali. O codigo usa alfabeto sem 0/O e 1/I/L, porque ele e digitado
a partir do papel.

### 7. Recepcao e administracao nao leem prontuario

Elas agendam, cobram e organizam. E o principio da necessidade (LGPD art.
6, III) virando politica de RLS. Toda leitura de prontuario gera auditoria,
mesmo sem alteracao: "quem abriu o prontuario de quem" e a primeira
pergunta de uma pericia.

### 8. O CID so entra no documento quando enviado

O art. 76 do Codigo de Etica Medica proibe revelar diagnostico em atestado
sem autorizacao do paciente. A tela pergunta; o campo so viaja se ele
autorizar.

### 9. Plantao, fila e pagamento nascem agora, com telas depois

Tres tabelas entram sem interface (Modulos 10 e 11 as usam): `plantoes`,
`fila_atendimento` e `pagamentos`. Motivo: `fila` referencia `pagamentos`,
e criar essas ligacoes depois exigiria migrar um banco com prontuario real
dentro - a migracao mais cara que existe.

Duas decisoes ja registradas nelas:

**Valor em centavos, inteiro.** Ponto flutuante em dinheiro vira
divergencia de centavos que ninguem consegue explicar.

**O split e do gateway, nao nosso.** Receber o valor cheio na conta da
plataforma e repassar depois caracteriza participacao em arranjo de
pagamento (Circular BACEN 3.682/2013) e exigiria licenca de Instituicao de
Pagamento. Guardamos quanto e de cada parte; quem divide e liquida e o
provedor. O estado do pagamento vem por webhook - "o usuario voltou para a
pagina de sucesso" nao e prova de pagamento.

## Consequencias

- Positivas: o prontuario resiste a pericia; o documento e conferivel por
  terceiros sem expor o paciente; o caminho para o NGS2 fica curto (falta
  so a assinatura).
- Negativas: nada se conserta "no banco" depois - toda correcao e adendo ou
  cancelamento, e isso muda o jeito de operar. E o preco de ter valor
  legal.
- Pendente para producao (Modulo 18): criptografia em repouso, backup com
  redundancia e a politica de guarda de 20 anos, que a CFM 1.821 exige e
  que hoje ainda nao temos.
