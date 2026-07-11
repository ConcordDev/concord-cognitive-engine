# Ops Telemetry Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below has a reproduction command; every
> classification is backed by a full read of the file it's about.

**Scope note:** this lens is REST-route-based, not macro-based — it is a
Datadog/Grafana-shape operator dashboard, not a `POST /api/lens/run` lens.
The fabricated-success envelope bug (`{ok:true, result:<macro's own return>}`
always-true outer envelope) documented for macro lenses does not apply here:
every route this page calls returns its own flat `{ok, ...}` shape directly,
and the page correctly checks `x?.ok` per-fetch before using each payload.

## Backend surface — 7 real REST endpoints (5 documented + 2 undocumented bonus)

CLAUDE.md's "Admin telemetry surfaces" section names 5 endpoints. The page
actually calls **7** — 5 documented + `inference-costs` and `brain-activity`,
both real, both undocumented in CLAUDE.md (a doc-completeness gap, not a code
gap). All 7 traced to their real handlers in `server/server.js`:

| Route | Line | Auth gate | Backing fn |
|---|---:|---|---|
| `GET /api/admin/heartbeat-stats` | 50513 | `requireRole(owner,admin,sovereign,founder)` | `getHeartbeatTimingStats()` (`server/emergent/heartbeat-registry.js:217`) |
| `GET /api/admin/worker-stats` | 50578 | same | `getPoolStats()` ×2 (`workers/macro-pool.js:138`, `workers/heartbeat-pool.js:122`) |
| `GET /api/admin/brain-endpoints` | 53139 | same | `getEndpointStats()` (`lib/brain-config.js:315`) |
| `GET /api/admin/world-shards` | 53122 | same | `getShardHealth()` (`lib/world-shard-manager.js:315`) |
| `POST /api/admin/world-shards/:worldId/restart` | 53130 | same | `restartShard()` |
| `GET /api/admin/inference-costs?hours=24` | 50568 | same | `aggregateInferenceCosts()` (`lib/inference-metering.js:51`) |
| `GET /api/admin/brain-activity` | 53167 | same | inline read of live `BRAIN` object stats |

All 7 use the identical `requireRole("owner", "admin", "sovereign", "founder")`
gate — consistent auth story across the whole telemetry surface.

## Field-shape verification (every claim traced to the real handler source)

Read every handler function body (not just the route wrapper) and diffed
against the frontend's TypeScript interfaces:

- **`HeartbeatStatRow`** (`id, frequency, scope, serial, worker, sampleCount,
  p50, p90, p99, max, lastMs, lastAt, totalRuns`) — matches
  `getHeartbeatTimingStats()` field-for-field. The server already sorts by
  `p99` descending (`out.sort((a,b) => b.p99 - a.p99)`); the frontend comment
  "sorted by p99 (slowest first)" correctly describes server-side sort, not a
  client re-sort that doesn't exist.
- **`PoolStats`** (`poolSize, ready, busy, idle, queueLength, metrics{
  dispatched, completed, errors, timeouts?, queueHighWater, avgLatencyMs}`) —
  matches both `macro-pool.js#getPoolStats` and `heartbeat-pool.js#getPoolStats`
  exactly, including the optional `timeouts` field that only the heartbeat
  pool populates.
- **`BrainEndpointRow`/`BrainRow`** (`url, inflight, failures, lastHealthyAt`
  / `brain, model, maxConcurrent, endpoints`) — matches
  `brain-config.js#getEndpointStats()` + the route's `Object.entries(stats).map`
  composition exactly.
- **`WorldShardRow`** (`worldId, status, pid, startedAt, lastTickAt,
  lastTickCount, restartCount`) — matches `getShardHealth()`'s no-arg branch
  exactly (`pid: entry.worker?.threadId ?? null` — the frontend's `pid: number
  | null` type is correct).
- **Inference costs** (`calls, tokensIn, tokensOut, costLabel, byBrain`) —
  matches `aggregateInferenceCosts()` exactly, including the empty-window
  degrade (`{calls:0, tokensIn:0, tokensOut:0, byBrain:{}, costLabel:"$0"}`)
  that drives the honest "no inference recorded... living on instinct" copy
  instead of a fabricated zero-state.
- **Brain activity** (`brain, role, model, enabled, requests, errors,
  dtusGenerated, avgMs, idleSeconds`) — matches the inline handler exactly,
  including `idleSeconds: null` when a brain has never been called (frontend
  renders `'idle'` for that case, not a fabricated `0s ago`).

No field-shape mismatches found across all 7 endpoints — a rare fully-clean
result for this defect class.

## Fabrication check

```
grep -niE "Math\.random|mock|fake|lorem|hardcoded|dummy|sample data" \
  concord-frontend/app/lenses/ops-telemetry/page.tsx
```
→ zero hits. Every rendered number traces to a real field from one of the 7
endpoints above; every empty state (`no samples yet`, `no endpoints loaded`,
`no brain activity loaded`, `no shards spawned`, `pool stats unavailable`,
`living on instinct`) is an honest "backend returned nothing" render, not a
placeholder.

## Real defects found and fixed

1. **Wrong role list in the 403 admin-gate message.** `AdminRequiredState
   roles={['admin', 'operator']}` told a blocked user "ask an administrator
   for access" citing `operator` as a role that grants access. Grepped the
   entire backend (`server/migrations/*.js`, `server/lib/auth*.js`,
   `server/server.js`) for any assignment of `role = 'operator'` — zero hits.
   `operator` is not a real role value anywhere in the system; the actual
   gate on all 7 routes above is `requireRole("owner", "admin", "sovereign",
   "founder")`. A blocked user reading the old message would chase a role
   that can never work. Fixed to
   `roles={['owner', 'admin', 'sovereign', 'founder']}` — the literal set
   the backend accepts. (The same `['admin', 'operator']` copy-paste pattern
   exists in `psyops`, `ops`, and `crisis-ops` — out of scope for this unit,
   noted for whoever owns those lenses / a future sweep.)

2. **No discoverable keyboard shortcut** (`hasKeyboardHandlers` aside — that
   grader signal is about div-as-button a11y, not lens-level shortcuts, and
   this page correctly uses native `<button>`s throughout so that signal
   staying `false` is correct, not a gap). Per the fluidity invariant, a
   dashboard like this should have a fast-refresh shortcut discoverable via
   the command palette/help modal, matching the Grafana/Datadog convention.
   Added `useLensCommand([{ id: 'refresh', keys: 'r', description: 'Refresh
   telemetry now', category: 'actions', action: refresh }], { lensId:
   'ops-telemetry' })` plus a visible `<kbd>R</kbd>` chip next to the refresh
   button — registers in the command palette (per `useLensCommand`'s
   contract) and is visually discoverable without reading source.

3. **Silent truncation on the heartbeat table.** `hbStats.slice(0, 80)` caps
   the table at 80 rows with no indicator, and the live heartbeat registry
   has ~127 modules (per CLAUDE.md's `registerHeartbeat` count). Because the
   server pre-sorts by `p99` descending, the truncation itself is the right
   design call (slowest-first triage, like Datadog's top-N views) — but
   silently dropping ~47 rows with zero on-screen indication is a minor
   honesty gap (an operator scanning for a specific module by name could
   wrongly conclude it doesn't exist). Added a conditional caption: "showing
   the 80 slowest of {n} modules by p99 — the rest are faster and less
   actionable", shown only when `hbStats.length > 80`.

## Real findings documented, not fixed (with reasoning)

- **`/api/admin/liveness` (mounted via `LivenessPanel`, first panel on the
  page) uses `requireAuth()` only — not `requireRole(...)`** — every other
  `/api/admin/*` route on this exact page uses the owner/admin/sovereign/
  founder role gate. `server/routes/helpers-extended.js:299`'s own comment
  frames it as "Auth-gated, observe-only" (deliberately, by the look of the
  comment, distinct from "admin-gated"), and the aggregate business metrics
  it returns (records-living, conversion rate, K-factor, economy solvency)
  carry no PII. This reads like an intentional, lower-sensitivity tier
  rather than an oversight, but it IS inconsistent with the rest of the
  page's uniform role gate, and it means any logged-in user (not just
  owner/admin/sovereign/founder) can `curl` this specific operator metric
  even though the ops-telemetry *page* itself gates its whole render behind
  the heartbeat-stats 403 check. **Triage: ENGINEERING**, deferred — an
  auth-level change on a shared route file is a security-relevant edit that
  deserves dedicated review outside a single-lens rebuild pass, not a
  same-diff fix.
- **Inference-cost metering has narrow coverage.** `aggregateInferenceCosts()`
  reads real DB rows and the field shapes are correct, but only 3 call sites
  in the whole codebase (`lib/oracle-brain.js`, `lib/chat-agent.js`,
  `routes/worlds.js`) call `recordInferenceSpan()` to write those rows,
  against ~36 files that make LLM calls via `ctx.llm.chat()`/`BRAIN.*`
  patterns. The panel is honest (it shows exactly what was recorded, with a
  correct "living on instinct" empty-state instead of fabricating a number),
  but the 24h "cost story" is a real undercount of total inference activity
  platform-wide. **Triage: ENGINEERING** (route more LLM call sites through
  `recordInferenceSpan`), deferred — this is a cross-cutting change to ~30+
  files outside ops-telemetry's own boundary, not a lens-page defect.
- **Two independent unjittered 5s timers on one page.** `page.tsx` runs one
  `setInterval(refresh, 5000)` that batches all 7 telemetry fetches via
  `Promise.all` (a correctly-designed single timer for the page's own data).
  `LivenessPanel.tsx` (mounted as the first panel) manages its **own**
  separate `setInterval(refresh, 5000)` for `/api/admin/liveness`. This is
  the exact "independent unjittered polling timer" pattern called out
  platform-wide, but scoped to 2 timers on this page (not the more severe
  5-separate-timers anti-pattern) — both fire close to simultaneously on
  mount, causing a minor thundering-herd of ~8 concurrent fetches every 5s
  instead of a staggered/deduped one. `LivenessPanel` is only imported by
  `ops-telemetry` (verified: `grep -rl LivenessPanel concord-frontend --include='*.tsx'`
  → only this page + its own test + `ops-telemetry-lens-states.test.tsx`), so
  a fix would be page-local, but per this Wave's explicit instruction the
  platform-wide polling-jitter fix is tracked separately as a Wave 4 item —
  not fixed here, flagged as a concrete contributing data point for that
  pass (specific file: `concord-frontend/components/admin/LivenessPanel.tsx`
  lines 67-72).
- **`/api/worlds/:worldId/health`, listed in CLAUDE.md's "Admin telemetry
  surfaces" alongside the other 5, is NOT called by this page.** Traced its
  real consumer: `concord-frontend/components/hud/ShardHealthBadge.tsx`, a
  public-read per-world corner badge mounted elsewhere (the world HUD), not
  ops-telemetry. This is correct design — the health endpoint is explicitly
  "public-safe" (per its own route comment) for a per-world player-facing
  badge, while ops-telemetry is the cross-world admin-only aggregate view
  via `/api/admin/world-shards`. CLAUDE.md's "Lens: `/lenses/ops-telemetry`
  mounts all of the above" is a minor doc-precision overstatement (the
  per-world health route isn't literally imported into this page) rather
  than a lens defect — not fixed here (doc correction, not lens code).

## What changed

- `concord-frontend/app/lenses/ops-telemetry/page.tsx` — 3 fixes above
  (role-list correction, discoverable `R` refresh shortcut via
  `useLensCommand` + visible kbd chip, truncation-indicator caption).
- `concord-frontend/tests/ops-telemetry-lens-states.test.tsx` — added
  `vi.mock('@/hooks/useLensCommand', ...)` (the established pattern used by
  `retail-lens-states.test.tsx` and 4+ other `*-lens-states` tests) so the
  focused state-machine test doesn't need a `KeyboardProvider` ancestor.

## Verification

- `cd concord-frontend && npx eslint app/lenses/ops-telemetry/page.tsx
  tests/ops-telemetry-lens-states.test.tsx` → clean, zero output.
- `cd concord-frontend && npx vitest run tests/ops-telemetry-lens-states.test.tsx
  tests/liveness-panel.test.tsx` → **10/10 pass** (7 + 3), 0 fail.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — unchanged, ops-telemetry counted WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → ops-telemetry
  `tier: "polished"`, `isGenericScaffold: false`, `antiPatterns: 0` — held
  before and after the fix (`audit/ux-polish-honest*` reverted via
  `git checkout -- audit/` after each read, per repo convention).
- No backend file was touched (this unit's defects were all frontend-side);
  `node --check` was not needed. Read (not modified) `server/server.js`
  lines 50510-50629 and 53095-53193, plus
  `server/emergent/heartbeat-registry.js`, `server/workers/macro-pool.js`,
  `server/workers/heartbeat-pool.js`, `server/lib/brain-config.js`,
  `server/lib/world-shard-manager.js`, `server/lib/inference-metering.js` to
  verify field shapes.
- `npx tsc --noEmit` was intentionally NOT run per this Wave's standing rule
  (a prior parallel batch OOM'd the container on it). Manual review of the
  new `useLensCommand` call against `hooks/useLensCommand.ts`'s exported
  `LensCommand` interface (`id, keys, description, category?, action,
  enabled?, global?`) confirms the added command object matches the type
  shape used elsewhere (e.g. `app/lenses/admin/page.tsx`).

## Left alone, with reason

- All 7 endpoint field shapes — already correct, no changes needed.
- `LivenessPanel`'s independent timer, the `/api/admin/liveness` auth-level
  inconsistency, and the narrow `recordInferenceSpan` coverage — real
  findings, each triaged and deferred with reasoning above (Wave 4 /
  cross-cutting / dedicated-security-review scope respectively, not
  ops-telemetry-page defects).
- The `['admin', 'operator']` role-list bug also exists in `psyops`, `ops`,
  and `crisis-ops` — left alone (different lenses, different task boundary).

## Genuinely missing

None within the ops-telemetry page's own scope. The three defects found were
all small, real, and fixed in this pass; the remaining findings are
cross-cutting backend/infra items correctly triaged to ENGINEERING and
deferred rather than silently left undocumented.
