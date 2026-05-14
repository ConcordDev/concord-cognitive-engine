# Concord — RunPod Deploy Guide

Single-pod deployment of the full Concord stack (backend + frontend + 5 Ollama brains) on a RunPod GPU pod. End-to-end takes about 25 minutes the first time, ~5 minutes for redeploys.

---

## 1. Pod requirements

| Component | Minimum | Recommended | Why |
|---|---|---|---|
| GPU VRAM | 16 GB | 32 GB (RTX PRO 4500 Blackwell, GDDR7) | conscious + subconscious + vision loaded together |
| vCPU | 8 | 16+ | tick loop + 178 emergent modules |
| RAM | 32 GB | 62 GB | 32GB Node heap (`MAX_OLD_SPACE_SIZE=32768`) |
| Disk | 50 GB | 150 GB | Ollama models alone are 30+ GB |

**Template**: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04` — has CUDA + Python + Node 20 deps.

---

## 2. First-time setup

```bash
# In the RunPod web terminal:
cd /workspace
git clone https://github.com/<your-fork>/concord-cognitive-engine.git
cd concord-cognitive-engine

# Install runtime deps (Node 20, pm2, ollama)
./setup.sh

# Configure env
cp .env.runpod .env
nano .env
```

**Required env vars** (in `.env`):

```bash
JWT_SECRET=<openssl rand -hex 64>
SESSION_SECRET=<openssl rand -hex 32>
ADMIN_PASSWORD=<set a real password>

# From RunPod pod page → Connect → HTTP Service for port 5050
RUNPOD_PUBLIC_URL=https://<pod-id>-5050.proxy.runpod.net

# Optional: founder bypass for first-run admin tasks
FOUNDER_SECRET=<openssl rand -hex 32>
```

Leave `ALLOWED_ORIGINS`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `COOKIE_DOMAIN` blank — `startup.sh` derives them from `RUNPOD_PUBLIC_URL` automatically.

---

## 3. Pull Ollama models

```bash
# Pull the five-brain models (run in tmux/screen — first pull is slow)
ollama serve &
sleep 3
ollama pull qwen2.5:7b-instruct-q4_K_M     # subconscious
ollama pull qwen2.5:3b                     # utility
ollama pull qwen2.5:0.5b                   # repair
ollama pull llava:13b-v1.6-vicuna-q4_K_M   # vision
ollama pull nomic-embed-text               # embeddings
# concord-conscious:latest is a custom model built from a Modelfile on top of qwen2.5
```

Total disk hit: ~30 GB. Verify with `ollama list`.

---

## 4. Preflight (validates env BEFORE start)

```bash
./scripts/preflight-production.sh
```

Single command that verifies every required env var is set with a sane value. Exits 1 with a clear "MISSING: X" list if anything's wrong. Auto-runs as the first step of `./startup.sh --runpod` when `NODE_ENV=production`, but you can run it manually any time to verify config.

What it checks:

| Required | Why |
|---|---|
| `JWT_SECRET` (≥ 64 hex chars) | auth signing — without it sessions don't survive restart |
| `SESSION_SECRET` (≥ 32 hex chars) | cookie signing |
| `ADMIN_PASSWORD` (≥ 12 chars) | first-run admin login |
| `NODE_ENV=production` | feature gates key on this |
| `ALLOWED_ORIGINS` or `RUNPOD_PUBLIC_URL` or `DOMAIN` | CORS + WebSocket allowlist |
| LLM provider | `BRAIN_CONSCIOUS_URL` / `OLLAMA_HOST` reachable (the five local Ollama brains are the only inference path; there is no OpenAI emergency-fallback — `ctx.llm.chat()` falls back to the subconscious brain, and per-user BYO external API keys route per-brain-slot through the BYO key router) |
| Stripe pair | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` if either is set |
| S3 backup pair | `AWS_BUCKET` + `BACKUP_ENCRYPTION_KEY` if either is set |

Warns (doesn't block) on:
- `SENTRY_DSN` not set
- `CONCORD_FEDERATION_TOKEN` not set
- `TRUST_PROXY` is 0 behind a proxy
- `MAX_OLD_SPACE_SIZE` below 4096

---

## 5. Boot

```bash
./startup.sh --runpod
```

This runs:

1. Loads `.env`
2. Auto-fills derived URLs from `RUNPOD_PUBLIC_URL`
3. **Runs preflight** (production only — see §4)
4. Runs `npm install` if `node_modules/` missing
5. Runs migrations (`npm run migrate`)
6. Starts the backend under `pm2` with auto-restart
7. Starts the frontend (Next.js) under `pm2`
8. Tails the logs

Verify the boot log includes:
- `schema_migration_complete {"currentVersion":192}` — all migrations applied
- `content_seeded` — authored world content loaded
- `server_listening` with the public URL

---

## 5. Post-deploy smoke

```bash
./scripts/runpod-smoke.sh
```

Hits 13 critical endpoints (liveness, auth, world, Flow Combat, faction wars, OpenAPI). Exit 0 = green; exit 1 = at least one failure with the specific check listed.

---

## 6. First user

Open `RUNPOD_PUBLIC_URL` in a browser → register → enter the world. The tutorial cinematic plays once per browser, the mandatory NPC step routes them through Kael's torchlight quest, and the procedural Flow Combat substrate starts recording from the first attack.

---

## 7. Persistent state

By default, state lives at `/workspace/concord-cognitive-engine/server/data/`:

- `concord.db` — primary SQLite
- `concord_state.json` — in-memory state snapshot
- `artifacts/` — DTU binary attachments
- `evo-assets/` — EvoAsset cached versions
- `logs/` — pm2 logs

RunPod pods can be restarted; the data dir persists if the pod is **stopped + restarted** (not destroyed). To survive pod destruction:

```bash
./scripts/db-backup.sh        # writes data/backups/concord-<ts>.db
./scripts/db-export-schema.sh # readable schema dump
```

Plus: set `AWS_BUCKET` in `.env` and the autobackup scheduler ships hourly snapshots offsite.

---

## 8. Common issues

| Symptom | Fix |
|---|---|
| `Cannot find module 'better-sqlite3'` | `cd server && npm rebuild better-sqlite3` |
| Frontend 502 from RunPod proxy | Pod still booting — wait 60s, the Next.js cold start is slow on first hit |
| `ECONNREFUSED 11434` | `ollama serve` not running — `pm2 logs ollama` |
| `JWT_SECRET must be set` | `.env` not loaded — `set -a; source .env; set +a` then re-run startup |
| `[FATAL] JWT_SECRET must be at least 16 chars` | Use `openssl rand -hex 64` for a real secret |
| Heap OOM at 1700 MB | Bump `NODE_OPTIONS=--max-old-space-size=8192` in `.env`, restart |
| Health endpoint returns `degraded` | `curl /health` shows the failing check; usually memory pressure or save failures |

---

## 9. Redeploy

```bash
git pull
./startup.sh --runpod    # detects pod, reloads pm2, runs migrations
./scripts/runpod-smoke.sh
```

Migrations are append-only (numbered files in `server/migrations/`). The startup script runs them automatically; existing data is preserved.

---

## 10. Monitoring

| Surface | URL |
|---|---|
| Liveness | `<RUNPOD_PUBLIC_URL>/health` |
| Readiness | `<RUNPOD_PUBLIC_URL>/ready` |
| DB health | `<RUNPOD_PUBLIC_URL>/api/health/db` |
| WS health | `<RUNPOD_PUBLIC_URL>/api/health/ws` |
| System status | `<RUNPOD_PUBLIC_URL>/api/status` |
| OpenAPI | `<RUNPOD_PUBLIC_URL>/api/openapi.json` |
| Prometheus | `<RUNPOD_PUBLIC_URL>/metrics` |

Hook the health endpoint into RunPod's restart-on-failure or any external uptime monitor. Returns 503 on memory pressure or save-loop failures so an external monitor can trigger a restart before the pod becomes unrecoverable.
