# Worker image. Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t gta6-worker .
# Secrets are injected at runtime by the platform's secret manager, never baked into the image.
# Debian 13 (trixie): FFmpeg 7.1, closer to the 6.1 used in CI than bookworm's 5.1.
FROM node:24-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/connectors/package.json packages/connectors/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/jobs/package.json packages/jobs/
COPY packages/observability/package.json packages/observability/
RUN pnpm install --frozen-lockfile --prod --filter @gta6/worker...

FROM base AS runtime
ENV NODE_ENV=production
# Renders: FFmpeg (with libass for subtitles) and the subtitle font.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages ./packages
COPY package.json pnpm-workspace.yaml ./
COPY apps/worker ./apps/worker
COPY packages ./packages
USER node
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]
