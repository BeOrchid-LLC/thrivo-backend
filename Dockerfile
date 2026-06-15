# syntax=docker/dockerfile:1

# Multi-stage build. One image, two processes, selected by build-stage target:
# `api` runs `dist/index.js` (HTTP + /health); `worker` runs `dist/worker.js`
# (background jobs, no HTTP). Coolify's Dockerfile build pack has no start-command
# override, so each Coolify app targets its stage (Docker Build Stage Target =
# `api` / `worker`). Coolify builds from git and health-gates the API on /health.

# ---- deps: full install (incl. dev) for the build stage ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: bundle the three entrypoints with tsup ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: shared base — prod-only deps + bundled dist + raw migrations ----
# No CMD/EXPOSE/HEALTHCHECK here; the api/worker stages below add what each needs.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Bundled entrypoints (index/worker/migrate) and the .sql files the migrator reads.
COPY --from=build /app/dist ./dist
COPY --from=build /app/db/migrations ./db/migrations
# Drop root for the running process.
USER node

# ---- api: HTTP server, health-gated cutover on /health ----
FROM runtime AS api
EXPOSE 4000
# Liveness from inside the container (no curl in slim — use Node's global fetch).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# ---- worker: background jobs — no HTTP, no port, no /health to probe ----
FROM runtime AS worker
HEALTHCHECK NONE
CMD ["node", "dist/worker.js"]
