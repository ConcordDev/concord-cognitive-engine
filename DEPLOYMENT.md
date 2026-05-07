# Concord Cognitive Engine -- Deployment Guide

## Prerequisites

- **Node.js 18+** (20 LTS recommended)
- **Ollama** for local LLM inference (https://ollama.ai)
- **SQLite** (bundled via better-sqlite3, no separate install needed)
- **GPU recommended** -- RTX 4000 Ada 20GB or equivalent for full four-brain architecture
- **Disk**: 280GB+ for artifact storage; 50GB minimum for models + data
- **RAM**: 16GB minimum, 64GB recommended for production

---

## Quick Start (Bare Metal)

```bash
git clone <your-repo-url> concord-cognitive-engine
cd concord-cognitive-engine
chmod +x setup.sh
./setup.sh
```

The `setup.sh` script will:
1. Verify Node.js 18+ is installed
2. Install npm dependencies for backend and frontend
3. Create required data directories
4. Copy `.env.example` to `.env` if not present
5. Run database migrations

After setup, configure your `.env` file (see Environment Configuration below), then start with PM2 or Docker.

---

## Ollama Model Requirements

Concord uses a four-brain cognitive architecture. Each brain runs a separate Ollama model:

| Model | Role | Download Size | VRAM Required |
|---|---|---|---|
| `qwen2.5:14b-instruct-q4_K_M` | Conscious brain -- chat, deep reasoning, council deliberation | ~9GB | ~5.5GB |
| `qwen2.5:7b-instruct-q4_K_M` | Subconscious -- autogen, dream, evolution, synthesis | ~5GB | ~4.5GB |
| `qwen2.5:3b` | Utility -- lens interactions, entity actions, quick tasks | ~2GB | ~2GB |
| `llava:7b` | Vision -- image analysis and multimodal understanding | ~5GB | ~4GB |
| `nomic-embed-text` | Embeddings -- semantic search and DTU similarity | ~275MB | ~300MB |

### Pulling Models

```bash
# Pull all required models
ollama pull qwen2.5:14b-instruct-q4_K_M
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull qwen2.5:3b
ollama pull llava:7b
ollama pull nomic-embed-text
```

Concord will also auto-pull missing models on startup via `initThreeBrains()` if Ollama is reachable.

### Minimal Setup (No GPU)

For CPU-only or limited hardware, you can run smaller models:

| Brain | Minimal Model | VRAM |
|---|---|---|
| Conscious | `qwen2.5:7b` | ~4.5GB |
| Subconscious | `qwen2.5:1.5b` | ~1.5GB |
| Utility | `qwen2.5:3b` | ~2GB |
| Repair | `qwen2.5:0.5b` | ~0.5GB |

Set the model names in your `.env` via `BRAIN_CONSCIOUS_MODEL`, `BRAIN_SUBCONSCIOUS_MODEL`, etc.

---

## Docker Compose Deployment

The project includes a full `docker-compose.yml` with the following services:

| Service | Description | Ports |
|---|---|---|
| `backend` | Node.js API server | 5050 (internal) |
| `frontend` | Next.js frontend | 3000 (internal) |
| `nginx` | Reverse proxy + TLS termination | 80, 443 |
| `certbot` | Automatic SSL certificate renewal | -- |
| `ollama-conscious` | Conscious brain (14B model) | 11434 (internal) |
| `ollama-subconscious` | Subconscious brain (7B model) | 11435 (internal) |
| `ollama-utility` | Utility brain (3B model) | 11436 (internal) |
| `ollama-repair` | Repair brain (1.5B model) | 11437 (internal) |
| `prometheus` | Metrics collection | 9090 (internal) |
| `grafana` | Monitoring dashboards | 3001 (internal) |

### Steps

1. Copy and configure environment:
   ```bash
   cp .env.example .env
   # Edit .env -- see "Environment Configuration" below
   ```

2. Generate required secrets:
   ```bash
   # JWT secret (required)
   openssl rand -hex 64

   # Session secret
   openssl rand -hex 32

   # Admin password (minimum 12 characters)
   # Choose a strong password and set ADMIN_PASSWORD in .env
   ```

3. Start all services:
   ```bash
   docker compose up -d
   ```

4. Monitor startup:
   ```bash
   docker compose logs -f backend
   ```

5. Verify health:
   ```bash
   curl http://localhost:5050/health
   curl http://localhost:5050/ready
   ```

### Resource Limits (from docker-compose.yml)

| Service | Memory Limit | CPU Limit |
|---|---|---|
| backend | 16GB | 8 cores |
| frontend | 1GB | 0.5 cores |
| nginx | 256MB | 0.5 cores |

The backend `start_period` is set to 180 seconds (3 minutes) to allow time for embedding model loading and Ollama warm-up.

---

## Bare-Metal Deployment with PM2

The project includes an `ecosystem.config.cjs` for PM2 process management.

### Install PM2

```bash
npm install -g pm2
```

### Start Services

```bash
# Start backend + frontend
pm2 start ecosystem.config.cjs

# Check status
pm2 status

# View logs
pm2 logs concord-backend
pm2 logs concord-frontend
```

### PM2 Configuration Details

| App | Script | Port | Memory Limit | Mode |
|---|---|---|---|---|
| concord-backend | `server/server.js` | 5050 | 4GB | fork |
| concord-frontend | `npm start` (in concord-frontend/) | 3000 | 1GB | fork |

Both apps use graceful shutdown with a 10-second kill timeout. The backend uses `wait_ready` with a 30-second listen timeout.

### Log Files

- Backend: `logs/backend-out.log`, `logs/backend-error.log`
- Frontend: `logs/frontend-out.log`, `logs/frontend-error.log`

### PM2 Startup (Auto-Restart on Reboot)

```bash
pm2 startup
pm2 save
```

---

## Environment Configuration

Copy `.env.example` to `.env` and configure the following:

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `JWT_SECRET` | JWT signing key (generate with `openssl rand -hex 64`) | `<your-generated-secret>` |
| `ADMIN_PASSWORD` | Admin account password (min 12 chars) | `<your-strong-password>` |
| `SESSION_SECRET` | Session signing key (generate with `openssl rand -hex 32`) | `<your-generated-secret>` |

### Server Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5050` | Backend API port |
| `NODE_ENV` | `production` | Environment mode |
| `DATA_DIR` | `/data` | Persistent data directory |
| `ALLOWED_ORIGINS` | -- | CORS allowed origins (comma-separated) |
| `AUTH_ENABLED` | `true` | Enable authentication |
| `AUTH_MODE` | `hybrid` | Auth mode: `hybrid`, `jwt`, `apikey` |

### Brain Configuration

| Variable | Default | Description |
|---|---|---|
| `BRAIN_CONSCIOUS_URL` | `http://ollama-conscious:11434` | Conscious brain Ollama URL |
| `BRAIN_CONSCIOUS_MODEL` | `qwen2.5:14b-q4_K_M` | Conscious brain model |
| `BRAIN_SUBCONSCIOUS_URL` | `http://ollama-subconscious:11434` | Subconscious brain URL |
| `BRAIN_SUBCONSCIOUS_MODEL` | `qwen2.5:7b` | Subconscious model |
| `BRAIN_UTILITY_URL` | `http://ollama-utility:11434` | Utility brain URL |
| `BRAIN_UTILITY_MODEL` | `qwen2.5:3b` | Utility model |
| `BRAIN_REPAIR_URL` | `http://ollama-repair:11434` | Repair brain URL |
| `BRAIN_REPAIR_MODEL` | `qwen2.5:1.5b` | Repair model |

### Optional Features

| Variable | Default | Description |
|---|---|---|
| `EMBEDDINGS_ENABLED` | `true` | Enable embedding-based search |
| `FEDERATION_ENABLED` | `false` | Enable multi-instance federation |
| `CONCORD_INSTANCE_ID` | auto | Unique instance ID for federation |
| `CONCORD_CAPABILITIES` | -- | Comma-separated federation capabilities |
| `CONCORD_REGISTRY_URL` | default | Federation registry URL |
| `ENABLE_TERMINAL_EXEC` | `false` | Enable terminal execution (dangerous) |
| `CONCORD_WS_ENABLED` | `true` | Enable WebSocket realtime |
| `MAX_DTUS_IN_MEMORY` | `10000` | Max DTUs held in heap |

See `.env.example` for the complete list including Stripe, OAuth, voice, and vision configuration.

---

## Health Checks

Three health endpoints are available for monitoring and orchestration:

### GET /health

Basic liveness check. Returns immediately.

```json
{
  "status": "healthy",
  "version": "5.1.0-production",
  "uptime": 3600.5,
  "timestamp": "2026-03-31T12:00:00.000Z"
}
```

### GET /ready

Readiness probe. Returns `200` when the server can accept requests, `503` otherwise. Used by Docker health checks and Kubernetes readiness probes.

### GET /api/status

Comprehensive system status including infrastructure health, brain connectivity, DTU counts, and feature flags.

```bash
# Docker health check (from docker-compose.yml)
curl -sf http://localhost:5050/ready || exit 1
```

---

## GPU Memory Management Tips

1. **Monitor VRAM usage**: Use `nvidia-smi` or `watch -n 1 nvidia-smi` to track real-time VRAM consumption.

2. **Stagger model loading**: Ollama loads models on first request. Warm up each brain sequentially rather than simultaneously to avoid VRAM spikes:
   ```bash
   curl http://localhost:11434/api/generate -d '{"model":"qwen2.5:14b-instruct-q4_K_M","prompt":"hello","stream":false}'
   # Wait for completion, then warm the next brain
   ```

3. **Set `OLLAMA_NUM_PARALLEL=1`**: Prevents Ollama from loading multiple copies of the same model for concurrent requests.

4. **Use quantized models**: The `q4_K_M` quantization provides good quality/size balance. Smaller quants (`q3_K_S`) save more VRAM but reduce quality.

5. **Offload to CPU**: If VRAM is insufficient, Ollama automatically offloads layers to CPU. Set `OLLAMA_GPU_LAYERS` to control how many layers stay on GPU.

6. **Single-brain mode**: For <8GB VRAM, point all brain URLs to the same Ollama instance and use a single 7B model. Set all `BRAIN_*_URL` vars to the same host.

7. **Memory ceiling**: The backend itself is limited to 8GB heap (`--max-old-space-size=8192` in Docker). The DTU heap holds ~170,000 DTUs before consolidation kicks in.

---

## Troubleshooting

### Server won't start

- Check Node.js version: `node -v` (must be 18+)
- Verify `.env` has `JWT_SECRET` set (required even in dev)
- Check port availability: `lsof -i :5050`
- Review logs: `pm2 logs concord-backend` or `docker compose logs backend`

### Ollama models not loading

- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- Check VRAM: `nvidia-smi` -- models may fail silently if VRAM is exhausted
- Pull models manually: `ollama pull qwen2.5:14b-instruct-q4_K_M`
- Check brain URLs in `.env` match your Ollama deployment

### "DTUs disappeared" after restart

- Ensure `DATA_DIR` points to persistent storage
- In Docker, verify the `concord-data` volume is mounted
- SQLite state backend is used in production by default; check `DB_PATH`

### CORS errors in browser

- Set `ALLOWED_ORIGINS` in `.env` to your frontend URL
- In development, localhost origins are allowed automatically
- Check browser console for the specific rejected origin

### High memory usage

- Reduce `MAX_DTUS_IN_MEMORY` (default 10,000)
- Consolidation runs every 30 ticks (~7.5 minutes) and compresses DTUs at ~33:1 ratio
- Check for memory leaks: `pm2 monit` or Docker `stats`

### Authentication issues

- Verify `AUTH_ENABLED=true` and `JWT_SECRET` is set
- For development, set `AUTH_ENABLED=false` to bypass auth
- Check that cookies are being sent (browser must be on an allowed origin)
- API key auth requires `X-API-Key` header

### Docker Compose issues

- Ensure all `.env` variables are set before running `docker compose up`
- Backend depends on all four Ollama services being healthy -- check their logs
- The 3-minute `start_period` means health checks won't fail during initial model loading
- If Grafana won't start, ensure `GRAFANA_USER` and `GRAFANA_PASSWORD` are set
