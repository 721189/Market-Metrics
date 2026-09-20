# =============================================================================
# Market-Metrics backend — multi-stage production image (Railway target)
# =============================================================================
# Build stage: install all deps, emit the Vite client bundle + esbuild server
# bundle. Runtime stage: production deps only, non-root user, dumb-init so
# SIGTERM from Railway reaches node cleanly (graceful worker shutdown).
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching.
COPY package.json package-lock.json tsconfig.json vite.config.ts ./

RUN npm ci --no-audit --no-fund

COPY src ./src
COPY public ./public
COPY index.html ./
COPY server.ts ./

# Emits dist/ (client assets) + dist/server.cjs (node bundle).
RUN npm run build

# =============================================================================
# Runtime stage: minimal footprint, production deps only.
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init \
  && addgroup -S appgroup \
  && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./

# NOTE: --omit=dev (the --production flag is deprecated).
RUN npm ci --no-audit --no-fund --omit=dev

COPY --from=builder /app/dist ./dist

USER appuser

ENV NODE_ENV=production
# Railway injects PORT at runtime; default keeps local `docker run` working.
ENV PORT=3000

EXPOSE 3000

# /health is unauthenticated by design; failures here mean "restart me".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || '3000') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.cjs"]
