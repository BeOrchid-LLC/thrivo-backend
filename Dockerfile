# syntax=docker/dockerfile:1

# Multi-stage build. One image, two processes, selected by build-stage target:
# `api` runs `dist/index.js` (HTTP + /health); `worker` runs `dist/worker.js`
# (background jobs, no HTTP). Coolify's Dockerfile build pack has no start-command
# override, so each Coolify app targets its stage (Docker Build Stage Target =
# `api` / `worker`). Coolify builds from git and health-gates the API on /health.

# ---- deps: full install (incl. dev) for the build stage ----
# `npm install` (not `npm ci`): the committed lockfile is generated on Windows
# and records win32-only optional deps, so the Linux builder must resolve fresh
# from package.json (see below) rather than sync against that lockfile.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Only package.json — NOT package-lock.json. The committed lockfile is generated
# on Windows and records only win32 platform-specific optional deps (e.g.
# @rollup/rollup-win32-x64-msvc), so on the Linux builder npm skips the Linux
# native binary (@rollup/rollup-linux-x64-gnu) and rollup/tsup fail to load
# (npm/cli#4828). Resolving fresh from package.json pulls the correct platform.
COPY package.json ./
# --include=dev: Coolify injects NODE_ENV=production into the build env, which
# makes npm skip devDependencies (tsup, typescript, ...) needed by `npm run
# build`. Force them in regardless. The runtime stage stays --omit=dev.
RUN npm install --include=dev --no-audit --no-fund

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
# package.json only (see deps stage) — avoid the Windows lockfile's platform-
# pinned optional deps so npm resolves prod deps for the Linux runtime.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
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

# ---- worker: background jobs — no HTTP server, so no /health endpoint ----
# Can't use HEALTHCHECK NONE: Coolify parses the Dockerfile, finds the api
# stage's HEALTHCHECK, and flags the whole app as having a custom healthcheck
# (custom_healthcheck_found=true). It then waits on the worker container's
# Docker health status, and `docker inspect .State.Health.Status` errors out
# with no Health key (rolling update fails). Give the worker a real liveness
# probe on its actual dependency — a Redis PING (the BullMQ broker). Populates
# .State.Health so the deploy passes, and marks the worker unhealthy if its
# Redis connection dies (a BullMQ worker with dead Redis is silently useless).
FROM runtime AS worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const R=require('ioredis');const r=new R(process.env.REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:4000});r.connect().then(()=>r.ping()).then(()=>{r.disconnect();process.exit(0)}).catch(()=>process.exit(1))"
CMD ["node", "dist/worker.js"]
