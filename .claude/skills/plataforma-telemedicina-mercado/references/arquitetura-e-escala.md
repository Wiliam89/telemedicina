# Arquitetura compatível com evolução e grande escala

## Arquitetura atual (manter)

Monólito modular: site Next.js e API Fastify separados, com Postgres no Supabase e provedores trocáveis (vídeo, assinatura, pagamento, e-mail). É a escolha certa para este estágio. **Não proponha microsserviços** sem um gargalo medido.

Multi-clínica: `clinica_id` em cada tabela, verificação na API e RLS como segunda tranca.

## Caminho de evolução por gatilho

Só avance quando o gatilho for medido.

| Gatilho | Passo | Custo aproximado |
|---|---|---|
| Primeiro paciente real | Projeto Supabase separado, API sem hibernar, backup testado, monitoramento | A partir de US$ 25 a 32 por mês (conferir preços) |
| Mais de uma cópia da API | Transaction pooler, `instancias x DB_POOL_MAX` dentro do limite | Conforme plano |
| Limite de requisições inconsistente | Redis no `@fastify/rate-limit` | Plano gratuito pode bastar |
| Agendador pesa nas requisições | Processo separado para tarefas (fila com `SKIP LOCKED` no próprio Postgres) | Baixo |
| Consulta lenta | `EXPLAIN ANALYZE`, índice, paginação por cursor | Nenhum |
| Leitura pesa sobre o banco | Réplica de leitura para indicadores | Conforme plano |
| Auditoria e notificações muito grandes | Particionar por mês | Nenhum |
| Eventos entre módulos | Tabela de outbox antes de considerar mensageria | Nenhum |
| Integração externa | FHIR e RNDS atrás de um adaptador, igual aos provedores | Depende |

## Regras de escala

- **API sem estado.** Nada em memória que precise sobreviver a uma requisição.
- **Tarefas agendadas seguras em várias cópias.** Use chave única, `FOR UPDATE SKIP LOCKED` e atualização condicional.
- **Hibernação quebra agendamento.** `setInterval` não roda com o processo dormindo; lembrete atrasa sem hospedagem contínua ou chamada periódica externa.
- **Toda lista tem limite.** Prefira cursor para histórico longo.
- **Toda chamada externa tem tempo limite** e erro tratado.
- **O tempo limite do site precisa ser maior que o do provedor** em operações de escrita. Se não for, a pessoa vê erro em algo que deu certo e tenta de novo.
- **Idempotência em toda operação com efeito externo** (cobrança, sala, assinatura, e-mail).
- **Webhook:** confira a assinatura, responda rápido, aplique de forma idempotente e confirme o estado no provedor. Tenha conciliação periódica para aviso perdido.
- **Regra de disputa fica no banco:** restrição de exclusão, índice único, atualização condicional.

## Implantação sem queda

- Site e API publicam em momentos diferentes, então a API precisa aceitar a versão anterior do site.
- Banco: expandir, migrar dados, trocar o código e só depois contrair.
- Health check em `/pronto`, desligamento gracioso em `SIGTERM` (já existem).
- Migração antes do código que depende dela.

## Residência de dados

Para dado de saúde, registre onde cada etapa acontece, e não apenas onde o banco está:

| Etapa | Serviço | Região a conferir |
|---|---|---|
| Banco, autenticação, arquivos | Supabase | São Paulo |
| Renderização do site | Vercel Functions | Hoje `iad1`. Só mudar para `gru1` depois de medir: a página chama a API a cada carregamento, e a API não está no Brasil |
| API | Render | Render não oferece região no Brasil; conferir no painel |
| Vídeo | Daily | Conferir a região da sala e o contrato |

Se o processamento ocorre fora do Brasil, a política de privacidade precisa dizer isso (LGPD arts. 33 a 36). Avaliar hospedar a API no Brasil é decisão do Wiliam.

## Observabilidade mínima

Logs JSON com `x-request-id` (já existem), erros com pilha (o Pino só serializa a pilha na chave `err`), captura de erros (Sentry tem plano gratuito), monitor externo de `/pronto` com alerta, painel do banco e métricas de negócio (taxa de falha ao entrar na sala, pagamentos pendentes).
