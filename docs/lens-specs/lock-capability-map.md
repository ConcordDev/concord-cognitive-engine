# Lock Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

**Scope note:** the task brief flagged the "lock" name as ambiguous
(distributed-locking? Concordia's `world-crime.js` lockpicking?). Verified
from real source: `server/domains/lock.js` is a **JFR-style concurrency
lock profiler** — deadlock detection (wait-for graph cycle detection),
contention analysis, Jain's-index fairness scoring, a per-user lock-trace
recorder, live hold-timeline reconstruction, lock-ordering
inversion/pre-deadlock detection, contention-hotspot ranking, stack-trace
blame attribution, and Amdahl/USL throughput projection. It has **nothing**
to do with Concordia's `world-crime.js#attemptLockpick` (a gameplay skill
check on a different system entirely) or a `security`/`sentinel`-style
admin tool (a different Wave 3 unit).

The frontend page (`app/lenses/lock/page.tsx`, 827 lines pre-fix) is a
**composite of two unrelated concepts sharing one URL**:
1. **"70% Sovereignty Lock"** — a Concord governance/ethos-invariant
   dashboard (data-locality, no-telemetry, no-ads, etc.), backed by
   `GET/POST /api/sovereignty/*` (a completely separate REST surface, not
   the `lock.js` macro domain).
2. **"Concurrency Lock Profiler"** — the real `lock.js` domain macros,
   surfaced through `components/lock/LockProfiler.tsx`.

Both are real, live features; they are just two different products stacked
on the same lens by history, not a fabrication issue. This map covers both.

## Backend surface

```
grep -c 'registerLensAction("lock"' server/domains/lock.js
```
→ **10** macros in `server/domains/lock.js` (869 lines):
- `deadlockDetect` — DFS cycle detection over a caller-supplied wait-for graph.
- `contentionAnalysis` — per-resource contention ratio, hot-lock scoring,
  granularity-change suggestions (split_lock / reader_writer_lock /
  reduce_critical_section / monitor).
- `fairnessScore` — Jain's fairness index, starvation detection (>3× mean
  wait), per-resource fairness.
- `recordLockEvent` / `clearLockTrace` — a per-user in-memory lock-trace
  buffer (`globalThis._concordSTATE.lockLens.traces`, capped at 5000
  events/user).
- `holdTimeline` — pairs acquire→release events into hold spans per
  (thread, lock); open acquires stay "still held" to window end.
- `orderingAnalysis` — per-thread lock-acquisition-order graph; detects both
  direct A⇄B inversions and indirect ordering cycles via DFS.
- `hotspotRanking` — ranks locks by total accumulated wait time.
- `blameAttribution` — attributes wait/hold time to the top stack frame of
  captured call stacks.
- `amdahlProjection` — derives serial fraction from the recorded trace (or
  an explicit param), projects Amdahl + Universal Scalability Law speedup
  curves across processor counts.

Plus the separate `/api/sovereignty/*` REST surface (not macro-routed):
`GET /api/sovereignty/status`, `POST /api/sovereignty/audit`,
`POST /api/sovereignty/setup`, `PUT /api/sovereignty/preferences`,
`POST /api/sovereignty/unsync` — all in `server.js`.

## Frontend surface

- `app/lenses/lock/page.tsx` — page shell; mounts the sovereignty dashboard
  stack (`use70Lock`, `SovereigntyDashboard`, `SovereigntySetup`,
  `SovereigntyPrompt`, `LockDashboard`) plus the profiler
  (`LockProfiler`) plus a real-world reference panel (`SecurityRepos`,
  live GitHub topic search — `security`/`encryption`/`cryptography`/etc.).
- `components/lock/LockProfiler.tsx` (~1064 lines) — the concurrency
  profiler: a trace recorder (manual event form + a realistic "sample
  scenario" seeder with a deliberate lock-ordering inversion) and 6 tabs
  (Hold Timeline swimlane Gantt, Contention Hotspots bar chart, Lock
  Ordering precedence tree, Wait-For Graph / deadlock, Blame Attribution,
  Amdahl/USL projection table+chart). Covers all 10 `lock.js` macros.
- `components/lock/SecurityRepos.tsx` — live GitHub repo search
  (`api.github.com/search/repositories`), honestly labeled, real
  loading/error states, `SaveAsDtuButton` to pipe results into the DTU
  substrate. Not part of `lock.js`; a reference/discovery panel.
- `components/sovereignty/{SovereigntyDashboard,SovereigntySetup,
  SovereigntyPrompt,LockDashboard}.tsx` — the sovereignty-percentage /
  ethos-invariant UI, all reading `GET /api/sovereignty/status`.
- `hooks/use70Lock.ts` — the shared hook wrapping `/api/sovereignty/status`
  + `/api/sovereignty/audit`. Also consumed outside this lens by
  `components/home/HomeClient.tsx` (dashboard) and
  `components/live/HeartbeatBar.tsx` (the always-on top bar).

## Verification of macro coverage

```
node scripts/lens-unsurfaced.mjs --lens lock
```
→ `lock: 0/10 macros never referenced in the frontend`

## Classification

All 10 `lock.js` macros are **DESIGNED** — reached through
`LockProfiler.tsx`'s bespoke swimlane Gantt / precedence tree / wait-for
graph / blame ranking / Amdahl chart UI, not a generic macro-button wall.
The sovereignty surface (`SovereigntyDashboard`, `LockDashboard`,
`SovereigntySetup`) is also DESIGNED — real forms, real consent-mode
picker, real unsync flow — reached through `/api/sovereignty/*`, not
macro-routed at all.

`node scripts/grade-ux-polish.mjs --honest` (`audit/` reverted via
`git checkout` after reading, per repo convention):
```
{"lens":"lock","tier":"polished","fileCount":3,"totalLoc":1960,
 "pageLoc":827,"bespokeComponentLoc":1133,"maxBespokeComponentLoc":1064,
 "bespokeRatio":0.578,"importsGenericTrio":true,"usesGenericBody":true,
 "hasMacroButtonWall":true,"hasInlineActionWall":true,"hasLoading":true,
 "hasEmptyState":true,"hasErrorUI":true,"hasAria":true,
 "hasNativeButtons":true,"hasKeyboardHandlers":false,"hasResponsive":true,
 "hasAnimation":true,"hasToasts":false,"hasAltOnImages":true,
 "divAsButtons":0,"inlineHex":0,"pillarsPresent":5,"antiPatterns":0,
 "isGenericScaffold":false,"honestCapped":false}
```
`tier: "polished"`, `isGenericScaffold: false` despite `importsGenericTrio`/
`usesGenericBody` reading `true` — the grader's bespoke-ratio (0.578) and
pillar count (5/5) correctly recognize `LockProfiler.tsx` (1064 LOC) as
substantial bespoke work sitting alongside the manifest scaffolding, not a
substitute for it.

`hasKeyboardHandlers: false` is a grader false-negative, not a real gap:
the page registers 3 real shortcuts via `useLensCommand` (`s` open
sovereignty setup, `esc` close it, `f` toggle the features panel) — the
grader's text match looks for raw `onKeyDown`, which this idiom correctly
doesn't use (shortcuts are discoverable through the command palette per
`docs/UI_QUALITY_RUBRIC.md` §2, not a bespoke listener).

## Defects found and fixed

### 1. `use70Lock.ts` field-shape mismatch (the #1 recurring bug class)

`hooks/use70Lock.ts` read `status?.lockPercentage` / `status?.invariants` /
`status?.lastAudit` / `status?.isHealthy` from `GET /api/sovereignty/status`.
The real handler (`server.js`, the `/api/sovereignty/status` route) returns
`sovereigntyPct` (not `lockPercentage`) and **never returned an `invariants`
field at all**. Confirmed by cross-reading `components/sovereignty/
SovereigntyDashboard.tsx`, which reads the same endpoint correctly via
`status.sovereigntyPct`.

Effect: `lockPercentage` was **always 0%** and `invariants` was **always an
empty array**, everywhere `use70Lock()` is used — not just this lens, but
also the Home dashboard (`components/home/HomeClient.tsx`) and the
always-visible top `HeartbeatBar.tsx`. On this lens specifically: the
header's "70%" gauge, the lock-state badge, the "Active Invariants" grid,
the "Invariant Enforcement" panel, and `LockDashboard`'s ethos-invariant
list all rendered as permanently empty/zero, despite a real, working
backend endpoint one field-rename away.

**Fix (`concord-frontend/hooks/use70Lock.ts`):** corrected the response
type to the real shape and read `sovereigntyPct` everywhere the hook
previously read `lockPercentage`. `DEFAULT_INVARIANTS` (a fabricated
7-entry list that didn't match any real invariant set — includes
`NO_RESALE`/`OWNER_CONTROL`/`TRANSPARENT_OPS`/`NO_DARK_PATTERNS`, none of
which exist server-side) is left in place only as an exported constant for
its own pinning test; it was never wired into the hook's live return value
and still isn't — the real invariants below replace it.

**Fix (`server/server.js`, `/api/sovereignty/status`):** the frontend's
`invariants` concept had no real backend source at all — the closest real
analog is `ETHOS_INVARIANTS` (`server.js:2852`), a frozen, actively-enforced
constant (`enforceEthosInvariant` throws on 4 of its 9 entries; a 5th gates
cloud-LLM opt-in). This is an **ENGINEERING** fix per the "closing the hard
20%" triage (no external data dependency, just wiring already-real server
state into the response) — added `ethosInvariantsList()` (derives the
`Invariant[]` shape the frontend expects from `ETHOS_INVARIANTS` +
`ETHOS_INVARIANT_DESCRIPTIONS`) and wired `invariants` +
`isHealthy` into the route's JSON response. All 9 entries report
`status: "enforced"` by construction (the source is `Object.freeze`d
`true`/`true`) — there's no partial/violated runtime state to report here,
so this doesn't fabricate a false "all green"; it honestly reflects that
these are compile-time-frozen guarantees, not a live health check.

### 2. Audit pass/fail signal never actually reflects the audit result

`app/lenses/lock/page.tsx`'s `runAudit` mutation read `data?.ok` to decide
whether to log "Audit passed" or "Audit failed" into lock history. Traced
`POST /api/sovereignty/audit`'s real handler: there is **no `audit.run`
macro registered anywhere** (`grep -n 'register("audit"' server.js
server/domains/audit.js` shows only `audit.query` plus the unrelated
`complianceCheck`/`trailAnalysis`/`riskScore`/etc., registered via
`registerLensAction` under a different dispatch map — `audit.run` doesn't
exist under either). The internal `runMacro()` function throws
`Error("macro not found: audit.run")` on every call (verified by reading
the dispatcher's own `if (!m) throw ...` at the domain/name lookup), which
lands in the route's `catch` block every time. That catch block returns
`{ ok: true, audit: { passed: checks.every(...), checks, error } }` — note
**`ok: true` is hardcoded at the top level regardless of whether the
individual checks passed**. So `data?.ok` was always `true`, meaning the
lock lens logged **"Audit passed" on literally every audit run, even when
one or more real invariant checks (`data_locality`/`no_telemetry`/
`cloud_opt_in`/`encryption_at_rest`) had actually failed** — a permanent
false positive baked into the user-facing history, the opposite failure
mode from what a naive read of the code suggests.

**Fix (`concord-frontend/app/lenses/lock/page.tsx`):** `runAudit.onSuccess`
now reads the real signal, `data.audit.passed`, and lists which named
checks failed when it's false, instead of the always-`true` top-level
`ok`. No backend change was needed or made here — the backend's `ok: true`
wrapper is intentional and correct for "the HTTP call succeeded"; the bug
was purely in the frontend reading the wrong field for "did the audit
pass."

**Note on a first, reverted attempt:** an earlier pass at this fix assumed
`runMacro()` fails open (`{ok:false}`, no throw) based on this file's own
"unknown-macro fail-fast" invariant documented elsewhere in `CLAUDE.md` —
that invariant describes the **separate** `/api/lens/run` HTTP dispatch
path (`server.js:39661`), not the plain `runMacro()` function this route
calls directly, which does throw (`server.js:11724-11725`). Caught by
re-reading the actual dispatcher body before committing rather than trusting
the by-name resemblance; the incorrect edit was reverted before commit (see
"How we work here" §1 — verify at the source, not by pattern-matching a
doc's framing onto a different code path).

## Fabrication check

```
grep -niE "Math\.random|mock|fake|lorem|hardcoded|dummy|sample data|TODO|FIXME|stub" \
  components/lock/*.tsx components/sovereignty/*.tsx app/lenses/lock/page.tsx hooks/use70Lock.ts
```
No fabrication signatures in rendered paths. `LockProfiler.tsx`'s "Record
Sample Scenario" button is an explicitly-labeled, user-triggered synthetic
trace generator for demoing the profiler on a fresh account with no real
lock activity yet (it calls the real `recordLockEvent` macro per event, so
the resulting analysis is genuinely computed, not pre-baked) — not
auto-rendered fake data.

## What changed

- `concord-frontend/hooks/use70Lock.ts` — field-shape fix (`sovereigntyPct`
  not `lockPercentage`), corrected response type.
- `concord-frontend/tests/hooks/use70Lock.test.ts` — updated mocks to the
  real backend field name (they mocked the fabricated `lockPercentage` key
  before; still test the hook's own `lockPercentage` *return* field, which
  is unchanged).
- `concord-frontend/app/lenses/lock/page.tsx` — `runAudit` reads the real
  `data.audit.passed` signal instead of the always-true `data.ok`.
- `server/server.js` — `GET /api/sovereignty/status` now returns a real
  `invariants` array (from `ETHOS_INVARIANTS`) and `isHealthy`; added
  `ETHOS_INVARIANT_DESCRIPTIONS` + `ethosInvariantsList()` helper next to
  the existing `ETHOS_INVARIANTS` declaration. `POST /api/sovereignty/audit`
  is unchanged (a fix attempt was made and reverted — see above).

## Verification

- `node --check server/server.js` → clean.
- `cd server && node --test tests/lock-domain-parity.test.js` → **23/23
  pass** (unmodified; confirms the 10 `lock.js` macros are unaffected by
  this pass).
- `cd server && node --test tests/sovereignty-invariants.test.js` →
  **31/31 pass** (unmodified; different file — `grc/sovereignty-invariants.js`
  — confirmed no collision with the `ETHOS_INVARIANTS` naming).
- Standalone logic check of the new `ethosInvariantsList()` transform
  (re-run in isolation since `server.js` can't be unit-imported directly):
  produces 9 entries, correct `{id,name,status,description,lastChecked}`
  shape, `every status === "enforced"` → `true`.
- `cd concord-frontend && npx vitest run tests/hooks/use70Lock.test.ts` →
  **12/12 pass**.
- `cd concord-frontend && npx eslint hooks/use70Lock.ts
  tests/hooks/use70Lock.test.ts app/lenses/lock/page.tsx` → clean, zero
  output.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-
  CALL":2}` total 260 (lock counted as WIRED, unchanged).
- `node scripts/grade-ux-polish.mjs --honest` → lock `tier: "polished"`,
  `isGenericScaffold: false` (see JSON above); `audit/ux-polish-honest*`
  reverted via `git checkout` after reading.
- `npx tsc --noEmit` was **not** run per the standing instruction for this
  batch (a prior parallel run OOM'd the container); relied on eslint +
  careful manual type review of the two small edits (`Invariant[]`/response
  interface rename, a narrow local cast in the `runAudit.onSuccess` reader).

## Left alone, with reason

- **`SecurityRepos.tsx`** — real live GitHub search, correctly wired,
  honest error state. No defect found.
- **`SovereigntySetup.tsx` / `SovereigntyPrompt.tsx`** — field-shape
  audited against `POST /api/sovereignty/setup` (`mode`, `selectedDomains`)
  and found correct; no defect found. `SovereigntyPrompt` is currently only
  ever rendered from local component state that's never set to a non-null
  value in this lens (`sovereigntyPromptMessage` has no setter call site
  found beyond its own resolver) — a real but pre-existing dead-render path,
  not introduced or touched by this pass, and not a fabrication (it's an
  honest empty/unreachable state, not fake data). Flagged here for whoever
  next wires a real global-assist consent-prompt trigger into this lens.
- **`LockDashboard.tsx`, `SovereigntyDashboard.tsx`** — no code changes
  needed; both already read the correct real field names and now receive
  correct data as a result of the `use70Lock.ts` fix upstream.
- **The naming collision between the sovereignty audit-history's generic
  `useLensData('lock','lock-event')` artifact type and the concurrency
  profiler's real `lock.recordLockEvent` macro** — confusingly similar
  names, but genuinely different real systems (one is a generic
  audit-history log entry, the other is a concurrency trace event); not
  fabricated, not a duplicate CRUD system standing in for a real feature.
  Left alone — a rename would touch the generic artifact-store convention
  used identically across many other lenses, out of scope for this unit.

## Genuinely missing

None found that rise to the "defining feature" bar for either sub-system
within this lens's scope. The concurrency profiler (the lens's namesake
feature) is fully built to a JFR/lock-profiler-parity bar. The sovereignty
dashboard's defining gap — a genuinely live, runtime-checked invariant
status (vs. the frozen-constant "enforced by construction" status this fix
surfaces) — **CLOSED (2026-07-17, `f7dd1e6b`)**: `enforceEthosInvariant`'s
function body now records every real pass/blocked event (blocked recorded
BEFORE the throw, exact message preserved) into a bounded (500) since-boot
in-memory ring buffer, surfaced via `GET /api/sovereignty/status`
(`recentEnforcement` + honest counters, labeled runtime-vs-CI) and a live
feed in the lock lens with an honest empty state; the CI/detector feed was
honestly OMITTED rather than mislabel a stale baseline. (Originally noted as a
DATA-SOURCING-adjacent follow-up — internal telemetry, not external data)
for whoever owns the ethos-invariant enforcement path, not fixed in this
pass.
