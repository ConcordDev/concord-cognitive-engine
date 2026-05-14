# Production Hardening Checklist

This document is the pre-deploy checklist for shipping a Concord instance to a real network with real users. Run through it the day before deployment.

---

## Secrets

- [ ] `JWT_SECRET` set in production (not auto-generated). Without it, sessions don't survive restart and the auto-warn fires.
- [ ] `CONCORD_FEDERATION_TOKEN` set if the instance will accept inbound federation reads.
- [ ] No secrets committed to the repo. `git log --all -p | grep -iE "key|secret|token"` returns nothing surprising.
- [ ] Database file (`server/data/concord.db`) backed up before deploy.

## Heap & Performance

- [ ] `MAX_OLD_SPACE_SIZE=32768` (or matched to box memory).
- [ ] Node started with `--max-old-space-size=32768` (must match the env var; the watchdog reads the env var).
- [ ] `npm run smoke` passes against a staging copy of production data.
- [ ] Synthetic load test (`monitoring/synthetic/load-test.js`) at 50 users × 1 rps × 60s passes p95 < 2s, error rate < 5%.
- [ ] During the load test, `concord_heartbeat_skipped_total` rate stays at 0. If it spikes, you have a tick-budget problem; investigate before deploy.

## Caps (verify defaults match your traffic)

- [ ] `CONCORD_MAX_SHADOWS` (default 50,000) appropriate for expected DTU corpus size.
- [ ] `CONCORD_LLM_QUEUE_DEPTH` (default 1,000) matches expected concurrent prompt traffic.
- [ ] `CONCORD_DOWNLOADS_PER_USER` (default 25) matches expected per-user concurrent download cap.
- [ ] If user count > 50, raise `CONCORD_DIALOGUE_MAX_CONCURRENT` (default 50) accordingly.

## LLM Brains

- [ ] All 5 Ollama services running (ports 11434, 11435, 11436, 11437, 11438).
- [ ] `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` set on every brain.
- [ ] Models pulled and cached (first run will pull ~70GB total — pre-cache for production).
- [ ] `initFiveBrains()` succeeds at startup; check logs for `BRAIN_PROBE_OK` × 5.

## Database

- [ ] All migrations applied: `npm run migrate:status` shows latest = 192 (`192_foundry_phase7.js`).
- [ ] `better-sqlite3` build is current (rebuilds happen automatically; verify after Node version changes).
- [ ] WAL mode enabled (default, but verify: `PRAGMA journal_mode;` returns `wal`).
- [ ] Daily backup script wired (cron + the existing backup-restore round-trip test confirms recovery).

## Observability

- [ ] Prometheus scraping `/metrics` (default port 5050).
- [ ] Alerts loaded: `monitoring/prometheus/alerts.yml`. Verify `ConcordHeartbeatStopped` and `ConcordHeartbeatOverrun` are active.
- [ ] Grafana dashboards imported:
  - `monitoring/grafana/dashboards/concord-overview.json` (request latency, throughput)
  - `monitoring/grafana/dashboards/concord-phases-1-6.json` (substrate health: heartbeats, beats, economy flows, drift→quest+region, deaths, seasons, claims, discovery latency)
- [ ] Alert webhook configured (PagerDuty / Slack / Discord) — verify by triggering the synthetic monitor's failure path.

## Rate Limiting

- [ ] Phase 1-6 macros all in `EXPENSIVE_MACROS` map (`server.js:1152`):
  - `skill_evolution.commit`, `knowledge_trade.{mentorship_request, complete_session, witness}`,
    `beats.realise`, `land_claims.{claim, invite, topup}`, `glyph_spells.{mint, preview}`,
    `forge_marketplace.{mint, list}`, `dtu_portability.{export, import}`,
    `discovery.{search, facets, trending}`.
- [ ] Verify rate limits empirically by exceeding one in staging. Server should return 429.

## Federation

- [ ] If federating, peer list configured.
- [ ] `CONCORD_FEDERATION_TOKEN` rotated before going live.
- [ ] Inbound federation requests authenticated.
- [ ] `concord_federation_imports_total` metric visible in Grafana to confirm bidirectional traffic.

## Three-Gate Permission System

- [ ] All Phase 1-6 macro domains have `publicReadDomains` entries in `server.js`. Confirmed in this branch:
  - `skill_evolution`, `knowledge_trade`, `beats`, `land_claims`, `glyph_spells`,
    `forge_marketplace`, `dtu_portability`, `discovery`.
- [ ] `_safeReadPaths` reviewed for each new endpoint added since last deploy.
- [ ] `authMiddleware` `publicReadPaths` audited: nothing accidentally public.

## Test Suite

- [ ] `npm test` passes. Current pre-deploy state should be 250+ Tier-2 tests + 4 Tier-3 E2E.
- [ ] `node scripts/run-detectors.js --diff` shows 0 critical / 0 high / 0 medium added vs baseline.
- [ ] `npm run check-deps` passes (no circular dependencies).

## First-Hour Onboarding

- [ ] `tests/e2e/first-cycle-journey.test.js` passes against a clean DB.
- [ ] Landing page reachable at `/`.
- [ ] Register flow → `/onboarding` → `FirstWinWizard` mounted in `AppShell.tsx`.

## Rollback Plan

- [ ] Previous deploy's git tag identified. Rollback is `git checkout <tag> && npm start`.
- [ ] DB backup taken immediately before deploy.
- [ ] Migrations are append-only, but if a migration introduces a CHECK constraint that production data violates, document the rollback DDL.

---

## During / After Deploy

- [ ] Watch `concord_heartbeat_ticks_total` rate for 10 minutes. Should hold ~0.067 Hz (1 tick / 15s).
- [ ] Watch `concord_heartbeat_skipped_total` rate for 10 minutes. Should be 0.
- [ ] Watch HTTP error rate for 10 minutes. Should be < 1% steady state.
- [ ] Run synthetic monitor (`run.sh`) once and confirm all critical paths green.
- [ ] Open Grafana → Concord Phases 1-6 dashboard → confirm heartbeats firing for: `npc-routine-cycle` (5), `npc-economy-cycle` (8), `personal-beat-scheduler` (60), `npc-marketplace-cycle` (240), `lattice-quest-cycle` (180), `season-cycle` (480), `land-claims-cycle` (240).
