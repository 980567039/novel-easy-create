# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund

FROM dependencies AS builder
COPY . .
# Prisma 7 loads prisma.config.ts while generating. The placeholder is only
# needed for configuration parsing; generation does not connect to a database.
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    DATABASE_URL="postgresql://postgres:postgres@db:5432/novel_role?schema=public" \
    npx prisma generate \
    && npm run build

FROM dependencies AS migrator
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY prisma.config.ts ./
COPY prisma ./prisma
CMD ["./node_modules/.bin/prisma", "db", "push"]

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p /app/data/image-assets \
    && chown -R node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
