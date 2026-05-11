# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────────────────────
# Install full deps (dev + prod), compile the TypeScript bundle, then prune
# back to prod-only so the runtime stage can copy a slim node_modules tree.
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifest + lockfile first to maximise layer cache reuse on source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the minimum needed to build — keeps unrelated repo files out of the layer.
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/

RUN npm run build \
 && npm prune --omit=dev

# ─── Runtime stage ────────────────────────────────────────────────────────────
# Alpine ships a `node` user with uid 1000 — we run as that user, never as root.
FROM node:22-alpine AS runner

ENV NODE_ENV=production

WORKDIR /home/node/app

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

# The MCP transport is stdio — the client (Claude Code, Cursor, etc.) invokes
# `docker run -i` and pipes JSON-RPC frames through stdin/stdout. Logs go to
# stderr, so the protocol channel stays clean.
ENTRYPOINT ["node", "dist/index.js"]
