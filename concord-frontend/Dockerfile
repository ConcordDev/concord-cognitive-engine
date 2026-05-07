# Frontend Dockerfile
# To fully pin with SHA256 digest (recommended for production):
#   docker pull node:20-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:20-alpine
# Then replace: FROM node:20-alpine@sha256:<digest> AS base
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV npm_config_cache=/tmp/npm-cache

# Copy package files and npm configuration
COPY package*.json ./
COPY .npmrc ./

# Install dependencies with retry logic
# The .npmrc contains retry settings for network resilience
RUN npm ci || (sleep 5 && npm ci) || (sleep 10 && npm ci)

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for API and Socket URLs
# When omitted, Next.js reads .env.production (https://concord-os.org).
# Override at build time: docker build --build-arg NEXT_PUBLIC_API_URL=https://...
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL

# Optional CI-only build controls (defaults keep full checks enabled)
ARG CI_SKIP_TYPECHECK=0
ARG CI_SKIP_LINT_IN_BUILD=0
ENV CI_SKIP_TYPECHECK=$CI_SKIP_TYPECHECK
ENV CI_SKIP_LINT_IN_BUILD=$CI_SKIP_LINT_IN_BUILD

# Build Next.js app
# Skip prophet-check (requires ../server which isn't in the Docker context).
# Bump Node heap to 6GB — default ~3.8GB OOMs on the full 1.3M-line
# codebase + 175 lenses + Sentry webpack passes. Same fix as ci.yml's
# direct-node build step.
RUN NODE_OPTIONS="--max-old-space-size=6144" npx next build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_CACHE_DIR=/data/next-cache
ENV npm_config_cache=/data/npm-cache

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /data/next-cache /data/npm-cache
RUN chown -R nextjs:nodejs /data

# Copy public folder
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: 'localhost', port: 3000, path: '/', timeout: 5000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

CMD ["node", "server.js"]
