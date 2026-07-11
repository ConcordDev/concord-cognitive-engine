# Wellness — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'register("wellness"' server/domains/wellness.js
```
→ **35** macros in `server/domains/wellness.js`: sleep/strain/recovery
scoring (Whoop/Oura-parity), habit tracking, workout logging, goal
tracking, trend analysis, and a raw metrics ledger (`metrics-log`/
`metrics-list`) covering an Apple-Health-style catalog (steps, weight,
sleep hours, water, resting HR, calories, HRV, body fat %, blood pressure).

```
node scripts/lens-unsurfaced.mjs --lens wellness
```
→ **0/35 macros never referenced in the frontend** (was 1/35 before this
fix — `metrics-list`).

## What's real and already correctly wired (no changes needed)

`concord-frontend/app/lenses/wellness/page.tsx` and
`concord-frontend/components/wellness/WellnessSection.tsx` were read in
full. `grep -n "Math.random|MOCK|mock|fake|Lorem|lorem"` across both →
empty. No `useLensData`/`useRunArtifact`/`UniversalActions` generic-scaffold
pattern anywhere in this lens — unlike most lenses audited this wave,
wellness never had a fabricated parallel CRUD system sitting beside the
real one. `WellnessSection.tsx` is a single, genuinely deep, real
Whoop/Oura/Apple-Health-shaped component: sleep score, strain, recovery,
habit checklist, workout log, goal tracker, and a trend chart — every value
read from and written to a real `wellness.*` macro via `lensRun`.

## The defect: one real macro, zero UI

`wellness.metrics-list` (the raw entry-log read, paired with the already-
wired `metrics-log` write) had no frontend caller. The trend chart only
ever showed one metric type (whichever was selected in `TREND_METRICS`, a
6-item subset) as an aggregated series — there was no way to see the raw,
individual logged entries across all 10 backend-supported metric types, so
data logged via `metrics-log` for a type outside the 6-item trend list
(e.g. `body_fat_pct`, `systolic`/`diastolic`) was write-only: acceptable to
log, invisible afterward.

**Fixed:** added an "All entries (90d)" log browser to the Insights
section — a type filter (all 10 backend metric types, not just the 6 trend
types) plus a scrollable, reverse-chronological entry list (type badge,
date, value, source) — wired to `lensRun('wellness', 'metrics-list', {type,
days: 90})`. Refreshes automatically after `logMetric()` so a newly-logged
entry appears immediately.

## Verification

- `node --check server/domains/wellness.js` — clean (file untouched).
- `server/tests/depth/wellness-behavior.test.js`,
  `server/tests/wellness-domain-parity.test.js` — 38/38 pass, unmodified.
- `cd concord-frontend && npx eslint components/wellness/WellnessSection.tsx`
  — clean.
- `node scripts/verify-lens-backends.mjs` — wellness WIRED, totals
  unchanged (`{"WIRED":258,"NO-BACKEND-CALL":2}` total 260).
- `node scripts/grade-ux-polish.mjs --honest` — wellness `tier:"polished"`,
  `isGenericScaffold:false`. `audit/` reverted via `git checkout -- audit/`.

## Left alone, with reason

- The rest of `WellnessSection.tsx` (sleep/strain/recovery/habits/
  workouts/goals/trend chart) — already real, already correctly wired, no
  defect found on full read.
- `app/lenses/wellness/page.tsx` — thin wrapper mounting
  `WellnessSection`; no fabrication, no generic scaffold.
