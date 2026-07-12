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
- ~~**Team `role` (Belbin) / `demographics` fields** — the roster schema
  (`normEmployee` in `server/domains/organ.js`) has no `role` or
  `demographics` columns, so `teamComposition`'s Belbin-role-balance and
  Simpson's-diversity-index sections will always read as "not offered" when
  fed from the roster. Triaged **ENGINEERING** (two optional roster fields +
  two form inputs in `OrgDesigner`'s `EmployeeModal`) — small, real,
  deferred out of this pass's scope (the rebuild's defect was the panel
  being entirely dead, not this secondary richness gap).~~

  **CLOSED (2026-07-12, `a49fedf2`, Wave 4 gap-closure pass).** The
  deferred build shipped for real, using the exact field names
  `teamComposition`'s already-existing Belbin/Simpson's-diversity logic was
  already reading (`member.role` against a 9-entry lowercase-hyphenated
  Belbin set, `member.demographics[key]` as a categorical label) — verified
  by reading that computation before touching anything, so no field-name
  guessing:
  - `server/domains/organ.js` — `BELBIN_ROLES` hoisted to a shared
    module-level const (previously redeclared inline inside
    `teamComposition`) so `normEmployee` and `teamComposition` can't drift
    out of sync. `normEmployee` now normalizes an optional `role` (must
    match one of the 9 Belbin buckets or is dropped to `""`, same as
    unset) and an optional `demographics` bag via a new `normDemographics()`
    helper — trims/cleans each key+value string, caps at 8 keys, and omits
    the field entirely (not an empty object) when nothing was supplied, so
    old rosters round-trip byte-identical through `roster-set`/
    `roster-list`/`employee-upsert`.
  - `concord-frontend/components/organ/OrgDesigner.tsx` — `EmployeeModal`
    gained a "Team role (Belbin)" `<select>` (9 named options, matching the
    backend's exact lowercase-hyphenated values) and a "Demographics"
    section with two closed `<select>` dropdowns (Gender, Age band) rather
    than free text, so Simpson's diversity index groups real categories
    instead of fragmenting on typos/casing. Both pre-fill correctly when
    editing an existing employee. While touching this file, the pre-existing
    `Field`/new `SelectField` helpers were given proper `htmlFor`/`id`
    association (via `useId()`) for real accessibility + testability — they
    had none before.
  - `concord-frontend/app/lenses/organ/page.tsx` — `OrgAnalysisPanel`'s
    `runTeamComp` now forwards `role`/`demographics` from the live roster
    into the `teamComposition` macro call (previously only `name`/`skills`
    were mapped through, so even a roster with the fields set would never
    have reached the computation). `TeamCompResult` extended with the real
    `belbinRoleBalance`/`demographics` shapes, and the results panel now
    renders both sections — a real score/distribution/missing-roles list
    and a per-attribute diversity readout when data exists, or an honest
    "Not offered — no roster member has a Belbin team role/demographics
    set" line (not a silent no-op) when it doesn't.
  - Tests: `server/tests/depth/organ-behavior.test.js` gained 6 new
    behavioral cases (roster-set role normalization + invalid-role
    rejection, roster-list round-trip, employee-upsert create/update
    persistence, the 8-key demographics cap, the full roster→teamComposition
    pipeline producing a real non-zero Belbin score + diversity index, and
    a no-crash/all-zero degrade check for old rosters with neither field) —
    33/33 pass alongside the pre-existing 33/33 (no regressions).
    `concord-frontend/components/organ/OrgDesigner.employeeModal.test.tsx`
    (new, 3 tests) pins render of both new field groups, a full
    add-person → `employee-upsert` submit round-trip asserting the exact
    `role`/`demographics` payload shape, the backward-compatible
    both-fields-empty submit, and pre-fill on edit — 3/3 pass.

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

## Verification performed (Wave 4 gap-closure pass, 2026-07-12 — role/demographics)

- `node --check server/domains/organ.js` → OK.
- `cd server && npx eslint domains/organ.js tests/organ-domain-parity.test.js
  tests/depth/organ-behavior.test.js` → 0 problems.
- `DB_PATH=<isolated tmp path> NODE_ENV=test node --test --test-force-exit
  server/tests/organ-domain-parity.test.js` → 29/29 pass (no regressions —
  this file wasn't touched, re-run to confirm the pre-existing roster
  CRUD contract still holds against the changed `normEmployee`).
- `DB_PATH=<isolated tmp path> NODE_ENV=test node --test --test-force-exit
  server/tests/depth/organ-behavior.test.js` → 33/33 pass (27 pre-existing +
  6 new role/demographics cases).
- `cd concord-frontend && npx vitest run
  components/organ/OrgDesigner.employeeModal.test.tsx` → 3/3 pass.
- `cd concord-frontend && npx eslint components/organ/OrgDesigner.tsx
  components/organ/OrgDesigner.employeeModal.test.tsx
  app/lenses/organ/page.tsx` → 0 problems.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors, project-wide.
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
