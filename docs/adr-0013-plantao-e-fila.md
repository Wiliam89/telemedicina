# ADR-0013 - Plantao e fila: o segundo modo de atendimento

**Status:** aceita
**Data:** 2026-09-01
**Modulo do curso:** 11

## Contexto

Ate aqui a plataforma so agendava: o paciente escolhia dia, hora e
profissional. As plataformas de referencia operam DOIS modos - agendamento
com especialista e pronto atendimento por fila, 24 horas, para casos de
baixa complexidade. O segundo tem logica propria: nao ha agenda, ha
disponibilidade imediata.

## Decisao

### 1. Fila e agenda convivem, com estruturas separadas

`plantoes` e a escala de quem esta de prontidao; `disponibilidades`
(Modulo 7) continua sendo a grade de quem atende por agendamento. Um medico
pode fazer os dois, em clinicas diferentes ou na mesma.

A consulta que nasce de um atendimento de fila e uma `consulta` normal -
com prontuario, documentos e assinatura iguais. O que muda e a porta de
entrada, nao o atendimento.

### 2. O consentimento e etapa propria, com versao registrada

A CFM 2.314/2022 exige consentimento do paciente para o atendimento a
distancia, e as plataformas do setor o pedem entre o pagamento e a fila.

Guardamos QUANDO e sobre QUAL VERSAO do texto. Se o termo mudar, o que vale
para aquele atendimento e a versao que a pessoa leu - nao a atual. Um CHECK
no banco recusa alguem aguardando sem consentimento registrado.

O TEXTO vive em `@tele/shared/consentimento`, junto da versao: a tela mostra
exatamente o texto cuja versao a API registra. Se cada lado tivesse o seu,
o registro nao provaria nada.

### 3. O aviso de emergencia aparece em todas as etapas

Nao so no termo. Quem esta com dor no peito nao deve ler um formulario
inteiro para descobrir que devia ter ligado 192. E seguranca do paciente,
nao texto juridico.

### 4. Chamar o proximo usa SKIP LOCKED

Dois medicos clicando ao mesmo tempo nao podem pegar o mesmo paciente.
Conferir "quem e o proximo?" e depois marca-lo deixa uma janela entre as
duas coisas, e nessa janela cabe o outro medico.

`SELECT ... FOR UPDATE SKIP LOCKED` resolve: a primeira transacao tranca a
linha do proximo; a segunda, em vez de esperar, PULA a linha trancada e
pega a seguinte. Cada medico leva um paciente diferente, sem ninguem
esperar - que e melhor que uma fila de espera no banco.

E o mesmo raciocinio da trava de dupla marcacao (Modulo 7) com ferramenta
diferente: regra que duas requisicoes simultaneas podem quebrar vai para o
banco.

### 5. Ninguem entra na fila sem pagamento confirmado

`fila_atendimento.pagamento_id` e obrigatorio, e a rota confere que o
pagamento esta CONFIRMADO, e daquela pessoa, daquela clinica, e nao foi
usado antes. Pagamento pendente nao entra: quem paga por Pix espera a
confirmacao.

A cobranca do pronto atendimento nasce SOLTA, sem consulta - a consulta so
existe quando um medico chama. O pagamento passa a apontar para ela nesse
momento.

### 6. O paciente ve so a propria posicao

A equipe ve a lista com nomes e queixas; o paciente ve apenas em que
posicao esta, quantos medicos ha de plantao e uma estimativa de espera.
Queixa de outra pessoa e dado de saude.

A estimativa e simples e honesta: quantos estao na frente, divididos pelos
medicos de plantao, vezes a duracao presumida. A tela diz que e uma media.

### 7. Ninguem espera para sempre

Fila sem chamada por mais de duas horas expira. A rotina roda quando alguem
consulta a fila - o que funciona enquanto ha movimento, e por isso o
`pnpm verificar` avisa quando ha gente esperando ha muito tempo. Uma tarefa
agendada resolve isso melhor, e entra na producao (Modulo 18).

### 8. Desistencia registra pendencia de estorno

Sair da fila antes de ser chamado grava `pendenteDeEstorno` na auditoria. O
estorno automatico depende da politica de reembolso da clinica, que ainda
nao existe (ADR-0012) - mas o registro fica para ela agir.

### 9. Nao se encerra plantao com paciente em atendimento

Deixaria alguem no vacuo. A API recusa e diz o que fazer.

## Consequencias

- Positivas: a plataforma passa a ter o modo que as referencias do setor
  operam 24 horas; o consentimento fica provado, com versao; a chamada
  concorrente e correta por construcao.
- Negativas: mais um modo para operar e explicar. E a estimativa de espera
  e grosseira - melhora quando houver historico de duracao real dos
  atendimentos (Modulo 17, relatorios).
- Pendente: a triagem por gravidade existe como coluna (`prioridade`) mas
  ninguem a preenche - hoje todos entram como prioridade 3. Triagem de
  verdade (protocolo de Manchester) exige profissional treinado e e decisao
  de produto, nao de codigo.
