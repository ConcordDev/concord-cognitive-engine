# Backend Dockerfile (glibc-based for onnxruntime compatibility)
# Pin to Node 20.x LTS for reproducibility.
# To fully pin with SHA256 digest (recommended for production):
#   docker pull node:20-bookworm-slim
#   docker inspect --format='{{index .RepoDigests 0}}' node:20-bookworm-slim
# Then replace the FROM line with: FROM node:20-bookworm-slim@sha256:<digest> AS base
FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS base

# Install build tools for native modules (better-sqlite3) and runtime deps.
# z3 is the SMT checker for reason.verify's formal-proof gate (lib/proof-gate.js);
# it's optional at runtime (the gate degrades to verdict:"unavailable" without it)
# but baking it into the image makes the proof gate live out of the box.
# `apt-get upgrade` is deliberate, not boilerplate. The FROM above is
# digest-pinned, which freezes the base at the exact bits it had when built —
# so Debian security patches published AFTERWARDS never reach the image, and
# the pinned layer only accumulates CVEs over time. Verified 2026-07-28 that
# the pin is NOT merely stale: querying Docker Hub for the current
# `node:20-bookworm-slim` returns this same digest
# (sha256:2cf067cf...), so there is no newer base to move to and upgrading
# packages in-layer is the only way to pick up fixed CVEs.
#
# This is what makes the Trivy gate's `ignore-unfixed: true` honest: we apply
# every fix that exists, then decline to fail on the ones that don't.
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    z3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and npm configuration
COPY package*.json ./
COPY .npmrc ./

# Install production deps with retry logic
# The .npmrc contains retry settings for network resilience
RUN npm ci --omit=dev || (sleep 5 && npm ci --omit=dev) || (sleep 10 && npm ci --omit=dev)

# Copy app code
COPY . .

# Run tests before building production image — build fails if any test fails
ENV NODE_ENV=test
ENV CONCORD_NO_LISTEN=true
RUN node --test 'tests/auth.test.js' 'tests/brain-routing.test.js' 'tests/dtu.test.js' 'tests/semantic-cache.test.js' 'tests/embeddings.test.js' 'tests/marketplace.test.js' 'tests/heartbeat.test.js' 'tests/api-endpoints.test.js' || (echo "Tests failed — aborting build" && exit 1)

ENV NODE_ENV=production
ENV PORT=5050
ENV DATA_DIR=/data
ENV STATE_PATH=/data/concord_state.json
ENV npm_config_cache=/data/npm-cache

# Ensure xenova transformers cache dir exists (optional dep; avoids noisy log warnings)
RUN mkdir -p /app/node_modules/@xenova/transformers/.cache && chmod 775 /app/node_modules/@xenova/transformers/.cache

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs concord && \
    mkdir -p /data /data/npm-cache && chown -R concord:nodejs /data

USER concord

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5050/health || exit 1

CMD ["node", "server.js"]
