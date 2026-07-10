# Hypothesis Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command or a
> live macro trace (see "Runtime verification" — this lens required
> booting the server and racing a 20s+ async load, not just static grep).

## Backend surface — three coexisting engines, only one is real in steady state

```
grep -c 'registerLensAction("hypothesis"' server/domains/hypothesis.js   # → 22
grep -n 'registerLensAction("hypothesis"\|register("hypothesis"' server/server.js | wc -l  # → 17
```

`node scripts/lens-unsurfaced.mjs --lens hypothesis` only sees the 22
domain-file macros (by design — it scans one `server/domains/*.js` file per
lens) and reports 1/22 unsurfaced (`analysisHistory`, left alone — a
read-only report macro with no natural button, documented below). **It is
structurally blind to the 17 macros registered inline in `server.js`**,
exactly the "whole macro cluster invisible to the script" defect class
named in this wave's brief — and that inline cluster is where the real
finding is.

**Three separate hypothesis engines exist in the codebase, registered
under the same `"hypothesis"` domain:**

1. **`server/domains/hypothesis.js`** (22 macros, 1,651 lines) — a real
   statistics engine: `zTest`, `abTest`, `bayesianInference`,
   `powerAnalysis`, `tTest`, `anova`, `chiSquare`, `correlation`,
   `regression`, `assumptionCheck`, `multipleComparison`, dataset
   import/list/get/delete, `runTestOnDataset`, a pre-registration registry
   (`preregister`/`registryList`/`recordOutcome`/`registryDelete`),
   `analysisHistory`, `apaReport`. Fully real, fully surfaced by
   `StatsWorkbench.tsx` (verified: every one of the 22 macro names has a
   `lensRun('hypothesis', <name>, …)` call site with a real input form —
   this is the correctly-built half of the lens).
2. **A legacy stub engine registered inline in `server.js` at lines
   13670-13731** (`status`, `propose`, `design_experiment`,
   `record_evidence`, `evaluate`, `get`, `list`) that reads/writes
   `ctx.state.hypothesisEngine` (a flat shape: `{id, statement, domain,
   falsifiable, priorConfidence, state, posteriorConfidence, evidenceFor,
   evidenceAgainst, experiments, …}`, defined at `server.js:67704-67958`).
3. **The real formal-lifecycle engine, `server/emergent/hypothesis-engine.js`**
   (639 lines), loaded by the Ghost Fleet async module loader and
   registered at `server.js:16741-16759` with `propose`/`get`/`list`
   **intentionally shadowing** engine #2's registrations (comment at
   `server.js:16736-16740`: `"Ghost Fleet hypothesis engine —
   intentionally shadows the stub registrations… note so the duplicate-
   registration warning stays quiet"`, `{note: "ghost_fleet_shadow_ok"}`).
   This is the one, real, nested-shape engine
   (`{id, createdAt, updatedAt, machine:{kind:"hypothesis", hypothesis:
   {statement, status, confidence, falsifiable, evidence_for,
   evidence_against, tests, predictions, lifecycle, parentHypothesis,
   childHypotheses, domain, priority}}}`) with a real
   proposed→testing→confirmed/rejected→refined→archived lifecycle,
   auto-recalculated confidence (weighted evidence + test pass rate +
   verified/falsified predictions — `recalculateConfidence`,
   `hypothesis-engine.js:69-99`), and auto-transitions
   (`checkAutoTransitions`, `:116-151`). It exposes 10 more macros engine
   #2 never had: `add_evidence`, `add_test`, `update_test`,
   `add_prediction`, `verify_prediction`, `confirm`, `reject`, `refine`,
   `archive`, `metrics`.

**Runtime verification (not just source-reading — CLAUDE.md's "runtime-truth
over source-guessing" rule):** Ghost Fleet loads modules on a staggered
20s-delayed, 2s-spaced background timer (`server.js:17331-17334`,
`GHOST_FLEET_DELAY_MS`). Booted the real server via
`server/tests/depth/_harness.js#macroRuntime` and called
`runMacro("hypothesis","propose",…)` before vs. after the load window:
- **Before** (≈first 30s post-boot): `propose`/`get`/`list` resolve to
  engine #2 (the flat legacy shape) — confirmed by direct trace, and
  `hypothesis.add_evidence` doesn't exist at all yet (`Error: macro not
  found`).
- **After** (steady state — the state every real user request runs in):
  `propose` returns the real nested `machine.hypothesis.*` shape; a full
  propose → list → add_evidence → add_test → update_test → get → metrics
  → confirm round trip was run live and behaved exactly as
  `hypothesis-engine.js` documents (confidence hit 1.0, auto-transitioned
  proposed→confirmed once a passed test + weighted evidence cleared the
  0.85 threshold, `metrics` correctly aggregated `byStatus`).

## The defect this wave found and fixed

**None of the 13 real lifecycle macros (`add_evidence`, `add_test`,
`update_test`, `add_prediction`, `verify_prediction`, `confirm`, `reject`,
`refine`, `archive`, `metrics`, and effectively `propose`/`get`/`list` too)
had a *correct* frontend caller before this wave.** The old
`app/lenses/hypothesis/page.tsx` (rewritten this wave — the git history
holds the prior version) called `apiHelpers.hypothesis.*`, which hit REST
routes in `server/routes/domain.js` with THREE separate bugs stacked on
top of the shadowing above:

1. **Field-shape mismatch (the named defect class).** The frontend's
   `Hypothesis` interface read `h.statement`, `h.status`, `h.confidence`,
   `h.evidence` directly off the list response — but the real engine
   nests everything under `h.machine.hypothesis.*`. Every hypothesis card
   rendered with a blank statement, an always-`undefined`→default-"pending"
   status badge (not even a real status value — real statuses are
   `proposed`/`testing`/…, never `"pending"`), and no confidence bar.
2. **Dead-engine routing.** `GET /api/hypothesis/status` called macro
   `status` (engine #2) — permanently 0, because nothing has written to
   `ctx.state.hypothesisEngine` since `propose` was shadowed (its only
   writer). `POST /:id/evidence` called `record_evidence` (engine #2) and
   `POST /:id/experiment` called `design_experiment` (engine #2) — **both
   always failed `not_found`** for every real hypothesis, because the
   frontend's ids are keyed into engine #3's store, not engine #2's.
   `POST /:id/evaluate` called `evaluate` (engine #2) — same, always
   `not_found`.
3. **A second, independent id-key bug** on top of #2: `GET
   /api/hypothesis/:hypothesisId` (before this wave's fix) passed
   `{ hypothesisId: req.params.hypothesisId }`, but the real (engine #3)
   `get` handler reads `input.id`, not `input.hypothesisId` — so even
   after routing to the right engine, this specific call would still have
   returned `not_found`.
4. A fourth, separate, unrelated-but-adjacent bug: the "Statistical
   Analysis Actions" quick-button panel (4 buttons — Z-Test/A-B-Test/
   Bayesian/Power-Analysis) called `runAction.mutate({id: artifactId,
   action, params: {}})` against a **hypothesis-lens artifact** synced
   from the (mis-shaped) hypotheses list — but `zTest` et al. read
   `artifact.data.sample` (`server/domains/hypothesis.js:240`), which a
   hypothesis DTU never has. Every click on this panel would have failed
   `"sample data required"`. It duplicated 4 of `StatsWorkbench.tsx`'s 11
   already-correctly-wired macros through a broken shortcut — removed as
   dead/fake-functioning code rather than fixed, since the real, correct
   version already existed one section down the page.

Net effect: the entire "propose a hypothesis and track its evidence"
half of this lens rendered blank cards, its four primary action buttons
(Evaluate / Add evidence / Experiment / the 4 stats quick-buttons) all
failed silently (`console.error` only, no user-visible error), and 10
real macros had never been called by anything.

## What changed this wave

**Backend — `server/routes/domain.js` (`registerDomainRoutes`, Hypothesis
Engine section):**
- `GET /api/hypothesis/status` now calls `hypothesis.metrics` (engine #3,
  real) instead of the dead `status` (engine #2). Response includes a
  back-compat `stats: {proposed, supported, refuted, inconclusive}` shim
  derived from the real `byStatus` counts, so `components/platform/
  NerveCenter.tsx` (the only other caller of `.status()`, outside this
  lens) keeps working and now shows real numbers instead of permanent
  zeros — fixed for free, not touched directly.
- `GET /api/hypothesis/:hypothesisId` now passes `{ id: … }` (was
  `{ hypothesisId: … }`, which the real `get` handler never read).
- `POST /:id/experiment` now calls `add_test` (was `design_experiment`,
  dead).
- `POST /:id/evidence` now calls `add_evidence` with adapted params (was
  `record_evidence`, dead).
- `POST /:id/evaluate` now calls `get` — the real engine recalculates
  confidence automatically on every evidence/test/prediction change, so
  there is no separate manual "evaluate" step; this honestly returns
  current (already-live) state instead of invoking a dead computation.

**Frontend — new `concord-frontend/components/hypothesis/HypothesisLab.tsx`**
(bypasses the REST layer entirely via `lensRun('hypothesis', <macro>, …)`
directly, so it is unaffected by whichever REST adapter shape exists):
propose form, status-filtered list with real confidence bars and status
badges reading the correct nested shape, a detail panel with: evidence
for/against (side + weight + summary, add form), tests (add + set
passed/failed/inconclusive), predictions (add + verify/falsify),
lifecycle actions (confirm/reject-with-reason/refine-into-child-hypothesis/
archive, each gated on current status), a lifecycle event timeline, and a
metrics strip (total, per-status counts, avg confidence). Discoverable
keyboard shortcuts via `useLensCommand` (`n` focuses the propose box,
`1`-`5` filter by status) — matches CLAUDE.md's fluidity invariant.

**`app/lenses/hypothesis/page.tsx`** — removed the broken create/list/
detail grid, the 4 permanently-wrong stat tiles, the dead "Statistical
Analysis Actions" quick-panel, and their now-unused `useLensBridge`/
`useLensData`/`useRunArtifact`/`apiHelpers.hypothesis` plumbing. Mounted
`<HypothesisLab />` in their place. Kept (unchanged, already correct):
the header, `LiveIndicator`/`DTUExportButton`/realtime alerts,
`RealtimeDataPanel`, the `StatsWorkbench` "Statistical Workbench" section,
`LensFeaturePanel`, and `ArxivFeed`. Removed a now-orphaned
`<UniversalActions>` call (its `artifactId` prop had no honest source
left once the artifact-bridge was removed — passing `undefined` would
have reintroduced the "dead/disabled button gated on a permanently-empty
generic artifact store" defect class this wave is meant to close, not
just relocate it).

**Left alone:** `analysisHistory` (domain-file macro, read-only report —
no natural single-click surface; a future analytics/reports tab could
adopt it, out of scope this wave). The stats-engine half
(`server/domains/hypothesis.js`, `StatsWorkbench.tsx`) required no
changes — independently verified correct (input shapes match handler
signatures, e.g. `zTest`'s `sample:{mean,stdDev,n}` contract).

Files touched:
- `server/routes/domain.js` — 5 hypothesis routes repointed to the real
  engine + a NerveCenter back-compat shim.
- `concord-frontend/components/hypothesis/HypothesisLab.tsx` — new file.
- `concord-frontend/app/lenses/hypothesis/page.tsx` — rewritten to remove
  dead code and mount `HypothesisLab`.

## Verification

- `node --check server/routes/domain.js` → OK.
- `cd server && node --test tests/hypothesis-domain-parity.test.js
  tests/inference-domain-parity.test.js tests/inference-metering.test.js`
  → 58/58 passing (the stats-engine contract tests + the sibling
  `inference` domain that shares this routes file, both untouched in
  behavior).
- `cd server && npx eslint routes/domain.js` → clean.
- `cd concord-frontend && npx eslint app/lenses/hypothesis/page.tsx
  components/hypothesis/HypothesisLab.tsx` → clean.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors in either file.
- **Live macro trace** (not a unit test — a real booted-server round trip,
  reproduced via `server/tests/depth/_harness.js#macroRuntime` waiting out
  the Ghost Fleet load window): `propose` → `list` (array, 1 item) →
  `add_evidence` (`{ok:true}`) → `add_test` (`{ok:true,testId}`) →
  `update_test` (`{ok:true}`, auto-transitioned `proposed→confirmed` at
  `confidence:1`) → `get` (nested shape, confidence/status correct) →
  `metrics` (`{total:1, byStatus:{confirmed:1,…}, avgConfidence:1,
  factDTUsCreated:1}`) → `confirm` (`{ok:true}`) — the exact flow
  `HypothesisLab.tsx` drives, confirmed working end-to-end against the
  live engine.
