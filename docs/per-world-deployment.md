# Per-World Deployment — Operator Guide

This document covers the universe-of-planets architecture (Phases G–T): how
to enable per-world sharding, how to read the ops-telemetry lens, how to
debug a stuck shard, how to tune flavor JSON, how to publish UGC worlds.

## Architecture summary

**Concordia is the universe; the 8+ authored sub-worlds are the planets.**
A logged-in player loads exactly one world at a time. Each active world
gets a worker thread (Phase I) that runs its per-world heartbeat loops
in isolation. The parent process keeps HTTP, Socket.IO, and the writeable
`economy_ledger` handle.

| Phase | Purpose | Activation |
|-------|---------|-----------|
| G     | Per-world flavor JSON (loops + climate + voice + density) | `content/world/<world>/loops.json` |
| H     | Procgen NPC density up to 200–1000/world | `CONCORD_PROCGEN_NPCS=1` |
| I     | Worker-thread per active world; idle teardown | `CONCORD_SHARD_WORLDS=true` |
| J     | Portal load screen + scene swap UX | always on |
| K     | Preexisting bug pass | always on |
| M     | 50–200 concurrent / world + soft cap | `CONCORD_WORLD_USER_SOFT_CAP=200` |
| N     | Spectator mode | `/lenses/spectate` |
| O     | Per-world LLM voice in NPC dialogue | loops.json#worldVoice |
| P     | Cross-world federation + news feed | always on |
| Q     | UGC worlds via Foundry | `/lenses/foundry` |
| R     | World marketplace (tenant leases) | `/api/world-marketplace/lease` |
| S     | Real-money tournaments per world | `/api/tournaments/create` |
| T     | AI residents | `/api/residents/deploy` |

## When to enable sharding

Default OFF. Enable when:
1. You've observed ops-telemetry for 24h with sharding off and seen no
   tick overruns.
2. Your RunPod pod has ≥ 16GB RAM and ≥ 8 vCPU.
3. You expect more than 50 concurrent users across multiple worlds.

To enable:
```bash
# In your .env file:
CONCORD_SHARD_WORLDS=true
CONCORD_HEARTBEAT_POOL_SIZE=4
CONCORD_WORLD_USER_SOFT_CAP=200
```

The first user who travels to a world spawns its worker (~2–3s cold).
Subsequent travels are instant. After 10 minutes with 0 users in a world,
its worker terminates cleanly. Re-entry re-spawns.

## Reading the ops-telemetry lens

**`/lenses/ops-telemetry`** (admin only) shows:

- **Heartbeat module timings** — p50/p90/p99 per module. Worker-pool
  modules (refusal-field, faction-strategy, lattice-quest, etc.) appear
  with a `worker` tag. p99 > 10s = `ConcordHeartbeatModuleSlow` alert.
- **Worker pools** — macro pool + heartbeat pool: size / busy / idle /
  queue. Queue > 0 = pool too small for the workload.
- **Brain endpoints** — per-endpoint inflight + failures. Wedged (≥ 3
  consecutive failures) endpoints get starved by the router.
- **World shards** — per-world status (spawning / ready / catching-up /
  idle / crashed), uptime, last tick, restart count. Manual restart button.

## Debugging a stuck shard

1. Look at ops-telemetry → "World shards" — find the stuck world.
2. Check the heartbeat module timings filtered to the stuck world's
   loops — any module with p99 > 25s will trigger the dispatcher's
   per-module timeout and increment `concord_heartbeat_module_timeout_total`.
3. Click "restart" in the world-shard widget. The manager kills the
   worker and respawns on next user activity.
4. If restart-loop: check the worker exit code in the server log
   (`world-shard-manager: worker_exit { code }`). Common causes:
   - SQLite DB locked: another writer is contesting. Check WAL mode.
   - Module load failure: a per-world module's import fails in the
     shard's curated list (`server/workers/world-shard.js`).

## Tuning loops.json

Each world's `content/world/<world>/loops.json` declares which of the 14
per-world heartbeat modules are active, frequency overrides, climate band,
faction starting state, skill ceilings, NPC density target, and LLM
voice. Example:

```json
{
  "loops": {
    "npc-routine-cycle": { "enabled": true, "frequency": 5 },
    "kingdom-decree-cycle": { "enabled": false }
  },
  "climate": { "baseTemp": 32, "humidity": 80, "illumination": 1.1 },
  "skillCeilings": { "fire": 50, "water": 250 },
  "npcDensity": { "targetPerFaction": 80 },
  "worldVoice": {
    "tone": "warm, mythopoetic",
    "vocabulary": ["the breath", "the green hours"],
    "avoid": ["modern slang", "tech jargon"]
  }
}
```

Changes are picked up on next server boot. UGC worlds publish via the
Foundry lens which reloads the cache without a restart.

## Cloudflare tunnel — no changes needed

All public-read routes (`/api/worlds/spectator-counts`,
`/api/worlds/:worldId/flavor`, `/api/worlds/:worldId/health`,
`/api/cross-world/feed`, `/api/foundry/worlds`, `/api/tournaments/active`)
are in `publicReadPaths` so anonymous discovery works through the tunnel
without an auth header. CORS rules from `ALLOWED_ORIGINS` apply.

If your tunnel domain is the only ingress, set `TUNNEL_PUBLIC_URL` in
`.env` and `./startup.sh --cloudflare` will wire it through to
`NEXT_PUBLIC_API_URL` + `COOKIE_DOMAIN` automatically (see
`startup.sh:59–98`).

## Preflight check

`./scripts/preflight-production.sh` validates:
- All 8 authored sub-worlds have a valid `loops.json` (warn if missing,
  error if malformed JSON).
- `BRAIN_<NAME>_URLS` (if set) parses as comma-separated URLs.
- `CONCORD_SHARD_WORLDS` is true/false/0/1.
- `CONCORD_HEARTBEAT_POOL_SIZE` is sane vs available vCPU.

Wire into RunPod startup as before:
```bash
./scripts/preflight-production.sh && ./startup.sh --runpod
```

## Verification checklist

After enabling Phase F-lite (`CONCORD_SHARD_WORLDS=true`):
1. `curl localhost:5050/metrics | grep concord_world_shard` — gauges
   present.
2. Travel to a world (`POST /api/worlds/travel { worldId: "cyber" }`).
   Should return 200 within 5s with `shardStatus: { ok: true,
   firstTickEtaMs: <2-3s for cold start, <100ms for warm> }`.
3. Open ops-telemetry — cyber shard shows `ready` status, last tick
   within last 60s.
4. Stop entering for 10+ min — shard transitions to `idle → torn down`.
5. Re-enter — shard re-spawns; same firstTickEtaMs.
