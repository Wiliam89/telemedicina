# ADR-0025 - Despacho do atendimento imediato: todos recebem, o primeiro aceita

**Status:** aceita
**Data:** 2026-11-14

## Contexto

Antes, o medico de plantao clicava "chamar o proximo" e pegava o primeiro da
fila. O pedido agora e o modelo de corrida de aplicativo: quando um paciente
entra na fila de ortopedia, TODOS os ortopedistas online sao alertados; quem
aceitar primeiro fica com ele, e o pedido some para os outros.

## Decisao

- "Online" = plantao aberto (a mesma tabela `plantoes`; a tela chama de
  "Ficar online").
- Ao entrar na fila, a API avisa (central de notificacoes, chave unica por
  pedido) todos os medicos online aptos. Sem ninguem online, avisa os aptos que
  poderiam ficar (ate 50). O aviso nao leva nome nem queixa.
- `GET /fila/chamados`: os pedidos que AQUELE medico pode atender. So para quem
  esta online (fora disso ele nao le queixa de ninguem). A tela pergunta a cada
  4 s, toca um alerta sonoro, atualiza o titulo da aba e, se permitido, mostra
  notificacao do sistema.
- `POST /fila/:id/aceitar`: `SELECT ... FOR UPDATE SKIP LOCKED` sobre a linha,
  com `status = 'aguardando'` e a aptidao do medico no mesmo comando. O primeiro
  tranca e cria a consulta; os demais nao esperam, nao encontram a linha e
  recebem `409 JA_ACEITO`. Teste: quatro aceites simultaneos, cinco rodadas, um
  vencedor por rodada, uma consulta.
- `POST /fila/proximo` continua existindo (aceita o mais antigo que o medico pode
  atender).
- O paciente ve a posicao entre quem espera pelo MESMO tipo de medico, e quantos
  medicos online podem atende-lo.

## Limites conhecidos
- Consulta periodica (4 s), nao conexao permanente: suficiente para o volume
  atual e sem custo. Para escala maior, trocar por Supabase Realtime ou
  server-sent events (ver arquitetura-e-escala).
- Alerta com a aba fechada depende de notificacao por push (Web Push, gratuito
  com chaves VAPID) - ainda nao implementado.
