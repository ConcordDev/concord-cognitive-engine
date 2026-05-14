# RunPod Deployment Guide

Concord runs on RunPod with the **NVIDIA RTX PRO 4500 Blackwell** (32GB GDDR7). This document captures the deployment-specific knobs.

## Persistent storage

RunPod mounts the persistent network volume at `/workspace`. Concord auto-detects this on startup:

```js
DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync('/workspace') ? '/workspace/concord-data' : './data')
```

Everything that must survive a pod restart goes there:
- `concord.db` (SQLite — DTU substrate, world data, marketplace)
- `concord_state.json` (live STATE snapshot — periodic)
- `artifacts/` (binary DTU payloads — music, images, blueprints)
- `backups/` (rolling backups — every 2 minutes by `backup-scheduler`)
- `snapshots/` (full STATE snapshots — every 5 minutes)
- `seed/` (idempotent seed markers)

**Do not write player data anywhere outside `/workspace/concord-data`** on RunPod — the rest of the filesystem is wiped when the pod restarts.

## GPU

The four cognitive brains + LLaVA all run on the same GPU via Ollama. With 32GB VRAM:

| Service | Default model | VRAM |
|---|---|---|
| `ollama-conscious` | `concord-conscious:latest` (custom, built on qwen2.5) | ~18GB |
| `ollama-subconscious` | `qwen2.5:7b-instruct-q4_K_M` | ~5GB |
| `ollama-utility` | `qwen2.5:3b` | ~2GB |
| `ollama-repair` | `qwen2.5:0.5b` | ~0.5GB |
| `ollama-vision` | `llava:13b-v1.6-vicuna-q4_K_M` + `nomic-embed-text` | ~9GB + ~0.3GB |

That's ~35GB of model weights. With `OLLAMA_KV_CACHE_TYPE=q8_0` (halves KV memory) and `OLLAMA_GPU_OVERHEAD=1GB` reserved for headroom, models swap between GPU and CPU as needed under load. The sets of models that are co-resident at any moment are decided by `OLLAMA_KEEP_ALIVE=24h` plus inference traffic.

If you ever change to a smaller GPU, override the conscious model: `BRAIN_CONSCIOUS_MODEL=qwen2.5:14b-instruct-q4_K_M` brings everything well under 16GB.

## Heap

The Node server expects a 32GB heap. Set in three places (already wired in repo):
- `package.json` start script: `node --max-old-space-size=32768 server.js`
- `docker-compose.yml`: `NODE_OPTIONS=--max-old-space-size=32768` and `MAX_OLD_SPACE_SIZE=32768`
- The `memory-pressure.js` watchdog reads `MAX_OLD_SPACE_SIZE` for its 70/80/90% shed thresholds — these MUST agree.

To run on a smaller box, override all three together (they need to match).

## Network ports

| Service | Container port | RunPod template should expose |
|---|---|---|
| Concord server | 5050 | HTTP (proxied via RunPod's public URL) |
| Ollama brains | 11434–11437 (conscious / subconscious / utility / repair) | not exposed publicly — internal only |
| Ollama vision | 11438 | not exposed publicly |
| Redis | 6379 | not exposed publicly |
| Qdrant | 6333 | optional — not exposed publicly |

Only the Concord server port should be publicly addressable. Set `ALLOWED_ORIGINS` and `FRONTEND_URL` to your RunPod public URL.

## Required environment variables

Production-required:
- `JWT_SECRET` — sessions don't survive restart without this
- `ADMIN_PASSWORD` — sovereign admin login
- `ALLOWED_ORIGINS` — your RunPod public URL (for CORS)
- `FRONTEND_URL` — same

Optional but recommended for full performance:
- `CONCORD_FEDERATION_TOKEN` — if you peer with another instance
- `STRIPE_SECRET_KEY` — payments
- `RUNPOD_API_KEY` — if you want the horizontal-scaling module to spin up overflow pods

There is no OpenAI emergency-fallback path — it was removed. The five local Ollama brains are the only inference path; `ctx.llm.chat()` falls back to the subconscious brain when the conscious brain is unreachable, and per-user bring-your-own external API keys route per-brain-slot through the BYO key router.

## Scaling caps tuned for 32GB / RTX PRO 4500

All caps are env-overridable. Defaults:

| Variable | Default | Purpose |
|---|---|---|
| `CONCORD_MAX_SHADOWS` | 50000 | Shadow DTU store cap |
| `CONCORD_PLAYLIST_LIMIT` | 100 | Per-district music playlist size |
| `CONCORD_NPC_KNOWLEDGE_BATCH` | 1000 | Per-tick NPC knowledge mirroring |
| `CONCORD_SOCIAL_BRIDGE_BATCH` | 2000 | Per-tick social → NPC shadow conversion |
| `CONCORD_FAUNA_SPAWN_BATCH` | 500 | Per-tick creature spawns across worlds |
| `CONCORD_FEED_DTUS_PER_HOUR` | 10000 | Inbound feed rate-limit |
| `CONCORD_LLM_QUEUE_DEPTH` | 1000 | LLM job queue depth |
| `CONCORD_DIALOGUE_MAX_CONCURRENT` | 50 | Concurrent dialogue sessions |
| `CONCORD_DOWNLOADS_PER_USER` | 25 | Concurrent download streams |
| `CONCORD_HEARTBEAT_MS` | 5000 | Heartbeat tick interval |
| `BRAIN_CONSCIOUS_CONCURRENT` | 8 | JS-side parallel inference for conscious |
| `BRAIN_SUBCONSCIOUS_CONCURRENT` | 12 | Subconscious parallelism |
| `BRAIN_UTILITY_CONCURRENT` | 16 | Utility parallelism |
| `BRAIN_REPAIR_CONCURRENT` | 4 | Repair brain parallelism |
| `BRAIN_VISION_CONCURRENT` | 8 | LLaVA / vision parallelism |
| `LLM_CONCURRENCY` | 32 | Global LLM queue concurrency |
| `LLM_CONCURRENCY_LIMIT` | 64 | Hard ceiling on inflight LLM operations |
| `CONCORD_AGENT_TICK_CONCURRENT` | 32 | Emergent agent ticks per cycle |
| `CONCORD_GHOST_THREADS_CONCURRENT` | 16 | Ghost thread parallelism |
| `CONCORD_SQLITE_MMAP_MB` | 4096 | SQLite mmap window |
| `CONCORD_SQLITE_CACHE_MB` | 1024 | SQLite page cache |
| `CONCORD_MACRO_CACHE_ENTRIES` | 25000 | Macro response cache |
| `CONCORD_TRACER_MAX_SPANS` | 50000 | Inference tracer ring |
| `CONCORD_CONVERSATION_DTUS_PER_SESSION` | 500 | Conversation memory per session |
| `CONCORD_SIM_MAX_JOBS` | 5000 | Simulation job queue |
| `CONCORD_DREAM_PROMOTIONS_PER_CYCLE` | 50 | Dream → marketplace promotions |
| `CONCORD_META_SESSIONS_PER_CYCLE` | 20 | Meta-derivation sessions |
| `CONCORD_META_DTUS_PER_DAY` | 100 | Meta-derivation output cap |
| `CONCORD_EVENT_RATE_PER_MIN` | 200 | Event-to-DTU bridge rate limit |
| `CONCORD_EVENT_DEDUP_SIZE` | 100000 | Event dedup window |
| `CONCORD_FEDERATION_EVENT_LOG` | 100000 | Federation audit log |
| `CONCORD_LENS_PATTERNS_PER_DOMAIN` | 500 | Lens-learning pattern cap |
| `CONCORD_SCENARIOS_PER_USER` | 1000 | Scenario engine cap |
| `CONCORD_ARCHIVE_BATCH_SIZE` | 2000 | DTU archive batch |
| `CONCORD_REHYDRATION_CACHE_MAX` | 5000 | DTU rehydration cache |
| `CONCORD_FEDERATION_TOKEN` | (unset) | If set, federation export requires Bearer auth |

## Embeddings on GPU

The default backend is `ollama` against `nomic-embed-text` running on `ollama-vision`. ~50× faster than the CPU Xenova fallback per RunPod's NVIDIA cuVS guidance. Override with:

- `CONCORD_EMBED_BACKEND=xenova` — keep CPU embeddings (offline / dev / smaller boxes)
- `CONCORD_EMBED_OLLAMA_URL=http://...` — point at a different Ollama instance
- `CONCORD_EMBED_OLLAMA_MODEL=...` — swap embedding model (e.g. `mxbai-embed-large` for 1024-dim)

The first request after pod start auto-pulls the model — expect a 30-60s warm-up; the probe in `initLocalEmbeddings()` does this up front.

## Bare-metal RunPod (no docker-compose)

If your RunPod template is a single-container template (typical), you'll need:
1. A single Dockerfile that runs Ollama + Node server in the same container, or
2. Five sidecar containers (one per Ollama service + Concord) via RunPod's "additional containers" feature

The repo's `Dockerfile` and `docker-compose.yml` are tuned for the multi-container path. Either works; the multi-container path is recommended because each Ollama service can independently `OLLAMA_KEEP_ALIVE=24h` its model.

## Verifying GPU is actually being used

After startup, check:
- `nvidia-smi` inside the container shows ollama processes with VRAM allocated
- `GET /api/world/me/metrics` returns cleanly (proves SQLite + STATE wiring)
- `POST /api/voice/session/create` (if voice is enabled) lights up Vision brain
- Server log line: `embeddings_loaded backend=ollama model=nomic-embed-text dim=768`
  - If you see `backend=xenova` instead, the Ollama probe failed; check `BRAIN_VISION_URL` reachability.
