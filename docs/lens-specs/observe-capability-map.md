# Observe lens — capability map (Wave 3 verify-pass, 2026-07-11)

## What this lens actually is

A Datadog/Grafana-parity full observability platform, deceptively thin at the
page level (147 lines) — nearly all of it delegates to two substantial
components. Backend: `server/domains/observe.js`, 28 macros across 7 feature
families (metrics ingestion + time-series, dashboards, log search, distributed
tracing/APM, alert monitors, synthetic uptime checks, on-call paging).

Plus the page's own header feature (distinct domain: `observer.compose_report`
— an "Observer Mode" narrative concept, generates a citable `empirical_report`
DTU from a world's ripple state; royalty cascade pays the observer when others
cite it). This is a same-name-adjacent-domain situation like `lattice`/`mesh`
before it (`observe` vs. `observer`) — worth noting but not a defect, since
both are correctly wired to their own real macros.

## Finding: already fully wired — no defect

Traced all 28 `observe.*` macros against their UI callers:
- `ObserveActionPanel.tsx` (383 LOC) — 4 "quick action" macros: `serviceLog`,
  `alertSummary`, `incidentTrack`, `sloCheck`.
- `ObservePlatform.tsx` (750 LOC) — the remaining 24 macros across all 7
  tabs (Metrics/Dashboards/Log Search/APM-Traces/Monitors/Synthetics/On-Call),
  confirmed via grep of every `run('<macroName>'` call site.

100% macro coverage, zero unsurfaced macros — the first lens audited this pass
with a completely clean bill on that front. No fabricated data anywhere
(grepped for `Math.random`/`mock`/`fake` across all 4 files — zero hits).

No code changes made — this was a verify-pass.

## Verification (all run directly, 2026-07-11)

- `npx eslint app/lenses/observe/page.tsx components/observe/*.tsx` — clean, 0 issues.
- `npx vitest run tests/observe-lens-states.test.tsx tests/components/ObservePlatform.test.tsx` — **25/25 passing**.
- `node --test server/tests/observe-domain-parity.test.js server/tests/depth/observe-behavior.test.js` — **19/19 passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `observe`: `tier:"polished"`, `isGenericScaffold:false`, `bespokeRatio:0.891`. `audit/` reverted afterward.
