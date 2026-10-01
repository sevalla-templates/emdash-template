# syntax=docker/dockerfile:1

# =============================================================================
# EmDash on Sevalla — production image.
#
# The image is secret-free: no environment variable is needed at build time.
# Database, object storage and Sevalla API credentials are injected by Sevalla
# at runtime (see .env.example).
# =============================================================================

ARG NODE_VERSION=24

# --- Dependencies (with dev deps, for the build) ------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- Build --------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund

# --- Runtime ------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

# AWS SDK >= 3.729 adds CRC32 checksums to presigned upload URLs by default,
# which S3-compatible stores such as Sevalla Object Storage (Cloudflare R2)
# can reject. Only send checksums when an operation requires them.
ENV AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED \
    AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

# Only what the server needs. The seed file is inlined into the build, and
# .emdash/migrations.json + scripts/ let a Sevalla Job run `npm run migrate`.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.emdash ./.emdash
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/server.mjs ./server.mjs

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./server.mjs"]
