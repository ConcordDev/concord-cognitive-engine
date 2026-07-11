# self — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("self"' server/domains/self.js` → 13

## Reference app + parity target

**Apple Health / Gyroscope** — a unified quantified-self dashboard: log
readings across metrics, see trends, correlate metrics against each other,
set goals with progress rings, get a daily/weekly recap, customize which
tiles you see, track streaks, and import a wearable export. This lens's
core (`server/domains/self.js`, a real in-STATE per-user metric ledger) is
one of the more thoroughly-audited backends in the repo — it already has a
dedicated `server/tests/self-lens.test.js` (34 assertions covering
degrade-graceful, per-user isolation, fail-closed input validation, and
exact round-trip math) and a frontend states test
(`concord-frontend/tests/self-lens-states.test.tsx`, 10 assertions). The
541-line spec comment at the top of `server/domains/self.js` and the page
header comment both document the design honestly: 7 metric-ledger tabs
(overview/trends/correlations/goals/digest/streaks/import) backed by
`self.*` macros, plus 8 legacy "aggregator" tabs (fitness/sleep/mood/
journal/rituals/achievements/milestones/season) that either pull real data
from OTHER lens domains or are honest cross-lens CTAs with no backend call
of their own.

## `node scripts/lens-unsurfaced.mjs --lens self`

```
self: 1/13 macros never referenced in the frontend
  readings-* (1)
      readings
```

`self.readings` (the raw per-reading ledger, filterable by metric) has no
frontend caller. Judged as legitimate-unsurfaced, not a defect: every tab
that would need it (overview aggregates, trend charts the daily series,
streaks derives day-sets, digest aggregates) already reads the same
underlying ledger through a purpose-built macro that returns exactly the
shape it needs. `readings` is a general-purpose raw accessor kept for API
completeness / potential future "recent log" UI, not a dead-end the user
can reach and get nothing from. No fix applied.

## Findings

### `d.activeMinutes` — REAL field-shape mismatch (fixed)

The Fitness tab (`app/lenses/self/page.tsx`) calls the real
`fitness.activity-summary` macro and typed its result as
`Array<{ date?: string; steps?: number; activeMinutes?: number;
distanceKm?: number }>`. The real handler
(`server/domains/fitness.js:357`, its own comment: *"Map each stored device
row → the EXACT shape ActivityRings.tsx renders"*) returns
`{ date, moveCalories, moveGoal, exerciseMinutes, exerciseGoal, standHours,
standGoal, steps, stepsGoal, raw }` — there is no `activeMinutes` or
`distanceKm` field and never was (confirmed against
`tests/fitness-lens-macros.test.js:518`, which pins the exact field list
including `exerciseMinutes`).

Effect: `(fitness.data?.days ?? []).reduce((a, d) => a + (d.activeMinutes ??
0), 0) || '—'` summed `undefined ?? 0` for every day, so the total was
always `0`, and `0 || '—'` renders `'—'`. The **Active min** stat tile on
the self lens's Fitness tab silently showed "—" for every user, regardless
of how much real exercise data they had logged — a defect-class-(b) field
mismatch exactly like the ones found across 150+ other lenses this wave.
`steps` happened to match the real field name, so **Total steps** was
already correct; only **Active min** was broken.

**Fix:** renamed the field in both the query's TypeScript shape and the
stat-tile reducer from `activeMinutes` → `exerciseMinutes`, matching the
real backend contract. Also updated
`concord-frontend/tests/self-lens-states.test.tsx`'s Fitness-tab test: its
mock data previously used the same wrong field name (`activeMinutes`) but
never asserted on the Active min value, so it silently passed either way.
The mock now uses `exerciseMinutes` (matching the real shape) and the test
asserts the rendered sum (30+45=75) — verified this pins the fix by
temporarily reverting the page change and confirming the test fails with
the old field name, then restoring it.

## Left alone (already real, verified against the actual handler source)

- `self.overview` / `self.layout` / `self.saveLayout` — `OverviewDashboard.tsx` reads exactly `{ tiles, cards, totalReadings, hasData }` / `{ tiles, isDefault, available }`, matching `server/domains/self.js:489`/`413`/`399`.
- `self.trend` — `TrendPanel.tsx` reads `{ metric, label, unit, higherBetter, days, series, stats }`, matching `server/domains/self.js:168`.
- `self.correlate` — `CorrelationPanel.tsx` reads `{ links: [{metricA, metricB, r, sampleDays, insight}] }`, matching `server/domains/self.js:212`.
- `self.goals` / `setGoal` / `removeGoal` — `GoalsPanel.tsx` reads `{ goals: [{metric,label,unit,period,target,current,percent,met}], available }`, matching `server/domains/self.js:299`/`273`/`288`.
- `self.digest` — `DigestPanel.tsx` reads `{ range, generatedAt, headline, stats, readingCount }`, matching `server/domains/self.js:340`.
- `self.streaks` — `StreaksPanel.tsx` reads `{ overall, loggedToday, perMetric, bestStreak, activeDays }`, matching `server/domains/self.js:427`.
- `self.importBatch` — `ImportPanel.tsx` reads `{ imported, skipped, total, source, errors }`, matching `server/domains/self.js:136`.
- `self.logMetric` — `LogMetricForm.tsx`, matching `server/domains/self.js:99`.
- **Mood tab** — `affect.trends` returns exactly `{ hasData, overallAvg, entryCount, dayOfWeek: [{label, avgMood, count}] }` (`server/domains/affect.js:712`), matching the page's local type and render.
- **Rituals tab** (`DailyRituals`) — only substrate-backed props (`streak` from `self.streaks`, `suggestedAction` from `beats.list`) are passed; every other prop is intentionally left `undefined` per the H2 wiring comment in the page, which documents exactly why (no login-diff/overnight-digest/community-board/forecast/daily-challenge substrate exists). Verified `beats.list` really returns `{ ok, beats }` (`server/domains/beats.js:19`), matching the page's direct `.beats` read (no `.result` wrapper — correctly handled).
- **Sleep / Journal tabs** — honest cross-lens CTAs, make no backend call, correctly documented as such in the source (no `sleep_hours`-specific substrate beyond the self-ledger metric; journaling lives in the Mental Health lens).
- **Achievements tab** — reads `GET /api/world/achievements/:userId` → `getAchievements()` (`server/lib/world-progression.js:439`), matching the page's field mapping (`id`, `name`, `description`, `category`, `unlocked`, `progress`, `target`). `unlockDate`/`worldImpact` are always `undefined` from this source (that lib tracks unlock as a bare `Set`, no timestamp) — both are optional props on `AchievementSystem` and conditionally rendered only when present, so this is an honest gap, not a fabrication. A richer, DB-backed achievement system exists in parallel (`/api/achievements/catalog` + `/api/achievements/mine`, real `earned_at` timestamps) and is what `AchievementSystem` falls back to internally when given an empty `achievements` prop — but `docs/lens-specs/self.md` explicitly documents `/api/world/achievements/:userId` as this lens's intended achievements source, and `self-lens.test.js` pins tests specifically against `getAchievements()`'s unlock-idempotency contract. Not changed this pass — flagged here as a **CURATION-adjacent / ENGINEERING** future item (add unlock-timestamp tracking to `world-progression.js`, or switch this tab to the DB-backed system) rather than silently left undocumented.
- **Milestones / Season tabs** (`ProgressionPanel`, `SeasonalContent`) — both self-fetch real data (`progression.creator_summary`, `seasonal.events-list`/`challenges-list`/`competitions-list`) when mounted with no props; the self page intentionally passes no props, letting them run their own real fetch. Confirmed honest (no seed-data fallback, empty states on fetch failure).
- **SelfFeed** — real `reddit.com` fetch (r/selfimprovement etc.), not fabricated, unchanged.

## Verification

- `cd server && node --check domains/self.js` — clean.
- `cd server && node --test tests/self-lens.test.js tests/self-domain-parity.test.js` — 34/34 pass (self-lens.test.js: 18/18; self-domain-parity.test.js: 16/16).
- `cd server && node --test tests/depth/self-behavior.test.js` — 1/1 pass.
- `cd concord-frontend && npx vitest run tests/self-lens-states.test.tsx` — 10/10 pass (includes the new Active-min assertion; confirmed it fails against the pre-fix field name).
- `cd concord-frontend && npx eslint app/lenses/self/page.tsx tests/self-lens-states.test.tsx` — clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (self stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` — self: `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens self` — `1/13` (`readings`, judged legitimate-unsurfaced above; unchanged by this fix).
- No `tsc` run per standing rule (prior parallel-batch OOM).
