# TeleSaúde (plataforma de telemedicina)

Monorepo pnpm: `apps/web` (Next.js, Vercel), `apps/api` (Fastify, Render), `packages/db` (Drizzle, Supabase Postgres), `packages/shared`. Decisões em `docs/adr-*.md`; uso e testes em `docs/manual/`.

## Especificações do projeto
- Objetivo: plataforma de telemedicina multi-clínica com agenda, teleconsulta, prontuário eletrônico, documentos com assinatura ICP-Brasil, pagamento e conformidade com a LGPD.
- Referências de mercado (produtos a igualar): Conexa Saúde e Doctoralia (teleconsulta e jornada do paciente), iClinic e Amplimed (prontuário e gestão de clínica), Memed (prescrição digital), Doctolib e Teladoc Health (referências internacionais de operação e escala).
- Verba de investimento: R$ 0 (padrão)
- Público/uso: clínicas, médicos, recepção e pacientes no Brasil, no celular e no computador.
- Requisitos obrigatórios:
  1. Isolamento entre clínicas e acesso a dado clínico só por quem atende (LGPD art. 6º, III).
  2. Prontuário imutável com adendo, auditoria somente de inserção e guarda de 20 anos.
  3. Consentimento versionado e direitos do titular.
  4. Nada pode quebrar o que já funciona: toda mudança passa pelos testes e pelo manual.
- Limitações conhecidas: hospedagem gratuita (Render hiberna e não tem região no Brasil); vídeo, assinatura integrada, e-mail e pagamento dependem de contas externas; a produção atual é de demonstração (`documentosComValorLegal=false`, `videoReal=false`).
- Critérios de aceite: `pnpm typecheck`, `pnpm test`, `pnpm test:banco` e os dois builds passando; roteiro da seção 10 do manual conferido; aprovação do subagente `supervisor-telemedicina`.

## Regras de trabalho neste repositório
- Antes de mudar arquitetura, escala, segurança ou regra regulatória, use a Skill `plataforma-telemedicina-mercado`.
- Ao concluir uma etapa relevante, chame `supervisor-projeto` e `supervisor-telemedicina`.
- `git push` na `main` publica sozinho na Vercel e no Render. Nunca envie para a `main` sem o Wiliam pedir.
- Trate o banco de `apps/api/.env` como se fosse o da produção. Não rode `pnpm demo:criar` nem scripts que gravam sem conferir o banco de destino.
- Testes de banco só em banco descartável: `pnpm test:banco` usa `DATABASE_URL_TESTE` e recusa rodar sem ele.
- Mudança de banco é sempre migração nova em `packages/db/drizzle/` (ADR-0004), e a migração precisa ser compatível com a versão anterior do código, porque o deploy não é atômico.
