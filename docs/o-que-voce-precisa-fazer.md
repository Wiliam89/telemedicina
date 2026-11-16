# O que você precisa fazer para a versão nova ir para o ar

Este é o passo a passo para colocar online a área da administração, o retorno
sem custo, as faltas, a nota dos pacientes e a planilha do contador. Está
escrito com palavras simples, de propósito. Leva uns **20 minutos**.

## Por que tem uma ordem certa?

Pense no **banco de dados** como um **armário com gavetas**, e no **site** como
a pessoa que guarda as coisas nele.

A versão nova do site quer guardar coisas em **gavetas novas** (a porcentagem
do médico, o retorno, a nota do paciente...). Se a versão nova for para o ar
**antes** de as gavetas existirem, ela tenta abrir uma gaveta que não está lá,
e o site dá erro.

Por isso a ordem é sempre:

1. **Primeiro** criar as gavetas novas no armário (isso se chama **migração**).
2. **Depois** mandar a versão nova do site para o ar.

Hoje o banco publicado tem **26** das **30** gavetas. Faltam 4.

---

## Parte 0: deixar este computador enviar para o GitHub (2 minutos)

Quando eu tento enviar o código para o GitHub, o Windows abre uma janela
pedindo para você **entrar na sua conta do GitHub**. Da última vez ninguém
viu a janela, e o envio ficou parado esperando.

1. Me escreva: **"pode enviar as branches"**.
2. Fique de olho na tela: vai aparecer uma janela **"Connect to GitHub"**
   (às vezes atrás das outras; olhe a barra de tarefas lá embaixo).
3. Clique em **Sign in with your browser**.
4. No navegador, entre na conta **Wiliam89** e clique em **Authorize**.
5. Pronto: o Windows guarda a autorização e não pergunta de novo.

> Isso envia as branches de trabalho, **não** a `main`. O site publicado só
> muda na Parte 4.

---

## Parte 1: me dar o endereço do banco (5 minutos)

Eu consigo criar as gavetas sozinho, mas preciso do **endereço do banco**. É
uma linha comprida que começa com `postgresql://`. Ela tem uma senha dentro,
então ela **nunca** vai para o GitHub: fica só no seu computador.

O jeito mais seguro de pegar é copiar do Render, porque é exatamente o banco
que o site usa:

1. Abra **render.com** e entre na sua conta.
2. Clique no serviço da API (o que tem o endereço `telemedicina-4b3h.onrender.com`).
3. No menu da esquerda, clique em **Environment**.
4. Ache a linha **DATABASE_URL**. Clique no **olho** 👁 para mostrar o valor e
   depois no ícone de **copiar**.
5. No **VS Code**, abra o arquivo `telemedicina/apps/api/.env`.
6. Ache a linha que começa com `DATABASE_URL=` (é a linha 54).
7. Clique **logo depois do `=`** e cole (**Ctrl+V**). Fica assim:
   `DATABASE_URL=postgresql://postgres....` (tudo na mesma linha, sem espaço).
8. Aperte **Ctrl+S** para salvar. ⚠️ **Este é o passo que faltou da outra
   vez:** o arquivo estava preenchido na tela, mas não tinha sido salvo. Se a
   aba do arquivo mostra uma **bolinha branca** ● no nome, ele ainda não foi salvo.
9. Me escreva: **"salvei o .env"**.

Aí eu:

- confiro que é o banco certo (pelo nome do servidor, sem mostrar a senha);
- crio as 4 gavetas que faltam;
- confiro que as 57 regras de segurança estão no lugar.

> **Não tem o Render à mão?** No Supabase: abra o projeto, clique em
> **Connect** (no alto), escolha **Session pooler** e copie o endereço. Troque
> `[YOUR-PASSWORD]` pela senha do banco. **Não** clique em "Reset database
> password": isso troca a senha e o site publicado para de funcionar até você
> trocar no Render também.

---

## Parte 2: duas configurações no Render (5 minutos)

Elas dizem para a API que **a plataforma é a própria clínica** e **quem é o
administrador**.

1. No Render, no mesmo serviço da API, clique em **Environment**.
2. Clique em **Add Environment Variable** e crie estas duas:

| Nome (Key) | Valor (Value) |
| --- | --- |
| `PLATAFORMA_SLUG` | `telesaude` (ou o endereço da clínica que já existe; eu confiro no banco e te digo qual usar) |
| `PLATAFORMA_ADMIN_EMAILS` | o seu e-mail de login. Para mais de um, separe por vírgula |

3. Clique em **Save Changes**. O Render reinicia a API sozinho (uns 3 minutos).

> **Espere eu dizer qual é o `PLATAFORMA_SLUG`** antes de salvar. Se o banco já
> tem uma clínica com pacientes, a plataforma precisa usar o endereço dela,
> senão os pacientes antigos ficam "do lado de fora".

---

## Parte 3: o e-mail de confirmação (10 minutos, uma vez só)

Isto resolve o "às vezes o e-mail não chega ou não abre".

1. Abra **supabase.com**, entre e abra o projeto.
2. Menu **Authentication** e depois **URL Configuration**.
3. Em **Site URL**, escreva: `https://telemedicina-lake.vercel.app`
4. Em **Redirect URLs**, clique em **Add URL** e adicione estas duas:
   - `https://telemedicina-lake.vercel.app/auth/confirmar`
   - `https://telemedicina-lake.vercel.app/**`
5. Clique em **Save**.
6. (Recomendado) Em **Authentication** e depois **Email Templates**, troque o
   link dos modelos **Confirm signup** e **Reset Password** pelos que estão em
   `docs/publicar.md`, na seção "E-mail de confirmação". Assim a confirmação
   funciona até se a pessoa abrir o e-mail no celular.

> O envio de e-mail do Supabase grátis só manda para poucos endereços e poucas
> vezes por hora. Para paciente de verdade, precisa de um serviço de e-mail
> (SMTP). Existe opção grátis (Resend, 3.000 e-mails por mês), mas ela pede um
> **domínio próprio** (ex.: `suaclinica.com.br`), que custa cerca de R$ 40 por
> ano. **Isso é gasto: só faço se você autorizar.**

---

## Parte 4: eu publico e testo

Depois das partes 1 e 2, me escreva **"pode publicar"**. Aí eu:

1. Mando a versão nova para a branch `main` do GitHub.
2. A **Vercel** (site) e o **Render** (API) atualizam sozinhos, em uns 5 minutos.
3. Abro o site publicado e confiro: a API responde, as 30 gavetas estão lá, as
   telas novas abrem.
4. Te digo o que funcionou e o que não funcionou.

---

## Parte 5: o teste que só você pode fazer

Eu não entro com a sua senha (é regra de segurança). Depois que eu publicar:

1. Entre no site com o **e-mail que você pôs em `PLATAFORMA_ADMIN_EMAILS`**.
2. Na primeira vez, aparece a **configuração inicial**: preencha razão social e CNPJ.
3. No menu, abra **Administração**. Você deve ver: Painel, Médicos,
   **Pacientes**, **Qualidade e faltas**, Credenciamentos, Financeiro...
4. Em **Configurações**, ponha a **porcentagem padrão** dos médicos (ex.: 70)
   e o **prazo sugerido do retorno** (ex.: 30 dias; o médico pode mudar em cada consulta). Clique em **Salvar**.
5. Em **Médicos**, mude a porcentagem de um médico. Ela deve aparecer como "própria".
6. Em **Financeiro**, clique em **Planilha das consultas**. Um arquivo deve baixar.

Se algo der errado, tire um print da tela e me mande.

---

## O que pode custar dinheiro (só com sua autorização)

| O quê | Para que serve | Preço aproximado | Sem pagar |
| --- | --- | --- | --- |
| Domínio próprio + Resend | E-mail chegar para qualquer paciente | ~R$ 40/ano (domínio); Resend grátis até 3.000 e-mails/mês | Só a equipe do projeto recebe e-mail |
| Render pago (Starter) | API não "dormir" depois de 15 minutos parada | ~US$ 7/mês | A primeira visita depois de um tempo parada demora uns 50 segundos |
| Mercado Pago (conta de recebimento) | Receber Pix e cartão de verdade | ~0,99% no Pix e ~4% a 5% no cartão, por venda | As consultas ficam sem cobrança pela plataforma |
| Nota fiscal automática (NFS-e) | Emitir a nota de cada consulta | ~R$ 0,10 a R$ 0,50 por nota | O contador emite por fora, usando a planilha |
| Repasse automático ao médico (split) | O dinheiro do médico ir direto para ele | taxa por transação do provedor | O repasse é feito por Pix e registrado no Financeiro |

---

## Extra: o e-mail de cadastro não chega (carteiro próprio, grátis)

**Por que acontece:** quem manda o e-mail de confirmação é o Supabase. O
"carteiro" que vem de graça com ele serve só para teste: manda uns **2 e-mails
por hora** para o site inteiro e sai de um endereço que cai no **spam**. Quando
ele não consegue mandar, o cadastro é desfeito. Por isso o primeiro cadastro
chegou (no spam) e os seguintes não.

**A solução:** dar ao Supabase um carteiro próprio, uma conta do **Gmail**.
É grátis e manda até uns 500 e-mails por dia.

### Parte A: criar a "senha de app" no Gmail (10 minutos)

> Recomendado: crie um Gmail **só para a plataforma** (ex.:
> `telesaude.avisos@gmail.com`). Os pacientes vão ver esse endereço como
> remetente. Se preferir, pode usar um Gmail que você já tem.

1. Entre no Gmail que vai mandar os e-mails.
2. Abra **myaccount.google.com/security**.
3. Procure **Verificação em duas etapas**. Se estiver **desativada**, clique e
   ative (o Google pede o seu celular). Sem isso, o passo seguinte não aparece.
4. Abra **myaccount.google.com/apppasswords**.
5. Em "Nome do app", escreva **Supabase** e clique em **Criar**.
6. Aparece uma senha de **16 letras** num quadro amarelo (ex.: `abcd efgh ijkl mnop`).
   **Copie e guarde por 10 minutos.** Ela só aparece uma vez.
   **Não mande essa senha no chat.**

### Parte B: colocar o Gmail no Supabase (5 minutos)

1. Abra **supabase.com/dashboard**, entre e abra o projeto da telemedicina.
2. Menu da esquerda: **Authentication**. Depois **Emails** e depois a aba
   **SMTP Settings**. Em versões antigas do painel, o caminho é
   **Project Settings** e depois **Authentication**.
3. Ligue a chave **Enable custom SMTP**.
4. Preencha assim:

| Campo | O que escrever |
| --- | --- |
| Sender email | o endereço do Gmail (ex.: `telesaude.avisos@gmail.com`) |
| Sender name | `TeleSaúde` |
| Host | `smtp.gmail.com` |
| Port number | `465` |
| Minimum interval between emails | `30` |
| Username | o mesmo endereço do Gmail |
| Password | a senha de 16 letras, **sem os espaços** |

5. Clique em **Save**.
6. Ainda em **Authentication**, abra **Rate Limits**. Em **Rate limit for
   sending emails**, troque para **30** (por hora) e clique em **Save**.

### Parte C: testar

1. Abra o site numa **janela anônima** (Ctrl+Shift+N).
2. Crie uma conta com um e-mail seu que **ainda não tenha conta** no site.
3. O e-mail deve chegar em até 1 minuto, com o nome **TeleSaúde**. Se cair no
   spam, marque **"Não é spam"**: isso ensina o Gmail do paciente.
4. Crie uma segunda conta com outro e-mail: deve chegar também.

> Para nunca cair no spam, o ideal é um **domínio próprio** (ex.:
> `telesaude.com.br`, cerca de R$ 40 por ano) com o serviço Resend (grátis até
> 3.000 e-mails por mês). **Isso é gasto: só faço se você autorizar.**
