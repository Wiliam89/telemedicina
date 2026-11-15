# ADR-0026 - Area da administracao e repasse aos medicos

**Status:** aceita
**Data:** 2026-11-15

## Contexto

Com a plataforma sendo a propria clinica (ADR-0022), o paciente paga a
plataforma e o medico recebe uma porcentagem de cada consulta. A administracao
precisava de um lugar unico para gerir tudo: medicos e porcentagens, dinheiro,
credenciamentos, equipe, valores, LGPD, auditoria e configuracoes.

## Decisao

### Porcentagem do medico
- `clinicas.repasse_padrao_bps` (padrao) e `percentuais_medicos` (propria).
  Pontos-base: 7000 = 70% fica com o medico. Nulo = ainda nao definido.
- **Congelada na consulta** (`consultas.repasse_medico_bps`) quando ela nasce:
  ao marcar (agenda) ou ao aceitar (fila). Mudar a regra depois nao muda o que
  ja foi combinado. Consulta anterior a regra usa a do medico, depois a padrao.
- Ganho = `piso(valor confirmado x bps / 10000)`, so de consulta CONCLUIDA com
  pagamento CONFIRMADO. Cancelada, estornada ou ainda nao cobrada nao gera ganho.
  O calculo vive em um so lugar (`apps/api/src/repasse.ts`, em SQL).

### Repasse (o pagamento ao medico)
- O dinheiro sai POR FORA (Pix/TED da empresa). `repasses_medicos` registra que
  saiu: valor, data, referencia, quem registrou. Saldo = ganho total - pago.
- Nao se registra acima do saldo (trava por medico contra clique duplo).
- Registro nao se apaga nem se altera: so se cancela, uma vez, com motivo
  (gatilho `repasse_so_cancela`).
- Pagar o medico automaticamente pelo provedor (split) fica para depois: exige
  conta de recebimento do medico no provedor e e decisao de gasto.

### Area da administracao (`/c/<plataforma>/admin`)
- Painel: agora, 30 dias e pendencias (credenciamento, reembolso, cobranca
  recusada, LGPD, medico sem porcentagem, CRM vencendo), cada uma com link.
- Medicos: porcentagem, o que atende, ganho de 30 dias e saldo.
- Financeiro: receita, ganho dos medicos, margem, saldos, repasses registrados,
  cobrancas recusadas e **reembolso pelo provedor** (so de pagamento confirmado;
  a linha fica trancada durante a chamada, entao dois cliques reembolsam uma vez).
- Auditoria: quem fez o que e quando, filtrada por assunto, sem `detalhes`
  (alguns citam o paciente de uma leitura de prontuario).
- Configuracoes: nome, razao social, fuso, responsavel tecnico (medico ativo com
  CRM verificado) e porcentagem padrao. CNPJ nao se troca por aqui.
- O medico ve os proprios ganhos em `/meus-ganhos`.

## Consequencias
- Nada de prontuario, queixa ou motivo aparece para a administracao.
- Imposto, nota fiscal e contrato com o medico (PJ/autonomo) estao fora do
  sistema e precisam de contador e revisao juridica.
