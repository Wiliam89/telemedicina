# MCP neste projeto

**Decisão atual: nenhum servidor MCP é necessário no projeto.** Git, `gh`, os scripts `pnpm db:*` e o navegador do aplicativo já cobrem o trabalho.

Regra: MCP só entra quando resolve algo que as ferramentas atuais não resolvem e não amplia o risco sobre dado de saúde.

| MCP | Decisão | Motivo |
|---|---|---|
| Supabase | **Não conectar à produção** | Daria a um agente acesso a dado sensível. Só considerar em projeto de desenvolvimento separado, em modo somente leitura, depois que os bancos forem separados |
| Sentry | Considerar quando o Sentry for adotado | Ajuda a investigar erros; revise antes se os eventos trazem dado pessoal |
| GitHub | Desnecessário | `gh` já atende |
| Render e Vercel | Opcional, somente leitura | Útil para logs; os painéis e as CLIs já atendem |
| Playwright | Considerar se os testes de navegador virarem rotina | O navegador do aplicativo atende hoje |

## Antes de adicionar um MCP

1. Confirme que é da fonte oficial e leia as permissões.
2. Use credencial própria, de privilégio mínimo e fora do Git.
3. Nunca dê acesso a banco ou log com dado de paciente real.
4. Registre a decisão em um ADR.

## MCP como produto

Oferecer um servidor MCP da própria plataforma para clientes é uma funcionalidade futura, e não um requisito de mercado hoje. Se surgir, ele seguiria as mesmas regras de autorização da API, nunca com acesso direto ao banco.
