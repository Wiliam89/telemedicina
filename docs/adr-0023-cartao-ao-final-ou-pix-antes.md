# ADR-0023 - Cartao cadastrado debitado ao final; sem cartao, Pix antes

**Status:** aceita
**Data:** 2026-11-14

## Contexto

O paciente pode, opcionalmente, cadastrar um cartao. Com cartao, o valor e
debitado quando a consulta termina. Sem cartao, o Pix aparece antes de a
consulta comecar.

## Decisao

- `cartoes_salvos`: identificador do cliente e do cartao NO PROVEDOR, bandeira,
  quatro ultimos digitos e validade. Nunca numero nem codigo de seguranca: o
  navegador tokeniza direto no provedor (MercadoPago.js com campos em iframe).
  `POST /cartoes` recusa qualquer coisa que pareca numero de cartao. Um cartao
  ativo por pessoa (indice unico). A autorizacao de cobranca e um texto
  versionado, gravado junto do cartao.
- Consulta ganha `forma_de_cobranca` (`antecipada` | `cartao_ao_final`),
  `cartao_id` e `valor_combinado_centavos`. Cobra-se o valor mostrado ao
  paciente quando ele marcou, nao o da tabela no dia.
- Com cartao: a consulta nasce `agendada` (ou entra na fila) sem pagamento. Sem
  cartao: nasce `aguardando_pagamento` com reserva de 20 min e Pix (fluxo antigo).
  O paciente com cartao pode escolher Pix numa consulta especifica.
- **Cobranca ao final** (`cobrarConsultasConcluidas`): roda logo depois do
  encerramento (sem segurar a resposta do medico) e no agendador a cada minuto.
  Tranca a consulta com `FOR UPDATE SKIP LOCKED`, grava o pagamento ANTES de
  chamar o provedor (chave de idempotencia) e nao retoma uma tentativa com menos
  de 90 s. Teste de disputa: cinco execucoes simultaneas, um debito.
- **Recusa**: vira pendencia. O paciente e avisado, paga por Pix (ou tenta o
  cartao de novo) em `/pagamento/<consulta>`, e nao marca nova consulta nem entra
  na fila enquanto deve (`402 PAGAMENTO_PENDENTE`). Nao ha retentativa automatica.
- Consulta cancelada nao e cobrada. Cartao com consulta por cobrar nao pode ser
  removido; trocar de cartao migra as consultas abertas para o novo.
- A plataforma e a clinica (ADR-0022): a conta de recebimento e uma so,
  configurada por `PAGAMENTO_PROVEDOR`/`PAGAMENTO_ACCESS_TOKEN`/`PAGAMENTO_CHAVE_PUBLICA`.
  Sem split: `application_fee` so e enviado quando ha comissao.

## Pontos a confirmar antes de producao
- **[CONFIRMAR COM O MERCADO PAGO]** Cobrar cartao salvo sem o codigo de
  seguranca (paciente ausente no fim da consulta) depende de habilitacao da
  conta. Sem ela o emissor recusa, e a plataforma cai no caminho da pendencia.
- Taxa por transacao do gateway e decisao de gasto.
- Politica de cancelamento e no-show (cobrar ou nao quem falta) e regra de
  negocio ainda nao definida: hoje, falta nao e cobrada.
