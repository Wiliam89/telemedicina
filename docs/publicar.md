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
| `VIDEO_PROVEDOR` | `local_teste` |
| `PERMITIR_VIDEO_SIMULADO` | `sim` — ver o aviso abaixo |
| `EMAIL_PROVEDOR` | `console` (só central) ou `resend` — ver ADR-0019 |
| `EMAIL_API_KEY` / `EMAIL_REMETENTE` | só com `resend` |
| `NOME_PLATAFORMA` | o nome que aparece nos e-mails |
| `DB_POOL_MAX` | `10` por instância (ADR-0020) |
| `LIMITE_POR_MINUTO` | `600` |
| `PROXIES_CONFIAVEIS` | so depois de medir no log "medicao de proxies" (ADR-0021) |
| `SEGREDO_SITE_API` | o mesmo valor na Vercel; gere um segredo longo |
| `ASSINATURA_HOSTS_PERMITIDOS` | so se clinicas usarem provedor proprio de assinatura |

> **Health check (ADR-0020):** em *Settings > Health Check Path* do Render,
> use `/pronto`. Ele responde 503 quando o banco não responde, e o Render
> não manda tráfego para a instância.

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

> **Sobre `PERMITIR_VIDEO_SIMULADO=sim`** (Módulo 12)
>
> Pelo mesmo motivo: a API se recusa a subir em produção com o provedor de
> vídeo simulado, porque ele **não faz videochamada nenhuma**. Esta variável
> declara que aqui é demonstração. A própria sala avisa na tela, no lugar da
> imagem, que não há vídeo — ninguém fica esperando uma câmera que não vai
> abrir.
>
> Para ter vídeo de verdade: crie uma conta em
> [dashboard.daily.co](https://dashboard.daily.co), clique em **Developers**
> no menu da esquerda, copie a **API key**, e no Render troque por
> `VIDEO_PROVEDOR=daily` + `VIDEO_API_KEY=<a chave>`, **removendo**
> `PERMITIR_VIDEO_SIMULADO`. O plano gratuito do Daily dá minutos por mês,
> suficientes para testar.

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
| `SEGREDO_SITE_API` | o mesmo valor do Render. **Sem** `NEXT_PUBLIC_`: nunca vai para o navegador |
| `NEXT_PUBLIC_NOME_PLATAFORMA` | o nome da sua plataforma |
| `NEXT_PUBLIC_EMPRESA_RAZAO_SOCIAL`, `NEXT_PUBLIC_EMPRESA_CNPJ`, `NEXT_PUBLIC_EMPRESA_ENDERECO` | aparecem nos Termos e na Política |
| `NEXT_PUBLIC_ENCARREGADO_NOME`, `NEXT_PUBLIC_ENCARREGADO_EMAIL` | o encarregado de dados (DPO) — LGPD art. 41 |

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

- conta de vídeo, e-mail e recebimento configurados
- banco de dados separado do ambiente de desenvolvimento
- backup testado e a guarda de 20 anos do prontuário
- assinatura com valor legal (certificado e conferência da cadeia ICP-Brasil, ADR-0021)
- segundo fator de autenticação para quem lê dado clínico
- revisão jurídica dos Termos, da Política e da transferência internacional

## Detalhes que economizam tempo

**O plano gratuito do Render hiberna.** Depois de 15 minutos sem
requisição, o serviço dorme e a primeira chamada seguinte demora ~30
segundos. Para demonstração ao vivo, abra `/saude` alguns minutos antes.

**Migrações não rodam sozinhas.** Ao entregar um módulo novo, aponte o
`DATABASE_URL` da sua máquina para o Supabase publicado e rode
`pnpm db:migrar` antes do push, confirmando com `CONFIRMAR_BANCO_REMOTO=sim`.
Automatizar isso entra no Módulo 18.

## E-mail de confirmação de cadastro e de recuperação de senha

Sintoma conhecido: "às vezes o e-mail de confirmação não chega, ou chega e a
página não carrega". O código já foi corrigido (o cadastro informa o endereço
de retorno, oferece reenvio, e link vencido leva a uma tela que explica). O
restante é configuração no **painel do Supabase**, e precisa ser feito uma vez:

1. **Authentication > URL Configuration**
   - *Site URL*: o endereço publicado do site (`https://SEU-SITE`), nunca
     `http://localhost:3000`. Se ficar localhost, o link do e-mail abre uma
     página que não carrega.
   - *Redirect URLs*: inclua `https://SEU-SITE/auth/confirmar` e
     `https://SEU-SITE/**` (e, para testar na máquina, `http://localhost:3000/**`).
     Endereço fora da lista é trocado pelo Site URL.
2. **Authentication > SMTP Settings: configure um SMTP próprio.** O SMTP
   embutido do Supabase só entrega para os e-mails da equipe do projeto e tem
   limite de poucos envios por hora: é a causa de "às vezes não chega". Opção
   sem custo para começar: **Resend** (3.000 e-mails/mês grátis, exige domínio
   verificado), em `smtp.resend.com`, porta 465, usuário `resend`, senha = a
   API key. O mesmo domínio pode servir aos avisos da plataforma (`EMAIL_*`).
3. **Authentication > Email Templates > Confirm signup** (recomendado). Troque
   o link do modelo por:

   ```html
   <a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email&proximo=/completar-perfil">Confirmar meu e-mail</a>
   ```

   E em **Reset Password**:

   ```html
   <a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery&proximo=/redefinir-senha">Criar nova senha</a>
   ```

   Com esse modelo a confirmação funciona em **qualquer aparelho** (abrir o
   e-mail no celular depois de se cadastrar no computador) e não é "gasta"
   por leitores de e-mail que abrem links sozinhos: a conta só é confirmada
   quando a pessoa toca no botão da tela `/confirmar-email`.

Sem o passo 3, o link padrão continua funcionando, mas só abre a sessão no
mesmo navegador do cadastro; em outro aparelho a pessoa vê "e-mail confirmado,
entre com sua senha".

## Ordem de publicação desta versão (migrações 0026 a 0029)

O deploy não é atômico: por alguns minutos, a API antiga roda sobre o banco novo.
As quatro migrações só acrescentam (colunas, tabelas, políticas), então a API
antiga continua funcionando com o banco novo. O contrário quebra: a API nova
grava colunas que o banco antigo não tem. **Banco primeiro, push depois.**

O passo a passo com palavras simples está em `docs/o-que-voce-precisa-fazer.md`.

1. Rode a migração no banco publicado (`CONFIRMAR_BANCO_REMOTO=sim pnpm db:migrar`) e `pnpm db:verificar-rls` (esperado: 58 políticas). Confira em `/saude` da API: `migracoesAplicadas` deve ser 30.
2. Publique a **API** (Render) com as variáveis novas e espere o `/pronto` responder.
3. Só então publique o **site** (Vercel).
4. **Não** cadastre preço por especialidade nem deixe paciente entrar na fila com cartão antes do passo 2 terminar: a API antiga não entende esses dois dados novos.

## Plataforma como clínica única (ADR-0022)

Na API (Render):

| Variável | Valor |
| --- | --- |
| `PLATAFORMA_SLUG` | o endereço interno da clínica que é a plataforma (ex.: `telesaude`) |
| `PLATAFORMA_ADMIN_EMAILS` | e-mails de quem pode fazer a configuração inicial, separados por vírgula. **Obrigatório em produção** |
| `IDENTIDADE_PROVEDOR` | `manual` (padrão, sem custo) ou `externo` |
| `PAGAMENTO_PROVEDOR`, `PAGAMENTO_ACCESS_TOKEN`, `PAGAMENTO_CHAVE_PUBLICA` | a conta de recebimento da plataforma (ADR-0023) |

Depois do deploy, entre com um dos e-mails de administração: a primeira tela é
a configuração inicial (razão social e CNPJ). A partir daí todo cadastro novo
já é paciente da plataforma. Se o banco já tinha uma clínica, use o `slug` dela
em `PLATAFORMA_SLUG`: pacientes e equipe dela continuam onde estão, e quem tinha
conta em outra clínica passa a ser paciente desta no próximo acesso.

**Webhook de pagamento.** Com a API publicada, o `URL_PUBLICA_API` já é
alcançável da internet — não precisa mais de túnel.
