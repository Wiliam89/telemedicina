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
  cobranca (art. 1, par. 1). Sintoma novo no retorno e consulta nova (par. 2).
  Tratamento prolongado: as reavaliacoes podem ser cobradas (art. 2).
- Por isso **quem libera e o medico**, consulta por consulta, com o prazo em
  dias (`consultas.retorno_ate`). A administracao so define o maximo
  (`clinicas.retorno_prazo_maximo_dias`, padrao 30, de 0 a 90; 0 desliga).
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
- Falta do medico gera pendencia de estorno (como no cancelamento).
- Falta do paciente nao gera estorno automatico e o cartao nao e debitado
  (so consulta concluida e cobrada). O Pix ja pago fica com a plataforma; a
  administracao devolve, se quiser, em Financeiro > Reembolsar.
  **Regra de negocio a confirmar pelo Wiliam.**

### Satisfacao (NPS)
- Depois da consulta concluida, por 30 dias, o paciente da uma nota de 0 a 10
  e, se quiser, um comentario curto. Uma por consulta; nao se altera
  (`avaliacoes_consulta` com gatilho). A auditoria guarda a nota, nao o texto.
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
