# ADR-0027 - Retorno sem custo, faltas, satisfacao e gestao de pacientes

**Status:** aceita
**Data:** 2026-11-15

## Contexto

Faltavam, frente as plataformas de referencia (Doctoralia, Conexa, iClinic):
o retorno do paciente sem custo, o registro de falta, a nota do paciente
(NPS), a gestao de pacientes pela administracao e a planilha do financeiro
para a contabilidade.

## Decisao

### Retorno sem custo (Resolucao CFM 1.958/2010)
- A resolucao diz: quando os exames pedidos nao podem ser vistos na mesma
  consulta, o ato continua "com tempo determinado a criterio do medico", sem
  cobranca (art. 1, par. 1). Doenca distinta e outro ato (art. 1, par. 2).
  Sinais ou sintomas novos sao consulta nova (art. 2). Tratamento prolongado:
  as reavaliacoes podem ser cobradas (art. 3). Identificar essas hipoteses
  cabe so ao medico (art. 4). Segundo o CFM, a instituicao nao pode fixar
  prazo nem interferir nessa autonomia.
- Por isso **quem libera e quem decide o prazo e o medico**, consulta por
  consulta (`consultas.retorno_ate`), de 1 a 180 dias (teto tecnico, so
  contra erro de digitacao). A administracao so define o prazo **sugerido**
  que vale quando o medico nao digita outro
  (`clinicas.retorno_prazo_maximo_dias`, nome antigo da coluna; de 1 a 90,
  padrao 30). Nao ha como "desligar" o retorno.
- O medico pode liberar ate 90 dias depois da consulta (exames demoram).
- O paciente marca o retorno com o mesmo medico, ate a data-limite
  (`consultas.retorno_de`). O retorno nasce agendado, sem valor e sem
  pagamento; o banco recusa valor em retorno (`consultas_retorno_sem_custo`).
- Um retorno valido por consulta (indice `consultas_um_retorno`); cancelado,
  pode ser marcado de novo. Retorno nao tem retorno proprio.
- O retorno nao gera repasse: o ganho do medico vem do pagamento, e o retorno
  nao tem pagamento. Ele faz parte da consulta original, ja paga.
- Nao ha lei que obrigue um prazo fixo (os "30 dias" sao costume, nao norma).
  O prazo e decisao clinica; a plataforma registra quem liberou e quando.

### Falta
- Passados 15 minutos do horario, o **outro lado** registra a falta: o medico
  (ou a equipe) diz que o paciente faltou; o paciente (ou a equipe) diz que o
  medico faltou. A consulta e encerrada como cancelada, com `ausencia`.
- **Quem entrou na sala nao faltou:** a falta e recusada se a pessoa acusada
  tem `video.entrou` nesta consulta. E a entrada do medico na sala ja passa a
  consulta para `em_andamento`. A consulta e travada (`FOR UPDATE`) durante o
  registro, e "Iniciar" so muda o status se ninguem mudou antes (409, nao 500).
- Falta do medico gera pendencia de estorno (como no cancelamento).
- Falta do paciente nao gera estorno automatico e o cartao nao e debitado
  (so consulta concluida e cobrada). O Pix ja pago fica com a plataforma; a
  administracao devolve, se quiser, em Financeiro > Reembolsar.
  **Regra de negocio a confirmar pelo Wiliam.**
- **Decisao do Wiliam (2026-11-15):** consulta com cartao ao final NAO se
  conclui (nem pelo botao Concluir, nem ao encerrar a sala) se o paciente nunca
  entrou na sala: a API responde 409 PACIENTE_NAO_ENTROU e orienta a registrar
  a falta. Assim ninguem e cobrado por um atendimento que nao recebeu
  (`apps/api/src/presenca.ts`).

### Satisfacao (NPS)
- Depois da consulta concluida, por 30 dias, o paciente da uma nota de 0 a 10
  e, se quiser, um comentario curto. Uma por consulta; nao se altera
  (`avaliacoes_consulta` com gatilho). A auditoria guarda a nota, nao o texto.
- A nota individual e so do paciente: o medico nao a ve (evita retaliacao); a
  administracao ve o agregado e os comentarios sem nome.
- O paciente pode apagar o proprio comentario (LGPD, art. 18): e a unica
  mudanca que o gatilho aceita. Avaliacoes e restricoes entram na copia dos
  dados (`/lgpd/meus-dados`).
- A tela avisa para nao escrever dado de saude no comentario, porque ele vai
  para a administracao.

### Gestao de pacientes
- A administracao ve cadastro e numeros (CPF mascarado, telefone, consultas,
  faltas, pagamento pendente), **nunca** prontuario, queixa, receita ou motivo.
- Pode impedir um paciente de MARCAR e de entrar na FILA (`restricoes_pacientes`),
  sempre com motivo; a restricao so se encerra, nao se apaga. O paciente
  continua entrando para ver o que e dele e exercer os direitos da LGPD.

### Planilha para a contabilidade
- `GET /admin/financeiro/planilha?tipo=consultas|repasses`: CSV com ";" e
  virgula decimal (o Excel brasileiro abre direto), BOM para acentos, e
  protecao contra formula em celula (CWE-1236). Sem dado de paciente.
  Cada download vai para a auditoria.
- A planilha "consultas" parte do **dinheiro** (cada pagamento recebido ou
  devolvido no periodo), com a situacao da consulta: inclui consulta
  cancelada, com falta ou devolvida, para a receita bater com o banco. Acima
  de 20.000 linhas, pede um periodo menor em vez de cortar.
- A busca de pacientes (nome, CPF) vai no corpo de um POST, nunca na URL.

### O que a administracao NAO faz (e por que)
- Nao le nem altera prontuario, receita, atestado, laudo ou evolucao: sigilo
  medico (Codigo de Etica Medica, art. 73 e 85) e LGPD art. 11 (dado de saude).
- Nao muda o CNPJ pelo painel (documentos ja emitidos citam o anterior).
- Nao apaga auditoria, repasse, avaliacao ou restricao: so cancela/encerra.

## Publicacao
A migracao 0029 so acrescenta colunas e tabelas: a API anterior funciona com
o banco novo. Ordem: migracoes 0026 a 0029 no banco, depois o push na `main`.

## Proximos passos
- Lembrete automatico ao paciente quando o prazo do retorno estiver acabando.
- Converter o retorno em consulta nova cobrada quando ha queixa nova (hoje o
  medico orienta o paciente a marcar uma nova consulta).
- Taxa de nao comparecimento (cobrar a falta do paciente): regra de negocio e
  texto nos termos de uso, a decidir.
