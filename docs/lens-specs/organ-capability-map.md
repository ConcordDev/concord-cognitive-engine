# organ — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("organ"' server/domains/organ.js` → 17

## What "organ" actually is

The name is a three-way pun and the page had drifted into presenting only
one of the three meanings honestly:

1. **Organizational design** (the real, primary meaning — `lensNumber: 105`,
   category `SPECIALIZED_EXT`, features `org_design` / `process_mapping` /
   `team_optimization` / `role_access_templates` per
   `server/lib/lens-features-extended.js:725`). Reference app: **ChartHop**
   (org charts, headcount planning, comp analytics, HRIS import). Covered by
   `components/organ/OrgDesigner.tsx` (1,019 LOC) — real, well-built, and
   already correctly wired to the 14 STATE-backed roster/scenario/snapshot
   macros in `server/domains/organ.js`. No changes needed here.
2. **Biological anatomy reference** — a small, honest Wikipedia REST lookup
   tool (`components/organ/AnatomyExplorer.tsx`, 56 LOC). Real external API,
   honest loading/error states, save-as-DTU. No changes needed.
3. **Concord's own self-model** — `server/server.js`'s `ORGAN_DEFS` registry
   of ~169 named cognitive-architecture "organs" (`session_memory`,
   `psychological_os`, `council_engine`, `goal_os`, `repair_cortex`, …),
   each with a live maturity/wear/plasticity state updated every governor
   heartbeat via `kernelTick()`. This is a genuinely novel, unique
   introspection surface — nothing else in the industry maps to it directly;
   treat it as "Concord's own internal status board." **This was the broken
   part of the page** (see below).

## Findings

### Top-of-page "organism health" dashboard — 100% dead, wrong endpoints (fixed)

`OrganLensPage` queried `GET /api/status` and `GET /api/system/health` for
an `organs` / `organRegistry` field and rendered ~500 lines of grid/timeline/
dependency-graph/bio-age UI against it. Neither endpoint has ever returned
such a field — confirmed by reading both handlers
(`server/routes/system.js:337` and `server.js:47636`). `statusData?.organs`
was `undefined` on every load, so `organs` was always `[]`: every stat card
showed 0, the grid/timeline always rendered their empty state, and the
"Organism Bio-Age" indicator computed a fabricated number
(`Math.floor(avgHealth * 400)` where `avgHealth` was always `0`, i.e. always
"0 years").

The real data exists and is rich: `GET /api/organs`
(`server/routes/operations.js:40`) and the fuller `GET /api/growth/organs`
(`server.js:54495`) both return live `STATE.organs` — objects shaped
`{ organId, status, resolution, maturity: {score, confidence, stability,
plasticity, lastUpdateAt}, wear: {damage, repair, debt}, deps, desc }` (see
`_defaultOrganState` / `ORGAN_DEFS`, `server.js:64013-64245`). A parallel
`GET /api/growth/status` (`server.js:54491`) returns the organism-level
Growth OS vector: `bioAge` (a real, server-computed 0–100 decline index —
NOT the fabricated one the old page invented), `homeostasis`, `telomere`,
`epigeneticClock`, `stress: {acute, chronic}`, `functionalDecline`.

**Fix:** rewrote the dashboard to query `/api/growth/organs` +
`/api/growth/status` and to read the real nested field shapes (`maturity`
and `wear` are objects, not flat numbers; `deps` not `dependencies`;
`organId`/`desc` not `name`). Health per organ is now
`clamp(maturity.score - wear.damage, 0, 1)`, matching the concept the
original UI already had but pointing it at data that exists. The Bio-Age
section now shows the real `bioAge` index plus homeostasis/telomere/
epigenetic-clock/chronic-stress gauges, honestly labeled as an index, not a
literal age.

### "Tick" button + "Trigger Repair Cycle" modal — fabricated action (fixed)

The "Tick" button called `apiHelpers.bridge.heartbeatTick()`, which POSTs
`{domain:'emergent', name:'bridge.heartbeatTick'}` — the **world-simulation**
heartbeat bridge (`server.js:11154`), unrelated to the organ registry. The
"Trigger Repair Cycle" confirmation modal fired the same mutation. Neither
button had any effect on organ maturity/wear. Grepping for a real
per-organ or global-kernel-tick mutation endpoint found none: `kernelTick()`
(`server.js:70211`) is invoked only internally — once per governor heartbeat
(`server.js:34917`) and on a few specific system events (goal completion,
optional cron) — never via any macro or HTTP route reachable from the
frontend.

**Fix:** removed both fake actions. Replaced with an honest static note
("organs self-update every governor heartbeat (~15s); this is a read-only
introspection view, not a control panel") plus a real `refetch()` button
that just re-polls the live state (already existed, kept).

### Bottom "Org Analysis" panel — real macros, disconnected data path (fixed)

The panel used the *generic* lens-artifact CRUD system
(`useLensData('organ','employee',{noSeed:true})` + `useRunArtifact('organ')`,
backed by `GET/POST /api/lens/:domain[/:id]` and `STATE.lensArtifacts`) to
find an "employee"-typed artifact and run `orgChart` / `teamComposition` /
`communicationFlow` against it. Nothing anywhere creates such an artifact —
there is no "add employee data" UI reachable from this panel, and even if
there were, a single generic artifact can't hold the three different data
shapes (`employees[]`, `team[]`, `communications[]`) the three macros
respectively need. Clicking any of the three buttons always fell through to
"No org data found. Add employee data first." — a permanently dead panel
sitting beside three genuinely real, well-implemented deterministic
graph-theory macros (span-of-control/bottleneck detection, Shannon-entropy
skill-diversity + Belbin-role balance, directed-graph density/reciprocity/
betweenness-centrality silo detection — all in `server/domains/organ.js`).

The fix does not need the generic artifact store at all: `POST
/api/lens/run` (`server.js:39529`, the same endpoint `lensRun()` already
uses for OrgDesigner) builds each macro's `artifact.data` directly from the
`input` object passed in the request — no persisted artifact required.

**Fix:** the panel now calls `organ.roster-list` to get the live roster
(the same STATE-backed roster OrgDesigner edits above it) and passes it
straight into `orgChart` (`{ employees }`) and `teamComposition`
(`{ team: employees.map(e => ({name, skills})) }`) via `lensRun()`.
`communicationFlow` has no real interaction-log substrate anywhere in
Concord (no message/chat log keyed to the org roster) — rather than fake
one, the panel now honestly asks the user to paste their own
`from,to,channel,weight` log (mirroring the existing HRIS-CSV-paste pattern
already established in `OrgDesigner`'s Import tab) before running the real
graph macro against it.

## Triage: is anything still genuinely missing?

- **Communication-flow data source** — triaged **DATA-SOURCING, but
  correctly deferred as N/A.** Internal company communication logs (Slack/
  email exports) are inherently private, per-org data with no free public
  API to source from generically — unlike CPSC recalls or CoinGecko, there
  is no honest external feed for "this company's Slack history." The
  correct, honest disposition is what's shipped: a real macro, fed by
  user-supplied paste, same shape as any real network-analysis tool (Culture
  Amp / Microsoft Viva Insights) that requires an imported log. Not a gap to
  close later — this is the correct permanent shape.
- **Team `role` (Belbin) / `demographics` fields** — the roster schema
  (`normEmployee` in `server/domains/organ.js`) has no `role` or
  `demographics` columns, so `teamComposition`'s Belbin-role-balance and
  Simpson's-diversity-index sections will always read as "not offered" when
  fed from the roster. Triaged **ENGINEERING** (two optional roster fields +
  two form inputs in `OrgDesigner`'s `EmployeeModal`) — small, real,
  deferred out of this pass's scope (the rebuild's defect was the panel
  being entirely dead, not this secondary richness gap).

## Verification performed

- `node --test server/tests/organ-domain-parity.test.js` → 29/29 pass (no
  backend files touched; run to confirm the field shapes this fix now relies
  on are exactly what the handlers expect).
- `node --test --test-force-exit server/tests/depth/organ-behavior.test.js`
  → 1/1 pass.
- `npx eslint app/lenses/organ/page.tsx` → 0 problems.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 (unchanged; organ was already WIRED and remains so).
- `node scripts/grade-ux-polish.mjs --honest` → organ entry:
  `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.559`
  (`bespokeComponentLoc: 1077` across `OrgDesigner.tsx` +
  `AnatomyExplorer.tsx`, unaffected by this pass since neither was touched).
