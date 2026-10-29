# analytics — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("analytics"' server/domains/analytics.js` → 30

## Reference app + parity target

**Mixpanel / Amplitude / PostHog** — the real, best-in-class product-analytics
category. `server/domains/analytics.js` (921 LOC) carries a genuine
event-based analytics engine: event track/list/stats, saved funnels,
segmentation, retention, a custom report builder with live widgets, Sankey
path analysis, multi-dimensional breakdowns, a live event-stream debugger,
threshold/anomaly alerting, behavioral cohorts (did-X-but-not-Y), date-range
comparison, plus a separate DB-backed real-analytics pair (`world-summary`,
`global-summary`) and four generic statistical compute macros (funnel /
cohort / anomaly / trend on arbitrary pasted data). Frontend coverage is
unusually deep for this pass: `AdvancedAnalytics.tsx` (990 LOC) alone covers
7 of the Mixpanel/Amplitude-parity backlog items, plus `EventAnalytics.tsx`,
`FunnelsPanel.tsx`, `PlatformGrowth.tsx`, and `AnalyticsActionPanel.tsx` are
all real, correctly-wired, honest components.

## Classification of every macro

DESIGNED (real, bespoke UI, not a generic button wall):
- `event-track` / `event-list` / `event-stats` — `EventAnalytics.tsx` tracker + top-events chips
- `funnel-build` — `EventAnalytics.tsx` inline funnel builder
- `funnel-save` / `funnel-list` / `funnel-delete` — `FunnelsPanel.tsx` (named, persisted funnels)
- `segment` — `EventAnalytics.tsx` segment-by-property panel
- `retention-report` — `EventAnalytics.tsx` retention bars
- `analytics-dashboard` — `EventAnalytics.tsx` header stat strip
- `dashboard-save` / `dashboard-list` / `dashboard-get` / `dashboard-delete` — `AdvancedAnalytics.tsx` `ReportBuilder` (custom widget dashboards: metric/trend/topEvents/segment/funnel widget kinds, live-rendered via `ChartKit`)
- `path-analysis` — `AdvancedAnalytics.tsx` `PathAnalysis` (Sankey-style journey columns)
- `breakdown` — `AdvancedAnalytics.tsx` `BreakdownPanel` (2-dimension cross-tab + chart)
- `event-stream` — `AdvancedAnalytics.tsx` `LiveStream` (polling debugger view with live/pause toggle)
- `alert-save` / `alert-list` / `alert-delete` — `AdvancedAnalytics.tsx` `AlertsPanel` (threshold + anomaly alert authoring, live firing state)
- `cohort-build` / `cohort-save` / `cohort-list` / `cohort-delete` — `AdvancedAnalytics.tsx` `CohortBuilder`
- `range-compare` — `AdvancedAnalytics.tsx` `RangeCompare`
- `funnelAnalysis` / `cohortAnalysis` / `detectAnomalies` / `trendForecast` — `AnalyticsActionPanel.tsx` ("analyst bench": paste-JSON calculators + mint-as-DTU / DM / publish-as-benchmark / agent-growth-lever actions), pinned by `tests/analytics-lens-states.test.tsx` (7/7 — idle/loading/error/populated states)
- `world-summary` / `global-summary` — `components/world-lens/AnalyticsDashboard.tsx` (real DB-backed per-world and cross-world structural analytics; mounted in the World lens, not this page — legitimate, since these are Concordia-world stats, not creator analytics)

GENERIC-STRIP-ONLY (found and fixed this pass): none remaining — see Finding below.

UNSURFACED: none. `node scripts/lens-unsurfaced.mjs --lens analytics` reports
`alert-evaluate` as unreferenced, which is a false positive: `alert-list`'s
handler already maps every saved alert through the identical
`evaluateAlert()` helper and returns live `{ value, firing, detail }` inline
per row (`server/domains/analytics.js:625-631`) — the standalone
single-alert re-check macro duplicates data already on screen. No unmet UI
capability.

## Finding: dead "Actions" tab — fabricated parallel generic-CRUD system (FIXED)

`app/lenses/analytics/page.tsx`'s own "Actions" tab (previously ~375 lines)
implemented a *second*, broken copy of the four calculator macros
(`funnelAnalysis`/`cohortAnalysis`/`detectAnomalies`/`trendForecast`) using
the generic `useLensData('analytics', 'dataset', { seed: [] })` +
`useRunArtifact('analytics')` hooks — the catch-all `/api/lens/:domain`
artifact CRUD substrate, not the real macro-dispatch path the calculators
actually run on.

Because `analytics`/`dataset` was never a real artifact type (no seed data,
no create UI anywhere in that tab), `analyticsItems` was permanently empty,
so `handleAnalyticsAction`'s `targetId = analyticsItems[0]?.id; if
(!targetId) return;` guard fired on every click — **all four buttons in the
"Computational Analytics" grid were dead clicks: no spinner, no error, no
network call, nothing.** This is exactly the defect class CLAUDE.md calls
out (§3, "fabricated parallel generic-CRUD systems … sitting beside an
already-real bespoke component") — the real, correctly-wired, already-tested
bench (`AnalyticsActionPanel.tsx`, pinned by
`tests/analytics-lens-states.test.tsx`) was mounted unconditionally at the
bottom of the page the whole time, so the dead tab was pure duplicate dead
weight nobody would notice unless they clicked the tab itself.

The prior Wave-3 audit note in `docs/lens-specs/analytics-wave3-audit.md`
("No `Math.random()`, no fabricated numbers, no dead clicks found") is
**stale** — it reviewed the four bespoke components but not the page's own
duplicate scaffold. Correcting that record here.

**Fix:** removed the dead scaffold (state, hooks, button grid, result
renderer) and mounted the real `AnalyticsActionPanel` inside the "Actions"
tab instead (previously it rendered unconditionally below all four tabs,
which was itself confusing — the tab looked non-functional while the real
surface sat below it regardless of which tab was active). The `a` keyboard
shortcut (`useLensCommand`, already wired) now lands on a working surface
for the first time. `FunnelsPanel` stays always-visible below the tabs
(it's a small persistent "saved funnels" widget, not a per-tab surface).

Verification: `tests/analytics-lens-states.test.tsx` (7/7, unaffected —
`AnalyticsActionPanel` itself wasn't touched), `npx eslint` clean,
`node scripts/verify-lens-backends.mjs` unaffected (`{"WIRED":258,
"NO-BACKEND-CALL":2}` total 260), `node scripts/grade-ux-polish.mjs
--honest` → analytics `tier: "polished"`, `isGenericScaffold: false`.

## Reference-app parity check (Mixpanel / Amplitude / PostHog)

| Feature | Where |
|---|---|
| Event tracking + top-events | `EventAnalytics.tsx` |
| Saved conversion funnels | `FunnelsPanel.tsx` |
| Ad-hoc funnel analysis (paste data) | `AnalyticsActionPanel.tsx` |
| Custom report builder (saved dashboards, live widgets) | `AdvancedAnalytics.tsx` → Reports tab |
| User-path / journey (Sankey-style) analysis | `AdvancedAnalytics.tsx` → Paths tab |
| Multi-dimensional breakdowns | `AdvancedAnalytics.tsx` → Breakdown tab |
| Live event stream / debugger | `AdvancedAnalytics.tsx` → Live stream tab |
| Threshold + anomaly alerting | `AdvancedAnalytics.tsx` → Alerts tab |
| Behavioral cohorts (did X but not Y) | `AdvancedAnalytics.tsx` → Cohorts tab |
| Date-range comparison | `AdvancedAnalytics.tsx` → Compare tab |
| Retention curves | `EventAnalytics.tsx` |
| Segmentation by property | `EventAnalytics.tsx` |
| Platform growth / marketplace GMV (real DB) | `PlatformGrowth.tsx` |
| Creator revenue / DTU performance | `page.tsx` Overview/Revenue/DTUs tabs + `CreatorAnalytics.tsx` |
| Report → DTU mint / DM / publish / agent lever | `AnalyticsActionPanel.tsx` |

No `Math.random()`, no fabricated numbers found anywhere in the six analytics
files. All values are either live query results, backend macro results, or
user-entered form state.

## Genuinely missing (deferred) — triage

None found this pass that rise to "defining feature." The lens already
covers the full Mixpanel/Amplitude/PostHog core surface (event model,
funnels, retention, cohorts, alerts, paths, breakdowns, live stream, custom
dashboards) plus platform-specific creator-economy analytics (royalties,
citations, DTU tiers) those reference apps don't have an equivalent for.
