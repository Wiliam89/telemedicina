# Publicar a plataforma (Vercel + Render)

Guia do deploy contínuo: cada `git push` na branch `main` atualiza o
ambiente publicado sozinho.

## A arquitetura do deploy

O projeto tem DUAS aplicações, e elas não vão para o mesmo lugar:

| Aplicação | Onde | Por quê |
|---|---|---|
| `apps/web` (site Next.js) | **Vercel** | É exatamente para isso que a Vercel existe. |
| `apps/api` (API Fastify) | **Render** (ou Railway, Fly.io) | É um servidor que fica ligado. A Vercel roda funções que sobem e descem a cada requisição — não serve para uma API com pool de conexões ao banco. |
| Banco e autenticação | **Supabase** | Já é onde está. |

Tentar colocar a API na Vercel é o erro mais comum aqui, e ele só aparece
depois: as conexões com o banco se multiplicam a cada invocação até estourar
o limite.

## Antes de começar

Crie um **projeto Supabase separado** para o ambiente publicado. Usar o
mesmo do desenvolvimento significa que qualquer teste seu na máquina mexe
no que está publicado — e vice-versa.

Região: **South America (São Paulo)**, como manda a ADR-0001.

Depois de criado, aponte o `DATABASE_URL` da sua máquina para ele
temporariamente e rode `pnpm db:migrar` uma vez, para criar o schema.

## Parte 1 — A API no Render

1. Acesse `render.com`, entre com a conta do GitHub e escolha
   **New > Web Service**.
2. Selecione o repositório `telemedicina`.
3. Preencha:
   - **Name**: `telemedicina-api`
   - **Region**: escolha a mais próxima do Brasil disponível
   - **Branch**: `main`
   - **Root Directory**: deixe **vazio** (a API precisa do monorepo inteiro)
   - **Runtime**: Node
   - **Build Command**: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @tele/api build`
   - **Start Command**: `node apps/api/dist/servidor.js`
4. Em **Environment**, adicione as variáveis da tabela abaixo.
5. **Create Web Service**. O primeiro deploy leva alguns minutos.
6. Anote a URL que o Render der (algo como
   `https://telemedicina-api.onrender.com`) — o site vai precisar dela.

### Variáveis da API

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (o Render usa esta) |
| `SUPABASE_URL` | do projeto Supabase novo |
| `SUPABASE_SECRET_KEY` | do projeto novo — Settings > API Keys > Secret keys |
| `DATABASE_URL` | do projeto novo, **Session pooler** (porta 5432) |
| `ORIGEM_PERMITIDA` | a URL do site na Vercel (preencha depois da Parte 2) |
| `URL_PUBLICA_API` | a própria URL do Render |
| `ASSINATURA_PROVEDOR` | `local_teste` |
| `PERMITIR_ASSINATURA_SEM_VALOR_LEGAL` | `sim` — ver o aviso abaixo |
| `CHAVE_CRIPTOGRAFIA` | gere: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PAGAMENTO_WEBHOOK_SEGREDO` | qualquer segredo longo, por enquanto |

> **Sobre `PERMITIR_ASSINATURA_SEM_VALOR_LEGAL=sim`**
>
> A API se recusa a subir em produção com o provedor de assinatura de
> teste, de propósito: documento assinado por ele **não tem valor legal**.
> Esta variável declara, explicitamente, que este é um ambiente de
> demonstração sem paciente real. Ela faz a API avisar no log a cada
> inicialização e o site exibir uma tarja.
>
> Quando houver certificado de verdade, troque por
> `ASSINATURA_PROVEDOR=birdid` com as credenciais e **remova** esta linha.

## Parte 2 — O site na Vercel

1. Acesse `vercel.com`, entre com a conta do GitHub e escolha
   **Add New > Project**.
2. Importe o repositório `telemedicina`.
3. Em **Configure Project**:
   - **Framework Preset**: Next.js (detectado sozinho)
   - **Root Directory**: clique em *Edit* e escolha **`apps/web`**
   - Deixe *Include files outside of the Root Directory* **ligado** — o
     site depende de `packages/shared`
   - **Build/Install Command**: deixe o padrão
4. Em **Environment Variables**, adicione as quatro da tabela abaixo.
5. **Deploy**.
6. Volte ao Render e preencha `ORIGEM_PERMITIDA` com a URL que a Vercel
   deu (`https://telemedicina-xxxx.vercel.app`). Sem isso o navegador
   bloqueia as chamadas — é o erro de CORS.

### Variáveis do site

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | do projeto Supabase novo |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | do projeto novo — Settings > API Keys > Publishable |
| `NEXT_PUBLIC_API_URL` | a URL do Render |
| `NEXT_PUBLIC_AMBIENTE` | `homologacao` |

## Parte 3 — Conferir

1. Abra `https://<sua-api>.onrender.com/saude`. Deve responder JSON com
   `"api":"no_ar"`, `"supabase":"conectado"` e
   `"documentosComValorLegal":false`.
2. Abra o site. A **tarja vermelha** deve aparecer no topo de todas as
   páginas.
3. Crie uma conta e uma clínica. Se der erro de conexão com a API, o
   problema é quase sempre `ORIGEM_PERMITIDA`.

A partir daqui, cada `git push` na `main` atualiza os dois sozinho.

## O que este ambiente NÃO é

Ele é bom para demonstrar, treinar e testar. **Não é produção**, e ainda
não deve receber paciente real, porque faltam:

- validação de CRM contra o CFM (Módulo 13) — hoje qualquer número passa
- os direitos do titular da LGPD funcionando (Módulo 15)
- backup com redundância e a guarda de 20 anos do prontuário (Módulo 18)
- assinatura com valor legal (depende do certificado)

## Detalhes que economizam tempo

**O plano gratuito do Render hiberna.** Depois de 15 minutos sem
requisição, o serviço dorme e a primeira chamada seguinte demora ~30
segundos. Para demonstração ao vivo, abra `/saude` alguns minutos antes.

**Migrações não rodam sozinhas.** Ao entregar um módulo novo, aponte o
`DATABASE_URL` da sua máquina para o Supabase publicado e rode
`pnpm db:migrar` antes do push. Automatizar isso entra no Módulo 18.

**Webhook de pagamento.** Com a API publicada, o `URL_PUBLICA_API` já é
alcançável da internet — não precisa mais de túnel.
