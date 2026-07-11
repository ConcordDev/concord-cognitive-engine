# Temporal Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## What "temporal" actually is (verified from source, not assumed)

CLAUDE.md flags a real in-game "time loop" mechanic (`server/lib/time-loop.js`,
`loop_memories`, `TimeLoopHUD`, scoped by `(user, world)`) — **that is a
different system, registered under the `time-loop` domain, not `temporal`.**
Read from source: the `temporal` domain (`server/domains/temporal.js`, 1,110
lines) is a **Prophet/Tableau-grade time-series analytics engine** — CSV/paste
dataset import, changepoint detection (binary segmentation + BIC-style
penalty), multi-seasonality decomposition (autocorrelation peak-picking),
holiday-aware Holt-Winters forecasting, model backtesting (naive/drift/moving-
average/Holt/seasonal-naive ranked by RMSE), cross-series lead/lag
correlation, trend/seasonal/residual decomposition, dual-method (Z-score +
IQR) anomaly detection with consensus + clustering, and a linear-trend
scenario simulator (expected/optimistic/pessimistic bands). None of it is
gameplay-related.

## Backend surface

```
grep -c 'registerLensAction("temporal"' server/domains/temporal.js
```
→ **13** macros: `dataset-import`, `dataset-list`, `dataset-get`,
`dataset-delete`, `changepoints`, `multiSeasonality`, `holidayForecast`,
`backtest`, `crossCorrelation`, `timeSeriesDecompose`, `anomalyDetection`,
`forecast`, `simulate`. Dataset storage is a per-user in-memory
`STATE.temporalLens.datasets` `Map` (debounce-persisted, not a DB table) — the
9 analysis macros resolve a series either from a stored `datasetId` or from
inline `values`/`series` params (`resolveSeries` helper).

**A second, separate registration exists** for the same domain string
`"temporal"` directly in `server/server.js:28188-28221` (NOT in
`server/domains/temporal.js`, so `scripts/lens-unsurfaced.mjs` — which only
walks `server/domains/` — reports a false "0/13 unsurfaced" for this domain;
confirmed by reading the script's `DOMAINS` constant): `validate`,
`subjective`, `recency`, `frame`, `simTimeline`. These are tagged
`simulation:true`/"v3" and are generic **temporal-reasoning primitives** — ISO
timestamp + reference-frame validation for counterfactual timelines, a
session-activity-derived subjective pacing/urgency profile, exponential
recency-decay weighting (used elsewhere in retrieval/scoring math), reference
frame lookup, and simulation-timeline object CRUD. They are also exposed as
public REST routes (`POST /api/temporal/{validate,recency,frame,subjective,
sim}`, `server/routes/domain.js:319-323`) — the REST-routed, not
by-name-`lensRun`, class the audit methodology explicitly calls legitimately
frontend-invisible. Grepped for any caller (frontend or backend): **zero**
callers anywhere in the tree beyond their own registration. Disposition:
**UNSURFACED, correctly so** — these are low-level utility primitives (weight
0.6 tier by design) meant for programmatic/agent consumption via the public
REST API or MCP, not a fit for a bespoke analytics-dashboard UI element. Not a
defect; left unbuilt, documented here per the audit methodology rather than
silently ignored.

## Frontend surface

`concord-frontend/app/lenses/temporal/page.tsx` +
`concord-frontend/components/temporal/{ForecastWorkbench,TemporalRepos}.tsx`.

All 13 lens macros already had a real caller before this pass —
`ForecastWorkbench` (818 LOC) is a genuinely excellent, purpose-built
time-series workbench: CSV paste/upload import, a stored-dataset rail, a
brushable/zoomable series chart, 7 analysis tabs each calling its real macro
with a bespoke result renderer (decomposition trend/seasonal/residual
overlays, forecast confidence-band chart + holiday-effect table, anomaly
chart + timeline-of-anomalies view, changepoint chart + shift table,
multi-seasonality per-period bar charts + ACF curve, backtest model-overlay
chart + MAE/RMSE/MAPE leaderboard table, cross-correlation lag-correlation
bar chart). So there was **no UNSURFACED lens macro** — the defect, as in
several other Wave-3 lenses, was a fabricated system sitting in front of it.

## The defect found

### A fabricated 6-type (`TimeFrame/Event/Simulation/Timeline/Pattern/
Snapshot`) generic CRUD dashboard as the page's primary surface, sitting
directly above the already-real, already-wired `ForecastWorkbench`

`app/lenses/temporal/page.tsx` (860 lines) ran `useLensData<TemporalArtifact>
('temporal', activeArtifactType, …)` with `activeArtifactType ∈ {TimeFrame,
Event, Simulation, Timeline, Pattern, Snapshot}` — **none of these six type
strings is a registered `temporal` macro action.** `useLensData` hits the
generic `GET /api/lens/temporal?type=…` artifact store
(`concord-frontend/lib/hooks/use-lens-data.ts`), a domain-agnostic key-value
store with zero relationship to `server/domains/temporal.js`. Confirmed by
diffing every `TemporalArtifact` field (`startDate`/`endDate`/`duration`/
`timespan`/`scenario`/`confidence`/`eventType`/`impact`/`recurrence`/
`branch`/`divergencePoint`/`frequency`/`lastOccurrence`/`nextPredicted`) —
**zero** overlap with any real macro's input/output shape (the real shapes
are `{values, timestamps}` series data, `{horizon, period, threshold,
testFraction, holidays[]}` analysis params, and macro-specific result
objects like `{changepoints[], segmentMeans[], stability}`).

- The "Activate" (⚡) button on each fake artifact card called
  `runAction.mutateAsync({ id, action: 'simulate' })` via `useRunArtifact
  ('temporal')`, which POSTs to `/api/lens/temporal/{id}/run` — a
  **different, generic per-artifact-id action runner**
  (`concord-frontend/lib/hooks/use-lens-artifacts.ts`), not
  `POST /api/lens/run` (the real macro dispatcher `ForecastWorkbench` uses).
  The name `'simulate'` coincidentally matches a real macro name, but the
  call shape (`{id, action}` against a fake CRUD row) has nothing to do with
  the real `temporal.simulate` macro's contract (`{values|datasetId,
  horizon}` → linear-trend scenario projection). Clicking it against a fake
  `TimeFrame` row would 404/no-op — an honest failure, but for a button that
  visually implied it ran real time-series analysis.
- A ~380-line editor modal (`renderEditor`) with per-type conditional form
  fields (Start/End dates for TimeFrame, Event Date/Type/Impact/Recurrence
  for Event, Scenario/Timespan/Confidence/Result for Simulation, Branch
  Name/Divergence Point for Timeline, Frequency/Last Seen/Next Predicted for
  Pattern, Snapshot Date for Snapshot) persisted purely into the generic
  artifact store's opaque `data` JSON blob — no backend logic ever reads any
  of these fields.
- The Dashboard toggle's 4-tile "Active Frames / Simulations / Patterns /
  Timelines" stat row was computed entirely from these fake arrays — always
  `0` on a fresh install, never reconcilable with anything `ForecastWorkbench`
  actually computes.
- `<UniversalActions domain="temporal" artifactId={items[0]?.id} compact />`
  ran the generic analyze/generate/suggest utility-brain actions against a
  fake artifact — dropped along with the fake store rather than rewired to
  nothing, since there is no real "select one temporal artifact" concept in
  this domain (the real unit of work is an imported dataset + a chosen
  analysis, already served by `ForecastWorkbench`'s own dataset rail).
- `ForecastWorkbench` and `TemporalRepos` (a real GitHub-API "temporal
  tooling" reference panel — workflow/scheduler/cron/time-series topic
  search, no fabricated data) were **already mounted** at the very bottom of
  the same page inside small `<section>` wrappers, fully disconnected from
  the ~700-line fabricated system above them — the exact "real backend/UI
  sitting beside a fabricated parallel system" shape `CLAUDE.md` names.

A third component, `components/temporal/TimeCrystals.tsx`, exists in the same
directory but is **not part of this lens** — it's mounted in
`components/home/HomeClient.tsx` (a home-dashboard "recurring knowledge
patterns" widget hitting `/api/time-crystals`/`/api/archaeology`/
`/api/substrate/diff`, unrelated to the `temporal` domain's macros).
Confirmed via `grep -rln TimeCrystals concord-frontend` — only `HomeClient.tsx`
and the component's own file reference it; `app/lenses/temporal/page.tsx`
never imported it, before or after this pass. Left untouched — out of scope.

## What changed

### `app/lenses/temporal/page.tsx` — rewritten (860 → 65 lines)

Removed: the `TemporalArtifact`/`ModeTab`/`ArtifactType`/`Status` types, the
6-tab `MODE_TABS` + `STATUS_CONFIG` + `EVENT_TYPES`/`TIMESPAN_OPTIONS`/
`IMPACT_LEVELS`/`RECURRENCE_OPTIONS` constant tables, ~20 `useState` form
fields, `useLensData`/`useRunArtifact`/`UniversalActions`, `handleAction`/
`resetForm`/`openCreate`/`openEdit`/`handleSave`, `renderDashboard`/
`renderEditor`/`renderLibrary`, the dead `searchInputRef` + its now-orphaned
`/`-to-focus-search shortcut (the search box was part of the fake library
list and no longer exists).

Replaced with a minimal header (`Clock` icon, real one-line description of
what the analytics surface does) directly over the already-real
`ForecastWorkbench` (now the page's primary, unobstructed content) and
`TemporalRepos` in its existing `<section>` wrapper. Kept
`FirstRunTour`/`ManifestActionBar`/`DepthBadge` and the footer
(`RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel`) — the
`ManifestActionBar` + footer trio is not gated by the generic-scaffold
detector when a substantial bespoke component is present (confirmed by the
grader run below: `isGenericScaffold: false`, `bespokeRatio: 0.944`).

### `components/temporal/ForecastWorkbench.tsx` — added the `simulate` tab
+ discoverable keyboard shortcuts (fluidity invariant)

Two independent additions:

1. **Closed the `simulate` macro gap** (see classification above) — an 8th
   "Scenarios" tab, a dispatcher branch, and a `ResultPanel` renderer.
2. **Keyboard shortcuts.** The component had (now 8) analysis tabs with no
   keyboard path — a gap against the fluidity invariant's "every lens's
   keyboard shortcuts must be discoverable." Added a `useLensCommand(...)`
   registration (`1`-`8` switch tabs, surfaced in the global shortcuts-help
   modal + command palette per the hook's own contract) **inside**
   `ForecastWorkbench` rather than at the page level, since the component —
   not the page — owns the tab state; plus a visible `<kbd>` number chip on
   each tab button and a `title` tooltip, so the shortcut is discoverable
   without opening the help modal.

No backend change, no new dependency.

## Macro → UI classification (all 13 lens macros)

**DESIGNED** (real, bespoke UI, no fabrication) — **13/13** after this pass
(was 12/13 before — `simulate` had no UI caller anywhere; closed this pass,
see below):

| Macro | Where |
|---|---|
| `dataset-import` | `ForecastWorkbench.tsx` — CSV paste + file upload |
| `dataset-list` | `ForecastWorkbench.tsx` — left-rail dataset picker |
| `dataset-get` | `ForecastWorkbench.tsx` — series chart + brush/zoom |
| `dataset-delete` | `ForecastWorkbench.tsx` — per-dataset delete button |
| `changepoints` | `ForecastWorkbench.tsx` Changepoints tab — chart + shift table |
| `multiSeasonality` | `ForecastWorkbench.tsx` Seasonality tab — per-period bars + ACF curve |
| `holidayForecast` | `ForecastWorkbench.tsx` Forecast tab (when holidays added) — confidence band + holiday-effect table |
| `backtest` | `ForecastWorkbench.tsx` Backtest tab — model-overlay chart + MAE/RMSE/MAPE table |
| `crossCorrelation` | `ForecastWorkbench.tsx` Correlation tab — lag/correlation bar chart |
| `timeSeriesDecompose` | `ForecastWorkbench.tsx` Decompose tab — trend/seasonal/residual charts |
| `anomalyDetection` | `ForecastWorkbench.tsx` Anomalies tab — chart + timeline-of-anomalies |
| `forecast` | `ForecastWorkbench.tsx` Forecast tab (default) — confidence-band chart |
| `simulate` | `ForecastWorkbench.tsx` **Scenarios tab (new this pass)** — expected/optimistic/pessimistic band chart |

**`simulate` gap — found, triaged, and closed this pass.**
`ForecastWorkbench`'s `ANALYSIS_TABS` array had 7 tabs mapping 1:1 to
`decompose`, `forecast`/`holidayForecast`, `anomaly`, `changepoints`,
`seasonality`, `backtest`, `correlation` — there was no 8th tab for
`simulate` (linear-trend scenario projection with optimistic/pessimistic
bands, tested at `server/tests/depth/temporal-simulate-behavior.test.js`)
despite it being a real macro with **no UI caller anywhere**. Triaged as
**ENGINEERING** (no external data dependency, no authoring — just one more
tab reusing the exact pattern the other 7 already follow) per the sixth
hard invariant's triage classes, and — being genuinely small — built rather
than left deferred: added an 8th "Scenarios" tab (`GitFork` icon), a
`simulate` branch in the analysis dispatcher (`horizon` param, same field
the Forecast tab already exposes), and a `ResultPanel` branch rendering a
4-line chart (observed / optimistic ~80% / expected / pessimistic ~80%)
plus a 4-stat row (last value, trend/step, volatility, final expected).

**UNSURFACED, correctly so** (5 `server.js`-registered v3 macros, not part of
the `temporal` lens's macro set) — `validate`, `subjective`, `recency`,
`frame`, `simTimeline`. See "Backend surface" above for the full reasoning;
disposition is deliberate, not a gap.

## Investigated and honestly deferred

- **The 5 `server.js` v3 temporal-reasoning macros have no UI and arguably
  never should** — DATA-SOURCING/CURATION doesn't apply (no external data,
  no authored content); this is the "legitimately frontend-invisible,
  REST/agent-consumed utility" case the audit methodology names explicitly.
  Not triaged as a gap to close.
- **Dataset storage is in-memory, not a DB table** (`STATE.temporalLens`,
  debounce-persisted via `saveStateDebounced`) — pre-existing backend
  design, out of scope for a frontend-only pass; not a fabrication (it's a
  real, working store, just not SQLite-backed).

## Verification

```
node --check server/domains/temporal.js                              # OK — backend untouched, syntax-valid
cd server && node --test tests/depth/temporal-behavior.test.js \
  tests/depth/temporal-simulate-behavior.test.js \
  tests/temporal-domain-parity.test.js
# → 17/17 pass, 0 fail, 10 suites (unmodified — backend was not touched this pass)

cd concord-frontend && npx eslint app/lenses/temporal/page.tsx \
  components/temporal/ForecastWorkbench.tsx
# → clean, 0 errors/warnings

node scripts/verify-lens-backends.mjs
# → {"WIRED":258,"NO-BACKEND-CALL":2} total 260 — unchanged, temporal counted WIRED

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json["temporal"]: tier "polished",
#   isGenericScaffold: false, honestCapped: false, bespokeRatio 0.944,
#   pillarsPresent 5, antiPatterns 0, fileCount 4, bespokeComponentLoc 1107
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
