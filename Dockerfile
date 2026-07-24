# Multi-stage build for the open-smp monorepo. Targets: api, worker, web.
#
# node:22 (not -slim): argon2 (apps/api) needs build tools for its native
# binding when a prebuilt isn't available for the exact platform; the full
# image ships python3/make/g++ so `pnpm install` never needs extra apt
# packages. All three targets ship straight from source via tsx/next — there
# is no compiled `dist` (apps/api and apps/worker "build" scripts are just
# `tsc --noEmit`, i.e. typecheck only).

FROM node:22 AS base
RUN npm i -g pnpm@10
WORKDIR /repo

# --- Dependency layer: manifests only, so `pnpm install` is cached until a
# manifest actually changes (source edits below never bust this layer). ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/matcher/package.json packages/matcher/package.json
COPY packages/queues/package.json packages/queues/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/connectors/core/package.json packages/connectors/core/package.json
COPY packages/connectors/google-workspace/package.json packages/connectors/google-workspace/package.json
RUN pnpm install --frozen-lockfile

# --- Full source, dependencies already installed above. ---
FROM deps AS source
COPY . .

# --- api ---
FROM source AS api
WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "start"]

# --- worker ---
FROM source AS worker
WORKDIR /repo/apps/worker
ENV NODE_ENV=production
CMD ["pnpm", "start"]

# --- web: build stage produces the Next.js production build. ---
FROM source AS web-build
# Build-time default so `next build` has a value to embed for static paths;
# docker-compose overrides API_URL at runtime (next.config.ts rewrites read
# process.env.API_URL again when the server boots, so the real value wins).
ARG API_URL=http://localhost:3001
ENV API_URL=${API_URL}
RUN pnpm --filter @open-smp/web build

FROM web-build AS web
WORKDIR /repo/apps/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
