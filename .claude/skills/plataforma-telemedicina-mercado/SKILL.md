---
name: plataforma-telemedicina-mercado
description: Padrão de plataformas profissionais de telemedicina no Brasil para avaliar e evoluir o TeleSaúde. Cobre arquitetura compatível com evolução, escala, segurança, LGPD, CFM, prescrição digital, videochamada, pagamento, confiabilidade e uso de MCP. Use ao planejar ou revisar funcionalidades, ao perguntar se algo está no padrão de mercado, ao mexer em agenda, teleconsulta, prontuário, receita, assinatura, Pix, webhook, migração ou deploy, ou ao preparar a plataforma para paciente real ou grande volume. Não use para ajustes visuais simples nem para dúvidas que não envolvam a plataforma.
metadata:
  version: 1.0.0
  projeto: telemedicina
---

# Plataforma de telemedicina no padrão de mercado

Objetivo: levar cada decisão ao nível de um produto profissional **sem quebrar o que já funciona**.

## Regras críticas

1. **Avaliar antes de alterar.** Só mude o que tem evidência de estar fora do padrão: arquivo e linha, saída de teste ou medição.
2. **Menor mudança segura.** Não refatore por gosto nem troque biblioteca sem necessidade. Prefira atualização dentro da mesma versão principal.
3. **Nunca toque em dado real para testar.** Antes de rodar qualquer script que grava, confirme o banco de destino.
4. **Publicar é decisão do Wiliam.** `push` na `main` publica sozinho. Migração em produção, gasto e contratação também são decisões dele.
5. **Não afirme conformidade legal.** Registre o que o código atende e encaminhe o restante para revisão jurídica. Citação regulatória precisa da fonte primária: veja `references/regulatorio-brasil.md`.

## Fluxo de trabalho

### 1. Entender o estado real
Leia o `CLAUDE.md` do projeto, o ADR da área e o trecho do manual em `docs/manual/manual.html`. Depois meça a produção:

```bash
node .claude/skills/plataforma-telemedicina-mercado/scripts/auditar-producao.mjs
pnpm audit --prod
```

### 2. Comparar com o padrão
Use a referência da área em questão e classifique cada ponto como atendido, parcial ou ausente:

| Assunto | Consulte |
|---|---|
| O que os produtos líderes oferecem | `references/referencias-de-mercado.md` |
| Arquitetura, evolução e grande escala | `references/arquitetura-e-escala.md` |
| CFM, LGPD, prontuário, receita, assinatura | `references/regulatorio-brasil.md` |
| Lista de auditoria contra bugs, por fluxo | `references/checklist-sem-bugs.md` |
| Quando usar MCP e quais evitar | `references/mcp.md` |

### 3. Classificar a gravidade

- **CRÍTICO:** vazamento de dado de saúde, execução remota, acesso entre clínicas, perda de prontuário, teste contra dado real.
- **ALTO:** cobrança errada, horário preso ou duplicado, conta sem recuperação, teleconsulta que falha sem saída, promessa falsa ao titular.
- **MÉDIO:** falha que degrada a operação, mas tem contorno.
- **BAIXO:** acabamento.

### 4. Corrigir sem regressão
Para cada correção:

1. Escreva um teste que falha por causa do problema, quando for viável.
2. Faça a menor mudança que resolve.
3. Mantenha contrato de API, nomes de rota e envelope `{ ok, dados | erro }`.
4. Para banco, crie migração nova compatível com o código anterior: primeiro expandir, depois migrar, só então contrair.
5. Rode tudo:

```bash
pnpm typecheck
pnpm test
pnpm test:banco
pnpm --filter @tele/api build
pnpm --filter web build
```

6. Confira no navegador o fluxo afetado, no celular e no computador.
7. Atualize o manual e o ADR se o comportamento mudou.

### 5. Relatar com honestidade
Entregue: o que mudou e por quê, o resultado dos testes, a comparação com a referência, o que **não** foi testado, as decisões do Wiliam e os upgrades futuros com preço aproximado. Chame `supervisor-projeto` e `supervisor-telemedicina` antes de declarar pronto.

## Invariantes do TeleSaúde

Quebrar qualquer um destes é regressão grave:

- Toda consulta ao banco pela API filtra por `clinicaId` e por quem pede. A API usa a credencial dona do banco, então o RLS é só a segunda tranca (ADR-0006).
- Recepção e administração não leem dado clínico.
- Evolução finalizada é imutável, e a correção é por adendo.
- Auditoria é somente inserção, e toda leitura de prontuário por profissional é auditada.
- O estado do pagamento vem do provedor, nunca da tela.
- O token de vídeo é por pessoa, de curta duração, e nunca vai no HTML.
- E-mail e notificação não trazem dado clínico.
- A hora local sempre usa o fuso da clínica.
- A API não guarda estado em memória: precisa rodar em várias cópias, e tarefas agendadas precisam ser seguras nessa situação.

## Problemas comuns

**Teste de banco recusa rodar.** Falta `DATABASE_URL_TESTE`. Use um banco descartável, nunca o da produção. O formato do banco de teste está em `scripts/preparar-banco-de-teste.sql`, na raiz do projeto.

**Build da Vercel passa, mas a API quebra.** Vercel e Render publicam em momentos diferentes. Mantenha a API compatível com a versão anterior do site durante a troca.

**Falha só em produção.** Compare `/saude`, o `x-request-id` da resposta e os logs do Render antes de alterar código.
