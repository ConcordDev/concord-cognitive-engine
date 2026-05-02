# Concord — Deployment Readiness Audit
**Date:** 2026-05-02
**Branch:** `claude/plan-features-audit-alcTm`
**Target:** concord-os.org production deployment

---

## What's Already In Place (don't redo this work)

The deployment surface for Concord is unusually mature for a single-developer project. Confirmed present:

| Layer | Files | Status |
|---|---|---|
| Backend image | `server/Dockerfile` | ✅ |
| Frontend image | `concord-frontend/Dockerfile` | ✅ |
| Compose stack | `docker-compose.yml` (backend + frontend + 4 Ollama instances) | ✅ |
| Process manager | `ecosystem.config.cjs` (PM2) | ✅ |
| Reverse proxy | `nginx/` config dir | ✅ |
| Kubernetes | full set: namespace / deployment / service / ingress / hpa / network-policies / pvc / configmap / secrets / cronjob-backup / ci-cd | ✅ |
| Monitoring | `monitoring/grafana`, `monitoring/prometheus`, `monitoring/synthetic` | ✅ |
| Load testing | `load-tests/baseline.k6.js`, `smoke.k6.js` | ✅ |
| Operations scripts | `scripts/` — backup, deploy, rollback, db-backup, db-restore, health-check, disk-cleanup, repair-prophet, ingest, pull-models, pin-processes | ✅ |
| Auth + security | `JWT_SECRET` + `ADMIN_PASSWORD` enforced in production (`server.js:438`); helmet, rate-limit, cors, bcrypt, zod, compression | ✅ |
| Three-gate permissions | publicReadPaths + publicReadDomains + `_safeReadPaths` working | ✅ |
| Sentry | `SENTRY_DSN` env-driven (`server.js:387`) | ✅ |
| Env templates | `.env.example`, `.env.runpod`, `.env.production` | ✅ |
| Legal | `docs/PRIVACY_POLICY.md`, `docs/TERMS_OF_SERVICE.md` | ✅ |
| Docs | `DEPLOYMENT.md`, `SECURITY.md`, `AUTH.md`, `docs/operations/{deployment.md, incident-response.md, runbooks/}` | ✅ |
| Tests | 9,751 individual tests across `server/tests/` | ✅ |

This is well above industry baseline. Don't re-architect any of it.

---

## Critical Gaps That Block Deploy

These will fail or misbehave in production unless addressed.

### 1. Tests for new Phase F / F2 modules — **HIGH**
None of the modules added in Phases F and F2 have test coverage:
- `server/lib/procedural-creature.js` — physics validation, baseline matching, auto-rescale
- `server/lib/emergent-skills.js` — effect grammar gating, evolve, attachSkills
- `server/lib/creature-crossbreeding.js` — bond decay, compatibility, hybrid topology blend, tension ability
- `server/lib/world-clock.js`, `server/lib/npc-schedules.js`, `server/lib/npc-ambient.js`
- `server/lib/weather.js` — Markov stickiness
- `server/lib/combat-state.js`, `server/lib/combat-netcode.js`
- `server/lib/social-pings.js` — rate limiting
- `server/lib/gameplay-asset-bridge.js`
- `server/lib/world-events.js` (Phase A bridge already has a test)
- Frontend `lip-sync.ts`, `instanced-mesh-pool.ts`, `procedural-buildings.ts`, `asset-loader.ts`

**Action**: Write unit tests for at minimum the physics validation, effect grammar gating, hit anti-cheat, and rate limiting before deploy. Existing test for council-world-bridge is the model — tests author tables in `:memory:`, exercise the API, assert outcomes.

### 2. New endpoints not in `API.md` — **MEDIUM-HIGH**
The new endpoints are functional but undocumented:
- `/api/creature/{spawn,topologies,baselines,validate,encounter,crossbreed,hybrid,lineage}`
- `/api/emergent-skills/{create,evolve,list,:id}` (just renamespaced)
- `/api/social/ping`
- `/api/combat/{attack,hit,death,state,iframes,block}`
- `/api/world/{clock,weather,npc-behavior,npc-archetypes,npc-schedule}`

**Action**: Append a "Phase F2 endpoints" section to `API.md` with verb / path / auth / payload / response shape for each. SDK consumers and the openapi.yaml need this.

### 3. Migrations 082 + 083 must be applied — **MEDIUM**
`082_emergent_skills.js` and `083_creature_crossbreeding.js` were added in Phase F2. The migration runner is automatic but verify.

**Action**: On the first prod deploy, confirm `npm run migrate:status` lists both as applied. The schema will auto-create tables via `bootEmergentSkills()` and `ensureCrossbreedingTables()` if migrations didn't run, but make the migration the source of truth.

### 4. Mobile secure storage placeholder — **HIGH for mobile, low for web**
CLAUDE.md explicitly flags `concord-mobile/`'s secure storage as not production-ready. Web deploy is unaffected — but if you ship the mobile app at the same time, this blocks production wallet/key storage on devices.

**Action**: Replace placeholder with `expo-secure-store` (iOS Keychain / Android Keystore). One-session work in `concord-mobile/src/identity/`. If you're web-first this can wait.

### 5. Frontend build not verified — **MEDIUM**
Phase F2 added several new components and one fix to `WorldRenderer.tsx`. `npm run type-check` and `npm run build` (which includes prophet-check pre-build) have not run in this environment.

**Action**: On a machine with `concord-frontend/node_modules`:
```bash
cd concord-frontend && npm run lint && npm run type-check && npm run build
```
Build failures must be fixed before tagging a deploy.

---

## Operations Gaps Worth Closing Before Launch

### 6. Heartbeat helper for try/catch invariant — **MEDIUM**
The 62k-line `server.js` heartbeat now has 8+ tick blocks added across phases (walker advance, black-market expire, news pull, creature bond decay, NPC schedule replan, combat state tick, weather advance, world-clock broadcast). Each is hand-wrapped in try/catch. One missed wrap crashes the simulation.

**Action**: Add a `runHeartbeatModule(name, fn)` helper that does `try { await fn() } catch (e) { structuredLog(...) }` once. Refactor existing tick blocks to use it. Out of scope for this commit but a good first PR after deploy.

### 7. Synthetic monitoring for new endpoints — **MEDIUM**
`monitoring/synthetic/` exists but won't probe the new routes. A 200 from `/api/world/clock` is the cheapest health signal that the heartbeat is alive.

**Action**: Add probes: `GET /api/world/clock`, `GET /api/world/weather/concordia`, `GET /api/creature/topologies`, `GET /api/emergent-skills/list`. All public-readable, all cheap.

### 8. Grafana dashboards for new metrics — **MEDIUM**
The phase F2 modules log structured events (`world_clock_broadcast_started`, `npc_schedule_replan`, `news_log_ingest`, `concord_link_walker_tick`, `black_market_expired`, `combat_hit_rejected`) but Grafana doesn't have panels for them.

**Action**: Add panels:
- Walker tick: delivered / intercepted / errors per minute
- Black-market: active listings, sold rate, expired rate
- News pull: ingest count, high-water mark drift
- NPC behaviors: count by segment over time
- Combat anti-cheat: hits rejected by reason

### 9. Prometheus metric for heartbeat liveness — **HIGH**
If the heartbeat tick stops, every emergent system silently freezes. There's no metric for "ticks per minute."

**Action**: Add `concord_heartbeat_ticks_total` counter incremented in `governorTick`. Alert if `rate(...[1m]) == 0` for > 60s. The alert lives in `monitoring/prometheus/`.

### 10. Backup verification — **HIGH**
`scripts/db-backup.sh` exists. `scripts/db-restore.sh` exists. Has a backup → restore round-trip been exercised against a copy of `concord.db`?

**Action**: Run a dry-run restore in staging. Verify the restored DB boots cleanly and migrations report as applied. Document the runbook in `docs/operations/runbooks/`.

### 11. Domain SSL / DNS — **CHECK**
`.env.production` references `https://concord-os.org`. Verify:
- DNS A/AAAA records point to the production server / k8s ingress
- Let's Encrypt or equivalent cert is valid and on auto-renew (`scripts/setup-cron.sh` may handle this)
- HSTS enabled in nginx
- WebSocket upgrade path proxied correctly (socket.io runs on the same origin)

### 12. Repair brain (qwen2.5:0.5b) — **LOW priority but cheap**
The audit notes the repair brain is severely underutilized. For deploy, just ensuring it's pulled and reachable on its port (11437) keeps the option open. Not a blocker.

**Action**: `ollama pull qwen2.5:0.5b` on the deployment box. Already in DEPLOYMENT.md but verify in the production setup.

---

## Scaling & Ops Gaps (post-launch, not blockers)

### 13. SQLite single-writer bottleneck
`better-sqlite3` is synchronous in-process. At 100+ concurrent users you'll see lock contention. Mitigations:
- WAL mode (already on by default in better-sqlite3)
- Write-batching in heartbeat ticks (mostly already done)
- Plan migration to PostgreSQL once concurrent writes exceed ~200/sec

**Action**: Capture write contention metrics from day 1 so you know when to migrate.

### 14. Horizontal scaling story
`k8s/hpa.yaml` exists but the heartbeat is single-instance by design (state lives in process memory). Multiple replicas would each run their own tick — duplicate quest emergence, duplicate weather rolls.

**Action**: Decide: (a) one designated "heartbeat leader" elected by k8s lease + N read-only replicas, or (b) keep single replica and scale vertically. For launch, single replica + vertical scaling is cheaper and avoids the leader election bug surface.

### 15. CDN for evo-asset GLBs
As the gameplay→asset bridge promotes assets, refined GLBs accumulate. Serving them from the Node process is fine for hundreds; for thousands you want a CDN.

**Action**: Plumb `/data/artifacts/` and the evo-asset URL resolver through Cloudflare or Bunny once asset count exceeds ~1k. Not a launch blocker.

### 16. WebSocket scaling
socket.io rooms (e.g., `user:${id}`) work fine in-process. Cross-replica fanout requires a Redis adapter. Not needed for single-replica launch.

---

## Pre-Flight Checklist (run in this order)

```bash
# On a fresh box mirroring production:

# 1. Install + setup
git checkout claude/plan-features-audit-alcTm
./setup.sh

# 2. Verify env
grep -E '^(JWT_SECRET|ADMIN_PASSWORD|OPENAI_API_KEY|ALLOWED_ORIGINS)=' .env
# all four must be non-empty

# 3. Apply migrations (idempotent)
cd server && npm run migrate
npm run migrate:status   # confirm 082 + 083 + 081 + 080 + 079 + 078 applied

# 4. Run tests
npm test                 # all 9.7k must pass; new module tests should be added first
npm run lint
npm run check-deps       # validates emergent module dep graph

# 5. Frontend build
cd ../concord-frontend
npm run lint
npm run type-check
npm run build            # prophet-check then next build; build blockers exit 1

# 6. Pull models (if not already)
cd ..
./scripts/pull-models.sh
# Confirm: ollama list shows qwen2.5:14b, qwen2.5:7b, qwen2.5:3b, qwen2.5:0.5b, llava:7b, nomic-embed-text

# 7. Smoke test the four-brain wiring
curl http://localhost:11434/api/tags  # conscious
curl http://localhost:11435/api/tags  # subconscious
curl http://localhost:11436/api/tags  # utility
curl http://localhost:11437/api/tags  # repair

# 8. Boot stack
docker-compose up -d   # OR: pm2 start ecosystem.config.cjs
sleep 30

# 9. End-to-end smoke
curl https://localhost/api/world/clock | jq '.phase'           # heartbeat alive
curl https://localhost/api/creature/topologies | jq '.topologies'
curl https://localhost/api/world/weather/concordia | jq '.weather.type'
./scripts/health-check.sh
k6 run load-tests/smoke.k6.js

# 10. Backup round-trip
./scripts/db-backup.sh
./scripts/db-restore.sh ./backups/<latest>.db
# confirm restored DB boots without error in a staging container

# 11. Tag + deploy
git tag v1.0.0-rc1
git push origin v1.0.0-rc1
./scripts/deploy.sh production
```

---

## Honest Risk Summary

**What I'm confident in:**
- The Phases A–F2 code paths are syntactically clean (every module passed `node --check`).
- The route layout, three-gate permissions, and heartbeat invariants are preserved.
- The deployment infrastructure (Docker, k8s, scripts, monitoring) is unusually mature.
- The new endpoints follow existing conventions and degrade gracefully on missing deps.

**What I can't verify from this environment:**
- `npm test` passing for the 9.7k existing tests (no `node_modules` here).
- Frontend `tsc --noEmit` passing for the new components.
- Runtime behavior under real load.
- Whether `npm run check-deps` flags the new module imports.
- DNS / SSL / certificate posture for concord-os.org.

**The biggest deploy risk** is heartbeat fragility — the simulation depends on a single in-process tick loop, and the codebase has been adding tick blocks without a unifying try/catch helper. Before deploy: add `concord_heartbeat_ticks_total` Prometheus metric + alert (item 9) and the runHeartbeatModule helper (item 6). Those two changes give you the observability + safety net to run for weeks unattended.

**Second-biggest risk** is the SQLite single-writer ceiling (item 13). For a launch under ~50 concurrent users it's fine; capture metrics so you know when to migrate.

Everything else on the list is improvement, not a deploy-blocker.

---

## Recommended Sequence to Launch

1. **Today**: Write tests for the Phase F2 modules listed in gap 1; document new endpoints in API.md (gap 2); apply migrations on a staging copy of prod (gap 3).
2. **This week**: Add the heartbeat metric + helper (gaps 6, 9). Frontend build verification (gap 5). Backup round-trip (gap 10). Synthetic probes for new routes (gap 7).
3. **Pre-launch staging**: Run the full pre-flight checklist above. Fix anything red.
4. **Launch**: Tag, deploy, monitor closely for 72 hours. Watch the new Grafana panels (gap 8).
5. **Week 2**: Mobile secure storage if shipping mobile (gap 4). Decide on horizontal scaling story (gap 14). CDN plumbing if asset count spikes (gap 15).

You're closer to deploy-ready than the audit history suggests. The infrastructure work is done. What's missing is the verification + observability + new-module tests.
