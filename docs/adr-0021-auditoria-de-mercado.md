# ADR-0021 - Auditoria contra o padrao de mercado

**Status:** aceita
**Data:** 2026-10-31

## Contexto

Auditoria da plataforma publicada contra o que se espera de um produto
profissional de telemedicina, com a regra de mudar so o que tem evidencia de
estar fora do padrao, sem quebrar o resto.

## Decisoes

### Dado de saude
- Queixa da fila e motivo da consulta so para o medico e o paciente daquela
  consulta. A comparacao e com a pessoa, nao com o papel, porque a medica dona do
  consultorio tambem e administracao.
- Exportacao do titular passa a incluir pagamentos e pronto atendimento.

### Equipe
- `POST /membros/:id/suspender` e `/reativar`. Vale na hora, porque toda requisicao
  confere o vinculo. O ultimo administrador nao pode ser suspenso.
- Convite so e aceito pelo e-mail convidado. Isso so protege de verdade com
  "Confirm email" ligado no Supabase.

### Reserva e pagamento
- A trava de exclusao do banco conta toda consulta em `aguardando_pagamento`, entao
  a reserva vencida precisa ser cancelada de verdade: no agendador e antes de marcar.
- O Pix vale, no maximo, o tempo restante da reserva. Reserva vencida nao se paga.
- Pagamento tardio: se o horario continua livre, a consulta volta. Se nao, ou se
  alguem cancelou de proposito, fica registrada a pendencia de estorno e a clinica e
  avisada. **O estorno nao e automatico** (ADR-0012).
- Sem duplicidade: trava na linha da consulta (ou por paciente, no pronto
  atendimento) durante "conferir e gravar", com a chamada ao provedor fora da
  transacao. Sem resposta do provedor, o registro fica pendente e a nova tentativa
  usa a mesma chave de idempotencia. Os indices da migracao 0024 sao a ultima trava;
  o codigo funciona antes de ela ser aplicada.
- O estado do pagamento so muda nas transicoes permitidas, numa transacao.
- Sem conta de recebimento em producao: consulta agendada e confirmada sem cobranca,
  e o pronto atendimento fica indisponivel. Cartao fica recusado em producao ate
  existir a captura, para nao reservar valor que nunca seria cobrado nem devolvido.

### Acesso
- Recuperacao de senha por `/recuperar-senha`, `/auth/confirmar` e `/redefinir-senha`.
- `?depois=` passa por `destinoSeguro`, em todas as paginas que o usam.
- Sessao da equipe encerra apos 30 minutos sem uso, com aviso. Nao encerra durante
  videochamada, e o rascunho aberto e salvo antes.
- URL de provedor de assinatura da clinica: so https e so hosts autorizados, na rota
  e no resolvedor. Sem isso, um administrador colheria o codigo de uso unico do
  medico, ou faria a API chamar a rede interna.

### Operacao
- Testes de banco exigem `DATABASE_URL_TESTE` e recusam host remoto. `db:migrar`,
  `demo:criar` e `api:testar-fluxo` pedem confirmacao para host remoto.
- CI com Postgres descartavel, sem depender de segredo.
- `/saude` em producao nao lista tabelas.
- `PROXIES_CONFIAVEIS` e opcional e mantem o comportamento antigo ate ser medido: um
  numero errado faria todos parecerem o mesmo IP e barraria usuarios legitimos.
- `SEGREDO_SITE_API`: o site informa o IP de quem navega nas paginas geradas no
  servidor. Limite por usuario continua como melhoria futura.

### Regiao do site (nao adotada)
`gru1` na Vercel nao foi adotado. Os dados continuariam passando pela API fora do
Brasil, e pode piorar o tempo de resposta, porque cada pagina chama a API. Decidir
depois de medir. A Politica de Privacidade agora separa onde os dados sao guardados
de onde sao processados, e a transferencia internacional vai para revisao juridica.

### Zod 3
A falha alta conhecida exige o Zod 4 (versao principal nova). Mantido o 3.x: o limite
de 1 MB por requisicao restringe o ataque. A migracao fica como item proprio.

### Documento assinado pode ser cancelado
A regra do banco impedia: cancelar receita assinada dava erro 500 (migracao 0025
corrige). O documento cancelado continua registrando a assinatura, nao baixa mais e
aparece como cancelado na validacao publica. Arquivo assinado nunca e sobrescrito.

### Estorno
Pendencia registrada uma so vez por pagamento, com aviso a administracao e ao
paciente: consulta paga cancelada (inclusive a nascida da fila), desistencia ou
expiracao na fila, pagamento tardio sem horario, segundo pagamento da mesma consulta.
Estorno informado pelo provedor tira o paciente da fila e avisa a clinica; a consulta
ja marcada continua ate a clinica decidir.

## Limites conhecidos

- Nao ha tela listando as pendencias de estorno: a clinica tem o aviso no sino, e o
  registro fica na auditoria. Precisa existir antes de receber pagamentos de verdade.
- Medico suspenso com paciente em atendimento: a entrada da fila se resolve em ate 6 h.
- `/validar` avisa quando a cadeia ICP-Brasil nao foi conferida pela plataforma.

- Assinatura externa nao confere a cadeia ICP-Brasil nem compara o texto visivel com
  o documento: precisa ser resolvido **antes de paciente real**.
- Segundo fator de autenticacao, conexao com o Mercado Pago, captura de cartao,
  reembolso automatico e conciliacao periodica de pagamentos nao existem ainda.
- Recuperacao de senha nao foi testada com e-mail real: depende de SMTP no Supabase.
