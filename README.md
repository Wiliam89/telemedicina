# Plataforma de Telemedicina

Monorepo: Next.js (site) + Fastify (API) + Supabase (banco, auth, arquivos).
Acompanha o curso "Plataforma de Telemedicina"; este estado corresponde ao
fim do **Modulo 12** (videochamada da consulta: sala por consulta, token de
entrada por pessoa, sem gravacao).

## Primeira vez na maquina

```bash
pnpm install            # instala as dependencias de todos os pacotes
pnpm configurar         # cria apps/api/.env e apps/web/.env.local
# abra os dois arquivos e preencha - cada linha diz onde clicar no Supabase
pnpm verificar          # aponta o que ainda falta (e onde pegar)
pnpm db:testar-conexao  # o banco responde?
pnpm db:migrar          # cria as tabelas (aplica packages/db/drizzle/*.sql)
pnpm dev                # site em http://localhost:3000, API em http://localhost:3333/saude
```

## Site (Modulo 5)

| Tela                       | Login | O que faz                                          |
| -------------------------- | ----- | -------------------------------------------------- |
| `/`                        | nao   | capa; logado vai para /clinicas                    |
| `/criar-conta`, `/entrar`  | nao   | conta e sessao (Supabase Auth)                     |
| `/completar-perfil`        | sim   | dados da pessoa -> `POST /perfis`                  |
| `/clinicas`                | sim   | escolher clinica (uma so: entra direto)            |
| `/clinicas/nova`           | sim   | abrir uma clinica                                  |
| `/convite/<codigo>`        | sim   | aceitar convite                                    |
| `/c/<clinica>/inicio`      | vinculo | meu perfil e os medicos daquela clinica          |
| `/c/<clinica>/agenda`      | vinculo | consultas do periodo, com acoes por papel        |
| `/c/<clinica>/marcar`      | paciente/recepcao | escolher medico, dia e horario         |
| `/c/<clinica>/grade`       | medico | grade semanal de atendimento                    |
| `/c/<clinica>/atendimento/<consulta>` | medico | video + prontuario SOAP + documentos  |
| `/c/<clinica>/documentos`  | vinculo | documentos recebidos ou emitidos                 |
| `/c/<clinica>/pagamento/<consulta>` | paciente | pagar com Pix, com QR e copia e cola  |
| `/c/<clinica>/precos`      | admin | valores da clinica                                 |
| `/entrar-na-clinica/<slug>`| semi-publica | porta de entrada do paciente                |
| `/c/<clinica>/pronto-atendimento` | paciente | queixa, termo, pagamento e sala de espera |
| `/c/<clinica>/plantao`     | equipe | escala, fila e chamada do proximo                 |
| `/c/<clinica>/consulta/<consulta>` | paciente | a sala de video do paciente              |
| `/validar`                 | **publica** | conferir um documento pelo codigo            |
| `/c/<clinica>/equipe`      | admin | membros e convites                                 |
| `/c/<clinica>/diagnostico` | vinculo | o painel de luzes                                |

Sessao em cookie, renovada pelo middleware (ADR-0007). O site nunca escreve
no banco: toda gravacao passa pela API.

## Banco de dados (Modulo 3)

```bash
pnpm db:gerar              # schema mudou? gera o proximo .sql em packages/db/drizzle/
pnpm db:migrar             # aplica o que ainda nao foi aplicado
pnpm db:verificar-tabelas  # o banco esta como o codigo espera?
pnpm db:verificar-rls      # RLS ligado, politicas presentes, auditoria protegida?
pnpm db:verificar-clinicas # toda clinica tem admin? toda consulta tem clinica?
pnpm db:verificar-agenda   # travas de exclusao ativas? cancelamentos completos?
pnpm db:verificar-prontuario # gatilhos de imutabilidade? numeracao sem repeticao?
pnpm db:verificar-assinatura # assinados com arquivo e hash? certificado do proprio medico?
pnpm db:verificar-pagamento  # split fecha? reserva presa? token do provedor vencendo?
pnpm db:verificar-fila       # consentimento registrado? pagamento confirmado? alguem esquecido?
pnpm db:studio             # painel local para olhar as tabelas
```

## API (Modulo 4)

Login = `Authorization: Bearer <token do Supabase Auth>`.
Rotas de dentro de uma clinica exigem tambem `X-Clinica: <endereco>`.

| Rota                        | Exige            | O que faz                                  |
| --------------------------- | ---------------- | ------------------------------------------ |
| `GET /saude`                | -                | as cinco luzes                             |
| `POST /perfis`              | login            | cria o perfil da PESSOA (+ auditoria)      |
| `GET /perfis/eu`            | login            | perfil + clinicas onde tenho vinculo       |
| `POST /clinicas`            | login            | cria clinica; quem cria administra         |
| `POST /convites/aceitar`    | login            | entra numa clinica pelo codigo             |
| `GET /clinicas/atual`       | vinculo          | dados da clinica atual                     |
| `GET /medicos`              | vinculo          | medicos desta clinica                      |
| `GET /membros`              | equipe           | quem trabalha nesta clinica                |
| `POST /convites`            | admin_clinica    | convida alguem (devolve o link)            |
| `GET /convites`             | admin_clinica    | convites pendentes                         |
| `POST /convites/:id/revogar`| admin_clinica    | cancela um convite                         |
| `GET/PUT /disponibilidades` | vinculo / medico | grade semanal do medico naquela clinica    |
| `GET/POST /bloqueios`       | equipe / medico  | periodos sem atendimento (ferias)          |
| `GET /horarios`             | vinculo          | horarios livres de um medico num dia        |
| `POST /consultas`           | vinculo          | marcar (paciente para si, equipe por alguem)|
| `GET /consultas`            | vinculo          | agenda do periodo                          |
| `POST /consultas/:id/cancelar` | envolvidos    | cancelar com motivo (+ auditoria)          |
| `POST /consultas/:id/status`| medico da consulta | iniciar / concluir                       |
| `PATCH /clinicas/atual`     | admin_clinica    | trocar o fuso horario da clinica           |
| `POST /consultas/:id/evolucao` | medico da consulta | abre o rascunho do prontuario        |
| `PATCH /evolucoes/:id`      | autor            | edita o rascunho                           |
| `POST /evolucoes/:id/finalizar` | autor        | finaliza: a partir daqui, imutavel         |
| `POST /evolucoes/:id/adendo`| autor            | corrige sem apagar nada                    |
| `GET /pacientes/:id/prontuario` | medico que atende | historico (gera auditoria)            |
| `POST /documentos`          | medico da consulta | emite receita, atestado, pedido de exame |
| `GET /documentos`           | vinculo          | os meus / os que emiti                     |
| `POST /documentos/:id/cancelar` | quem emitiu  | cancela com motivo                         |
| `POST /documentos/:id/assinar` | quem emitiu  | assina com certificado em nuvem (CPF + OTP) |
| `GET /documentos/:id/pdf`   | quem emitiu      | PDF para assinar fora da plataforma        |
| `POST /documentos/:id/assinatura-externa` | quem emitiu | recebe o PDF assinado fora e confere (ADR-0017) |
| `GET /documentos/:id/arquivo`  | paciente ou medico | link temporario do PDF assinado      |
| `PUT /clinicas/atual/assinatura` | admin_clinica | credenciais proprias no provedor (segredo cifrado) |
| `GET /clinicas/atual/assinatura` | admin_clinica | diz apenas SE ha credencial propria    |
| `GET/PUT /precos`           | vinculo / admin  | valores da clinica                          |
| `POST /consultas/:id/pagamento` | paciente ou recepcao | cria a cobranca (Pix ou cartao)     |
| `GET /pagamentos/:id`       | pagador ou admin | estado atual do pagamento                   |
| `POST /webhooks/pagamento`  | **provedor**     | confirmacao (assinada e idempotente)        |
| `POST /clinicas/:slug/entrar` | login          | autocadastro do paciente na clinica         |
| `GET /clinicas/:slug/publico` | **publica**    | nome da clinica, para a pagina de entrada   |
| `POST /plantoes`            | medico           | escalar-se para plantao                     |
| `POST /plantoes/:id/abrir`  | medico           | abrir: passa a receber da fila              |
| `POST /plantoes/:id/encerrar` | medico         | encerrar (recusa com atendimento em curso)  |
| `GET /plantoes`             | equipe           | a escala da clinica                         |
| `POST /pagamentos/pronto-atendimento` | paciente | cobranca avulsa da fila                  |
| `POST /fila`                | paciente         | entrar (exige pagamento + consentimento)    |
| `GET /fila`                 | vinculo          | minha posicao / a fila (equipe)             |
| `POST /fila/proximo`        | medico de plantao | chama o proximo (SKIP LOCKED)              |
| `POST /fila/:id/desistir`   | paciente ou recepcao | sair da fila                            |
| `POST /consultas/:id/sala`  | **so os dois da consulta** | entra: devolve o token de entrada |
| `GET /consultas/:id/sala`   | **so os dois da consulta** | a sala esta aberta? (sem token)   |
| `POST /consultas/:id/sala/encerrar` | medico da consulta | fecha a sala e conclui        |
| `GET /validar/:codigo`      | **publica**      | confere autenticidade sem login            |
| `POST /clinicas/atual/status` | admin_clinica  | abre (ativa) ou fecha a clinica para pacientes |
| `GET /crm/verificacoes`     | admin_clinica    | medicos da clinica, situacao do CRM e historico |
| `PATCH /perfis/eu`          | login            | corrige nome e telefone (LGPD art. 18, III) |
| `GET /notificacoes`         | login            | central de avisos (50 recentes + nao lidas) |
| `POST /notificacoes/:id/lida`, `POST /notificacoes/lidas` | login | marca como lida(s) |
| `GET /indicadores?dias=30`  | admin_clinica    | indicadores do periodo (so numeros)        |
| `GET/POST /lgpd/consentimentos` | login        | historico / aceite da versao atual         |
| `POST /lgpd/consentimentos/revogar` | login    | revoga um consentimento                    |
| `GET /lgpd/meus-dados`      | login            | copia de tudo em JSON (acesso e portabilidade) |
| `GET /lgpd/acessos`         | login            | quem acessou meus dados                    |
| `GET/POST /lgpd/solicitacoes` | login          | pedidos do titular (prazo de 15 dias)      |
| `GET /lgpd/solicitacoes-da-clinica` | admin_clinica | pedidos dirigidos a clinica          |
| `POST /lgpd/solicitacoes/:id/responder` | admin_clinica | responde ao titular              |
| `POST /medicos/:id/crm`     | admin_clinica    | registra a conferencia no CFM (verificado/recusado) |
| `GET /pacientes`            | equipe           | lista com busca (nome/CPF) e `meus=1`      |
| `GET /pacientes/:id`        | vinculo          | cadastro + `acessoClinico`                 |
| `GET/POST /pacientes/:id/ficha` | quem atende / proprio | ficha clinica (cada POST = nova versao) |
| `GET/POST /pacientes/:id/sinais` | quem atende / proprio | sinais vitais (paciente informa os de casa) |
| `GET/POST /pacientes/:id/anexos` | quem atende / proprio | exames e laudos (PDF/imagem, 15 MB) |
| `GET /anexos/:id/arquivo`   | quem atende / proprio | link temporario (auditado)            |
| `GET /pacientes/:id/linha-do-tempo` | quem atende / proprio | tudo junto, do mais recente ao mais antigo |

Nas tres rotas da sala, "os dois da consulta" e literal: o paciente e o medico
daquela consulta, e mais ninguem - nem a recepcao, nem a administracao da
clinica. E a unica regra de acesso da plataforma que nao olha o papel na
clinica (ADR-0014).

Sem conta de video configurada, o projeto roda inteiro com
`VIDEO_PROVEDOR=local_teste`: a sala abre e avisa na tela que nao ha
videochamada neste ambiente. Para ter video de verdade, ver a secao 7 de
`apps/api/.env.example`.

Clinica de demonstracao com os quatro papeis, consultas, prontuario e graficos
(acessos em `demo-acessos.local.md`, fora do Git):

```bash
pnpm dev          # em um terminal
pnpm demo:criar   # em outro
```

Prova de ponta a ponta (cria usuarios e clinica, testa o isolamento, apaga tudo):

```bash
pnpm dev                 # em um terminal
pnpm api:testar-fluxo    # em outro
```

Regra (ADR-0004): tabela nao se cria clicando no painel do Supabase. Toda
mudanca e um arquivo em `packages/db/drizzle/`, gerado a partir de
`packages/db/src/schema/`.

## Qualidade

```bash
pnpm typecheck          # tipos nos 4 pacotes
pnpm test               # testes de unidade (os de banco sao pulados)
pnpm test:banco         # testes da API contra o Postgres de verdade (usa apps/api/.env)
```

## Onde fica cada coisa

| Pasta             | O que e                                                     |
| ----------------- | ----------------------------------------------------------- |
| `apps/web`        | Next.js - o que o paciente e o medico veem                  |
| `apps/api`        | Fastify - regras, seguranca, auditoria                      |
| `packages/shared` | tipos de resposta usados pelos dois lados                   |
| `packages/db`     | conexao, schema (`src/schema/`) e migracoes (`drizzle/`)    |
| `docs/`           | decisoes registradas (ADR) - prestacao de contas            |
| `scripts/`        | `configurar` e `verificar`                                  |

## Arquivos de segredo (nunca vao para o Git)

| Arquivo               | Conteudo                                  |
| --------------------- | ----------------------------------------- |
| `apps/api/.env`       | chave secreta do Supabase e URL do banco  |
| `apps/web/.env.local` | apenas valores publicos (`NEXT_PUBLIC_*`) |

Os modelos `.env.example` vao para o Git e ficam **sempre com os valores em branco**.
