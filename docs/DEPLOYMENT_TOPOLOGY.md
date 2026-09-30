> See [`STACK_REALITY.md`](./STACK_REALITY.md) for measured LIVE vs OVERCLAIM (2026-09-05).

# Concord Deployment Topology — Rendering, GPU, RunPod + Cloudflare

**Date:** 2026-06-26 · Grounded in a read-only audit of the running stack (file paths inline).

**GPU/CPU pinning audit correction (2026-07-20):** this doc's "Blackwell GPU" framing is stale — the
real deployed target is now a single **NVIDIA A40 (48GB GDDR6)**, not the RTX PRO 4500 Blackwell
(32GB) described throughout below (`docker-compose.yml` — search "target: single NVIDIA A40" — has
already been re-tuned with a real per-instance VRAM/CPU budget; this doc predates that switch and
hasn't been re-verified against it line-by-line). The architectural recommendation below (client
renders, GPU is cognition-only) is unaffected by the card swap; only the specific VRAM/model-size
numbers should be read as historical, not current — see CLAUDE.md's five-brain section for the
corrected pointer.

This doc answers: *where should the 3D rendering run, and how is the Blackwell GPU best used,* given
Concord runs on a **single RunPod GPU pod behind Cloudflare**. It is a recommendation + a flagged spec
for an optional future tier — not a rebuild.

---

## Current reality (audited)

- **3D rendering is 100% client-side.** Concordia renders in the browser via Three.js + Rapier3D
  (`concord-frontend/components/world-lens/ConcordiaScene.tsx`, `lib/world-lens/physics-world.ts`).
  Primary backend is **WebGL2**; **WebGPU is already scaffolded as opt-in**
  (`localStorage 'concordia:renderer'='webgpu'` → lazy `WebGPURenderer`, graceful WebGL2 fallback).
  There is **no server-side rendering, no headless GL, no NVENC, no CUDA** anywhere in `server/`.
- **The GPU runs cognition, not graphics.** The RunPod **RTX PRO 4500 Blackwell (32GB)** is fully
  committed to the 5-brain Ollama stack (~35GB resident with q8_0 KV cache + flash attention):
  conscious / subconscious / utility(×2) / repair / vision (`server/lib/brain-config.js`,
  `.env.runpod`, `docker-compose.yml`).
- **Delivery:** Next.js (3000) + nginx (80/443) + Node/Express + socket.io (5050); optional Cloudflare
  tunnel → `.proxy.runpod.net` → nginx. SQLite WAL on a persistent volume.
  **Scope note (audit 2026-07-27):** this describes the DOCKER COMPOSE topology (nginx is a
  docker-compose service that terminates 80/443 and reverse-proxies to both frontend/backend — see
  `nginx/conf.d/default.conf`). The current primary deploy target — bare metal via `pm2`/`startup.sh`
  on the A40 box — runs **no nginx at all**: a `cloudflared` binary on the host tunnels directly to
  the frontend on :3000, with its own ingress rules routing `/api/*`, `/socket.io/*`, and `/godot-ws`
  straight to the backend on :5050 (`infra/cloudflare/cloudflared.yml.example`'s "BARE METAL" block;
  see also the topology comment in `concord-frontend/next.config.js`'s `rewrites()`). Both topologies
  are real and intentionally coexist — this doc's diagram below is the docker/RunPod-proxy one
  specifically, not a claim that bare metal also runs nginx.
- **Isolation primitives present:** per-world sharding (`server/workers/world-shard.js`,
  `CONCORD_SHARD_WORLDS`), a CPU macro worker pool (`server/workers/macro-pool.js`), a socket-disconnect
  janitor (`_sweepSocketState` in `server.js`), WebRTC signalling for telehealth/voice
  (`server/lib/webrtc-signalling.js`, no server media termination, no explicit STUN/TURN).

```
  CLIENT BROWSER                         RUNPOD POD (Blackwell GPU + CPU)
 ─────────────────────                  ───────────────────────────────────
  Three.js + Rapier      ◄── socket ──►  Node monolith (server.js, 5050)
  (WebGL2 / opt-in WebGPU)               ├─ CPU worker pool (FEA/CAS/heavy macros)
  renders the world locally              ├─ per-world shards
                                         └─ GPU ►► 5-brain Ollama (cognition only)
        ▲ Cloudflare tunnel ─────────────┘  nginx 80/443 · Next 3000
```

---

## Recommendation

### DEFAULT — Setup B: client render + GPU-for-cognition  ✅ (aligned, low-friction)
Keep rendering on the client; keep the Blackwell GPU dedicated to the 5-brain cognition + heavy
*macros* offloaded to the **CPU** worker pool. This matches reality and is the cost-correct
mass-adoption path (a single GPU can serve thousands of *cognition* requests but only a handful of
*render* sessions). Net-new is small:
- **Auto-prefer WebGPU** when `navigator.gpu` reports an adapter (keep the WebGL2 fallback) instead of
  the current localStorage opt-in — `ConcordiaScene.tsx`.
- **Scale cognition** via the existing multi-endpoint `BRAIN_*_URLS` + per-world sharding, measured on
  the `ops-telemetry` lens.

### OPTIONAL — Setup A: server-side pixel streaming  ⚠️ (spec'd, feature-flagged, NOT built now)
Stream NVENC-encoded H.264/AV1 frames over WebRTC to thin clients (zero-install, runs on weak devices).
**Deliberately not on the build path** because on the *shared cognition GPU* it would starve the brains
and cost-scale badly (~5–15 Mbps + a GPU render context **per concurrent user**; cloud refs ~$8/hr/GPU).
Only worth it on a **dedicated render GPU** (second card or MIG partition). If/when pursued, reuse:
the existing WebRTC signalling (`webrtc-signalling.js` + simple-peer) and `_sweepSocketState` for
per-session context reclaim; net-new is a headless renderer + NVENC encoder + media bridge +
matchmaking + VRAM reclaim. Track it as a separate initiative behind a `CONCORD_PIXEL_STREAM` flag.

### Sources
- [Unreal Pixel Streaming on Azure](https://learn.microsoft.com/en-us/gaming/azure/reference-architectures/unreal-pixel-streaming-in-azure) ·
  [Pixel Streaming at scale on AWS](https://aws.amazon.com/blogs/gametech/deploy-unreal-engines-pixel-streaming-at-scale-on-aws/) ·
  [WebGPU vs Pixel Streaming (three.js forum)](https://discourse.threejs.org/t/metaverse-mass-adoption-webgpu-vs-pixel-streaming/41624) ·
  [Pixel Streaming vs WebGL/Three.js 2025](https://ravespace.io/blog/pixel-streaming-vs-webgl-three-js-2025-s-scientific-verdict-on-3d-web-technologies)

---

## Operational gates (rendering-agnostic — build these now)

These apply regardless of render mode and tie into the Orchestrated Invariant Engine:

1. **Input-stream sanitization at the network boundary.** Every socket input (`player:move`,
   `combat:attack`, chat) is validated + rate-limited before it touches physics/state — the
   invariant-engine contract applied at ingestion + a socket-event token bucket + `sanitizeVector`
   on positions + world-bounds recovery. (Anti-cheat `_validateCombatReach`/`_validateDamageCap`
   already exist — extended, not duplicated.)
2. **Connection / WebRTC cleansing.** `_sweepSocketState` reclaims per-session resources on
   tab-close/disconnect; any future render/WebRTC context plugs into the same teardown.
3. **GPU concurrency partitioning.** The cognition GPU is not time-sliced with rendering; the existing
   per-world shard isolation (`world-shard.js`) is the partition model so one crowded quadrant can't
   starve other lenses. Any Setup-A render tier MUST run on a partitioned/second GPU.

---

## GPU-cognition: what's real vs a category error

The GPU accelerates **LLM inference** (Ollama, already maximized: flash-attention, q8 KV cache, tuned
`OLLAMA_NUM_PARALLEL` per brain, multi-endpoint `BRAIN_*_URLS`). It does **not** accelerate:
- the **macro worker pool** (`node:worker_threads` = CPU; FEA/CAS/quantum macros in `lib/compute/*.js`
  are pure CPU JS — no GPU/CUDA/WebGPU import exists in `server/`),
- **invariant evaluation** (CPU JS `eval`),
- **per-entity NPC ticks** (CPU; LLM-driven NPC cognition is salience-gated *by design*).

Genuinely implementable GPU-cognition items (low priority, verified-feasible only): evaluate FP4 model
variants *iff* Ollama supports them (current models are q4_K_M/q8_0, not FP4); batch + fan out
LLM-driven faction/NPC decisions across `BRAIN_*_URLS` with tunable salience budgets; surface
GPU/inference telemetry on the ops-telemetry lens. No code will claim GPU acceleration it doesn't have.
