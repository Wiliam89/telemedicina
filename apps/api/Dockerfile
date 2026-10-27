# =============================================================================
#  Imagem da API (ADR-0020) - para rodar em conteiner (Render, Fly.io,
#  Kubernetes, ECS) e escalar horizontalmente: varias copias atras de um
#  balanceador. O agendador de avisos e seguro com varias instancias.
#
#  Construir (na RAIZ do repositorio - a API precisa do monorepo):
#    docker build -f apps/api/Dockerfile -t telemedicina-api .
#  Rodar:
#    docker run --env-file apps/api/.env -e NODE_ENV=production -p 3333:3333 telemedicina-api
# =============================================================================

# --- 1) construir ------------------------------------------------------------
FROM node:22-alpine AS construcao
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @tele/api...
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @tele/api build
# Pasta enxuta so com as dependencias de producao da API.
RUN pnpm --filter @tele/api deploy --prod --legacy /saida && cp -r apps/api/dist /saida/dist

# --- 2) rodar ------------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production PORT=3333
WORKDIR /app
COPY --from=construcao /saida ./
# Migracoes ficam junto: o verificador de estado do banco (/saude) le a pasta.
COPY --from=construcao /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3333/vivo || exit 1
CMD ["node", "dist/servidor.js"]
