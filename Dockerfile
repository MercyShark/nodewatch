# Nodewatch: one container (API + agent + UI). Multi-stage build.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @nodewatch/shared build \
 && pnpm --filter @nodewatch/server build \
 && pnpm --filter @nodewatch/web build
# Standalone production tree for the server (workspace deps included).
RUN pnpm --filter @nodewatch/server --prod deploy --legacy /out

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini wget ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app/server
COPY --from=build /src/apps/web/dist /app/web
ARG GIT_SHA=dev
LABEL org.opencontainers.image.source="https://hub.docker.com/r/rishabhdev04/nodewatch" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV NODEWATCH_REVISION=${GIT_SHA}
ENV NODE_ENV=production \
    WEB_DIST=/app/web \
    DATA_DIR=/app/data \
    HOST=127.0.0.1 \
    PORT=8080
EXPOSE 8080 18545
# Same check as compose.yaml, so a plain `docker run` reports health too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server/dist/index.js"]
