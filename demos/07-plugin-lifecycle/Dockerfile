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
    && mkdir -p /workspace /tmp/dsh-home \
    && chown -R demo:demo /workspace /tmp/dsh-home

WORKDIR /app
COPY --from=build --chown=demo:demo /app/package.json ./
COPY --from=build --chown=demo:demo /app/node_modules ./node_modules
COPY --from=build --chown=demo:demo /app/dist ./dist
COPY --chown=demo:demo patches ./patches
COPY --chown=demo:demo config ./config

ENV NODE_ENV=production PORT=3007 DSH_WORKSPACE=/workspace DSH_HOME=/tmp/dsh-home
USER demo
EXPOSE 3007

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3007/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.js"]
