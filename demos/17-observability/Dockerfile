FROM node:24-bookworm-slim AS build

RUN npm install --global pnpm@11
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim

RUN groupadd --system demo \
    && useradd --system --gid demo --home-dir /app demo \
    && mkdir -p /workspace /tmp/dsh-home /tmp/observability \
    && chown -R demo:demo /workspace /tmp/dsh-home /tmp/observability

WORKDIR /app
COPY --from=build --chown=demo:demo /app/package.json ./
COPY --from=build --chown=demo:demo /app/node_modules ./node_modules
COPY --from=build --chown=demo:demo /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3017
ENV DSH_WORKSPACE=/workspace
ENV DSH_HOME=/tmp/dsh-home
ENV OBSERVABILITY_DB=/tmp/observability/observability.db
ENV DSH_TELEMETRY_DISABLED=1

USER demo
EXPOSE 3017

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3017/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.js"]
