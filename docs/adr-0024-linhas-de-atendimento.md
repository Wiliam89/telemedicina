# ADR-0024 - Duas linhas de atendimento: pronto atendimento e teleconsulta

**Status:** aceita
**Data:** 2026-11-14

## Decisao

|                    | imediato (fila)      | agendado            |
|--------------------|----------------------|---------------------|
| Pronto atendimento | clinico geral, agora | clinico geral, hora |
| Teleconsulta       | especialista, agora  | especialista, hora  |

- Especialidades: lista da Comissao Mista de Especialidades em
  `@tele/shared/atendimento`, com codigo estavel (sem acento). Conferir a
  resolucao vigente do CFM antes de mudar; nunca reaproveitar codigo.
- `medicos.especialidades` (conferidas no credenciamento) e
  `medicos.atende_pronto_atendimento`. O texto livre `especialidade` continua so
  para exibir. A regra unica de quem atende o que e `medicoAtende()`.
- Consulta e fila ganham `linha` e `especialidade` (trava no banco: teleconsulta
  sempre tem especialidade; pronto atendimento nunca).
- Precos: quatro tipos. Os dois nomes antigos (`agendada`, `pronto_atendimento`)
  foram mantidos para nao mexer em dado gravado; entram `teleconsulta_imediata` e
  `pronto_agendado`. Preco pode ser do medico (agendado), da especialidade
  (teleconsulta) ou o padrao; vale o mais especifico. A unicidade passou a
  `NULLS NOT DISTINCT` (o indice antigo deixava dois "padroes" do mesmo tipo).
- A vitrine (`GET /atendimento/opcoes`) so mostra especialidade com medico apto
  (CRM e especialidade conferidos), com quantos estao online e o valor.
- Pix pago para o pronto atendimento nao serve para a fila de um especialista
  mais caro.

## Compatibilidade
Consulta antiga fica `teleconsulta` (padrao); as que nasceram da fila foram
marcadas `pronto_atendimento` pela migracao. Medico antigo fica com
`atende_pronto_atendimento = true` e nenhuma especialidade: atende o pronto
atendimento como antes, e a administracao libera as especialidades em
`PUT /medicos/:id/atendimento`.
