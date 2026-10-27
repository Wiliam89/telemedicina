# ADR-0019 - Notificacoes (central + e-mail) e indicadores da clinica

**Status:** aceita
**Data:** 2026-10-26

## Contexto

Plataformas de mercado lembram o paciente da consulta (o maior motivo de
falta e esquecimento), avisam quando a receita esta pronta e dao a gestao
da clinica um painel de numeros. A plataforma nao tinha nenhum desses.

## Decisao

### Notificacoes
- Tabela `notificacoes`: cada aviso aparece na central (o sino) e, se houver
  e-mail configurado, sai por e-mail.
- Eventos: consulta marcada (paciente e medico), consulta cancelada (quem nao
  cancelou), lembrete 24 h e 1 h antes (os dois), documento assinado
  (paciente), pedido LGPD respondido (titular), CRM verificado (medico).
- **Sem dado clinico no texto.** E-mail passa por servidores de terceiros:
  "sua receita esta disponivel", nunca o remedio; nunca o motivo da consulta.
- **Escala horizontal segura.** O agendador roda a cada minuto em cada
  instancia da API. Lembrete tem chave unica `(perfil, chave)` - entra uma
  vez so. O envio reserva as linhas com `FOR UPDATE SKIP LOCKED` - cada
  e-mail sai por uma instancia so. Ate 5 tentativas, com o erro guardado.
- Provedor de e-mail: `EMAIL_PROVEDOR=console` (padrao, nada sai - so log e
  central) ou `resend` (`EMAIL_API_KEY`, `EMAIL_REMETENTE` com dominio
  verificado). WhatsApp/SMS ficam para um provedor contratado, no mesmo
  ponto (`EnviadorDeEmail` vira `Enviador` por canal).

### Indicadores (`GET /indicadores?dias=7|30|90`, so administracao)
Consultas (concluidas, canceladas, taxa de cancelamento, por dia no fuso da
clinica, por medico), receita confirmada (bruta, liquida da clinica, ticket
medio), pronto atendimento (atendidos, desistencias, espera media), pacientes
(novos, atendidos) e documentos (taxa de assinatura). So numeros - nenhum
nome de paciente, nenhum dado clinico.
