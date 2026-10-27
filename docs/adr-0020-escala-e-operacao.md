# ADR-0020 - Escala e operacao: varias instancias, sondas, limites e CI

**Status:** aceita
**Data:** 2026-10-26

## Contexto

Atender muitas clinicas ao mesmo tempo exige poder rodar VARIAS copias da
API atras de um balanceador, trocar versao sem derrubar atendimento e
descobrir rapido o que deu errado. Nada disso pode depender de uma copia
so (estado em memoria, tarefa agendada duplicada).

## Decisao

### A API e sem estado
- Sessao vem no token (Supabase Auth); nada fica guardado na memoria da
  instancia. Qualquer copia atende qualquer requisicao.
- O agendador de avisos roda em todas as copias sem duplicar nada (ADR-0019:
  chave unica + `FOR UPDATE SKIP LOCKED`).

### Banco
- Conexoes por instancia em `DB_POOL_MAX` (padrao 10). Com varias instancias,
  use o **Transaction pooler** do Supabase (porta 6543) - a conexao ja usa
  `prepare: false`, que e o que ele exige - e faca
  `instancias x DB_POOL_MAX` caber no limite do plano.
- Os testes de banco rodam um arquivo por vez (`--no-file-parallelism`): em
  paralelo, eles mesmos estouravam o limite do pooler - a mesma conta que
  vale para producao.

### Sondas e desligamento
- `GET /vivo` - o processo responde (nao toca o banco).
- `GET /pronto` - o banco responde em ate 2 s; senao 503 e o balanceador
  tira a instancia da roda. Use este como health check no Render/Kubernetes.
- `SIGTERM`: para de aceitar conexoes, termina as requisicoes em andamento,
  para o agendador e fecha o banco (limite de 15 s).

### Rastreabilidade
- Toda requisicao tem um id (`x-request-id`, recebido do balanceador ou
  gerado), presente em cada linha de log e devolvido no cabecalho.
- Logs em JSON (pino), sem token nem cookie (`redact`).

### Limites de requisicao
- Geral por IP: `LIMITE_POR_MINUTO` (padrao 600 - uma clinica inteira atras
  de um mesmo IP nao pode ser barrada).
- Rotas caras ou sensiveis tem limite proprio: envio de anexo, assinatura,
  exportacao LGPD, pedidos LGPD e a validacao publica de documento (contra
  quem tenta adivinhar codigos).
- O contador e por instancia. Para um limite global entre instancias, liga-se
  um Redis ao `@fastify/rate-limit` (opcao `redis`) - nao foi necessario
  ainda.

### Seguranca do site
X-Frame-Options, HSTS, CSP (`frame-ancestors 'none'`, `form-action 'self'`,
`object-src 'none'`), COOP e Permissions-Policy em todas as paginas.

### Entrega
- `apps/api/Dockerfile` (multi-estagio, usuario sem privilegio, HEALTHCHECK
  em /vivo). Escrito e revisado, mas NAO testado nesta maquina (sem Docker).
- `.github/workflows/ci.yml`: tipos, testes, compilacao da API e do site em
  todo push; testes de banco quando o segredo `DATABASE_URL_TESTE` (projeto
  Supabase so de testes) estiver configurado.
