# Forecast Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -n 'register("forecast"' server/server.js
```
→ **11** macros (`compose`, `recent`, `multiDay`, `hourly`, `regional`,
`accuracy`, `archive`, `subscribeAlert`, `listAlerts`, `unsubscribeAlert`,
`checkAlerts`), all registered **inline in `server/server.js`** starting at
line 76689 — **there is no `server/domains/forecast.js` file at all.** This
is the same filename-mismatch tooling gap documented for `filmstudios.js`/
`creativewriting.js`/`event-timeline.js` in the film-studios and other
capability maps, but one step further: those cases had a domain file with a
mismatched *name*; `forecast` has **no domain file whatsoever** to mismatch.
`node scripts/lens-unsurfaced.mjs --lens forecast` fails closed with "no
registered macros found" because the script's `--lens` filter only scans
`server/domains/*.js` by filename stem (`files.filter(f => f ===
'forecast.js')`), and there is no such file to match. Worked around by
manually extracting all 11 action names via grep and checking each against
`concord-frontend/{app,components,lib}` with the same loose token-match the
script itself would use — see "Classification" below.

All 11 macros are thin `try { await import("./lib/world-forecast.js"); ... }`
wrappers around **`server/lib/world-forecast.js`** (535 lines), which is the
actual engine and where nearly all the logic and every DB read/write lives.
This is a **Phase 9.3 (idea #16) "Concordia weather forecasting"** system —
an in-world outlook composer, not a real-meteorology tool. It combines four
real substrates, every one of them already documented elsewhere in
`CLAUDE.md`:

- **Layer 7 embodied signals** (`server/lib/embodied/signals.js`,
  `signalsForWorld`) — real per-cell temperature/humidity/weather-kind
  baselines written by the `environment-sensor` heartbeat.
- **Layer 11 faction strategy** (`faction_strategy_state` table) — each
  faction's next planned move + ETA.
- **Layer 10 forward-sim** (`forward_predictions` table) — the subconscious
  brain's (or deterministic fallback's) speculative "premonitions."
- **Layer 12 drift monitor** (`server/emergent/drift-monitor.js`,
  `getDriftAlerts`) — high-severity contradiction/drift findings.

`composeForecast` is genuinely deterministic and honest by construction: it
wraps each substrate read in its own `try/catch` (a substrate that isn't
present just leaves that section `null`/`[]` — never fabricated), and a
"barren world" with zero seeded signals composes `{ ok: true, weather: null,
factions: [], events: [] }`, not invented data (pinned by
`forecast-domain-macros.test.js`'s `"composeForecast returns ok with empty
sections on a barren world (no fake data)"` case). The 6 extension functions
(`composeMultiDay`, `composeHourly`, `composeRegional`, `forecastAccuracy`,
`forecastArchive`, the alert-subscription CRUD + `evaluateAlerts`/
`checkAlerts`) are all real, non-trivial, and documented in the file's own
comments as deliberately non-fabricating:
- `composeMultiDay`: confidence decays `0.88^d` per day out, floored at
  0.12; temperature drift is a **deterministic hash** of `(worldId, day)`,
  not `Math.random()` — same world state → same multi-day curve every time.
- `composeHourly`: temperature follows an actual diurnal cosine model
  (coldest ~05:00, warmest ~15:00) anchored on the measured baseline — not
  invented per-hour noise.
- `composeRegional`: reads real `embodied_signal_log` rows at 7 deterministic
  per-district anchor points (`regionAnchor`, a hash-seeded ring around world
  origin) — a district with no measured signals honestly reports
  `hasData: false`, never a synthesized reading.
- `forecastAccuracy`: pairs each past persisted forecast against the
  persisted forecast closest to its 24h target window and scores real
  kind-hit-rate + mean temperature error — both sides are real
  `world_forecasts` rows, nothing is synthesized to produce a score.
- Alert subscriptions (`createAlertSub`/`listAlertSubs`/`deleteAlertSub`/
  `checkAlerts`) persist to a real `forecast_alert_subs` table (created
  on-demand) and `checkAlerts` composes a **fresh** forecast and evaluates it
  against the user's subscriptions on demand — there is no push/heartbeat
  delivery (see Classification below).
- A **fail-closed numeric guard** (`badNumericField`) rejects
  `NaN`/`Infinity`/negative/>1e6 `days`/`hours`/`limit` inputs with an
  explicit `error` field instead of silently clamping through
  `Math.min`/`Math.max` — pinned by both test files' "assassin V2" /
  "poisoned" cases.

Backend test coverage: `server/tests/forecast-domain-macros.test.js` (33
assertions, drives the lib directly against a real in-memory schema with
seeded climate/faction/prediction rows, asserting exact computed values, not
just shapes) + `server/tests/forecast-domain-parity.test.js` (contract tests
per macro). Both pre-existed this pass and both were green before and after
(see Verification).

## Reference apps

This is an **in-world simulation outlook**, not real meteorology, so the
honest reference framing blends two categories:
- **NOAA/Windy-class forecast dashboard** for the weather-shaped surfaces:
  current conditions, multi-day outlook, hourly breakdown, per-region/station
  forecasts, forecast-verification/accuracy tracking (NOAA publishes model
  verification scores; Windy shows multi-model spread), historical archive,
  and severe-weather alert subscriptions.
- **A strategic-intelligence outlook tool** (the closest honest analog for
  the faction-strategy + drift + forward-sim sections, which have no real
  meteorological equivalent) — think a palace-intrigue/geopolitical "watch
  list" merged into the same feed: predicted actor moves with confidence and
  ETA, anomaly/contradiction alerts, and a premonitions feed.

**Parity target, in the owner's framing**: the only difference between this
lens and a NOAA/Windy-style dashboard should be that it's forecasting a
simulated world's emergent state instead of Earth's atmosphere — not that
it's missing dashboard-standard views (multi-day, hourly, regional, accuracy,
archive, alerts), all of which the backend already supports.

## Classification (before this pass)

**Already excellent — no fabrication found, all 11 macros already wired to
real, bespoke, non-generic components.** Read the full `page.tsx` (265
lines) and all 7 `components/forecast/*.tsx` files (762 lines total) in
full. `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|TODO\|FIXME"
components/forecast/*.tsx app/lenses/forecast/page.tsx` → **zero hits**.
There is no `ManifestActionBar`/`AutoActionStrip`/`RecentMineCard`-only
generic-scaffold body — the page mounts 7 bespoke tab components
(`WeatherForecast`, `MultiDayOutlook`, `HourlyBreakdown`, `RegionalForecast`,
`ForecastAccuracy`, `ForecastArchive`, `AlertSubscriptions`), each reading
its own macro and rendering a real chart (`ChartKit`) or structured list, not
a JSON-paste textarea or a raw button wall. `RecentMineCard`/
`AutoActionStrip` do appear (bottom of the page, `hideWhenEmpty`), but as
genuine supplementary widgets alongside 7 substantial bespoke panels, not as
the page's entire body — the pattern the honest grader's `GENERIC_TRIO`
detector is designed to catch is a thin page with *only* those three; this
page is not that.

### Per-macro reference-parity classification

| Macro | UI tab / caller | Classification |
|---|---|---|
| `compose` | "24h" tab, "Refresh forecast" button | **ALREADY REAL** — calls with `persist: true`, renders weather/ecology/faction/events/drift sections, each conditionally shown only when the backend actually returned data. |
| `recent` | "24h" tab, on mount / worldId change | **ALREADY REAL** — 4-state contract (loading `role="status"`, error `role="alert"` + Retry, empty "No forecast yet", populated), pinned by `tests/components/ForecastLensPage.test.tsx` (5/5). |
| `multiDay` | "Multi-day" tab, `MultiDayOutlook.tsx` | **ALREADY REAL** — real `ChartKit` area chart (temp + confidence series) plus a per-day list, day-range selector (3/5/7/10/14), honest "No data yet" empty state. |
| `hourly` | "Hourly" tab, `HourlyBreakdown.tsx` | **ALREADY REAL** — real `ChartKit` line chart (temp + humidity), hour-window selector (12/24/36/48), honestly distinguishes "no embodied temperature baseline for this world yet" from a genuinely empty response. |
| `regional` | "Per-district" tab, `RegionalForecast.tsx` | **ALREADY REAL**, and enhanced this pass (see below) — per-district cards keyed off real `embodied_signal_log` reads, `hasData` honestly gates each card. |
| `accuracy` | "Accuracy" tab, `ForecastAccuracy.tsx` | **ALREADY REAL** — kind hit-rate + mean temp error stat tiles + a scrollable comparison list, correctly explains the "needs ≥2 persisted forecasts spanning 24h" precondition instead of showing a misleading zero. |
| `archive` | "Archive" tab, `ForecastArchive.tsx` | **ALREADY REAL** — real `ChartKit` trend line (temp + ecosystem score over persisted history) + a chronological entry list. |
| `subscribeAlert` | "Alerts" tab, `AlertSubscriptions.tsx` "Add subscription" | **ALREADY REAL** — 4 real trigger kinds (severe_event/drift/weather/any), min-confidence slider, optional weather-kind filter. |
| `listAlerts` | "Alerts" tab, on mount | **ALREADY REAL**. |
| `unsubscribeAlert` | "Alerts" tab, "remove" per row | **ALREADY REAL**. |
| `checkAlerts` | "Alerts" tab, "Check against fresh forecast" button | **ALREADY REAL**, but the surrounding copy overclaimed automatic delivery — **fixed this pass** (see below; classified BACKEND-CAPABLE-BUT-HONESTY-GAP, not fabrication: the macro itself was already real and correctly wired, only the UI's wording implied a push mechanism that doesn't exist). |

### Reference-checklist items beyond the 11 macros

- **Real-world weather comparison widget** (`WeatherForecast.tsx`, mounted at
  the bottom of the page, all 7 tabs): pulls **live** Open-Meteo data
  (current + 7-day) for a hand-picked list of real cities, with a
  `SaveAsDtuButton` to ingest it as a citable DTU. This does **not** call any
  `forecast.*` macro — it's a deliberate use of Concord's "real external data
  → DTU" ingest pattern (the same shape as `eco.weather-forecast`,
  `travel.weather-forecast`, `ocean.marine-forecast` elsewhere in the
  codebase), openly labeled `open-meteo.com · live`, not a mislabeled or
  fabricated source. **ALREADY REAL**, left untouched — it's honest (real
  API, real data, correctly attributed) and gives users a genuine real-Earth
  reference point next to the in-world forecast, which is arguably the most
  literal reading of "the only difference should be the data source."
- ~~**Automatic/pushed alert delivery**~~ **CLOSED (2026-07-16, `42489956`)**
  — new `forecast-alert-sweep` heartbeat (~5min cadence) queries the real
  `DISTINCT user_id, world_id` pairs off `forecast_alert_subs`, calls the
  pre-existing `checkAlerts` per pair, and on a genuine trigger emits a new
  `forecast:alert-triggered` event to that user's socket room — exactly
  the extension point named above, now built. Honest scope preserved:
  live delivery to a connected tab via socket.io, not OS-level push (no
  service-worker Web Push pipeline exists). `AlertSubscriptions.tsx` now
  subscribes to the live event with an honest connected/disconnected
  label, keeping the manual "Check against fresh forecast" as the
  fallback for a tab that was closed when the alert fired.
- **Spatial/map view of the 7 districts** (a NOAA/Windy-class dashboard
  typically has a map, not just cards). The backend already returns each
  district's real world-space anchor (`regionAnchor` — a deterministic ring
  around world origin) alongside its data. **BACKEND-CAPABLE-BUT-UNSURFACED**
  → **fixed this pass** (see below): a compact SVG "district compass" now
  plots every anchor at its true position, color-coded by `hasData`, clickable
  to cross-highlight the matching detail card. (Not routed through the
  existing `components/viz/MapView.tsx` primitive: that component's public
  contract is `lat`/`lon` geographic degrees and labels every marker with
  `lat.toFixed(3), lon.toFixed(3)` — remapping Concordia's ±1.4km world-space
  meters through it would print fabricated-looking "degree" coordinates next
  to real data, a real honesty regression. A small dedicated radial-plot
  component was built instead, using the genuine anchor units.)
- **Discoverable keyboard shortcuts** (CLAUDE.md's fluidity invariant: every
  lens's shortcuts must be discoverable, not just functional). Audited: the
  page registered exactly one `useLensCommand` entry, bound to `?`, whose
  `action` was a no-op (`() => { /* surfaced via tooltip */ }` — there was no
  tooltip). **Confirmed real gap, fixed this pass** (see below).

## What changed

- **`concord-frontend/app/lenses/forecast/page.tsx`** — replaced the single
  inert `?` shortcut with 9 real, functioning `useLensCommand` bindings:
  `1`-`7` switch to each of the 7 tabs (matching the established
  numeric-tab-shortcut convention used by `accounting`/`agents`/`answers`),
  `c` composes+persists a fresh forecast, `r` re-fetches the cached one.
  These are surfaced automatically through the existing command-palette /
  shortcut-help-modal machinery (`useKeyboard`), the same discovery path
  every other lens's shortcuts use.
- **`concord-frontend/components/forecast/AlertSubscriptions.tsx`** —
  honesty-fixed the empty-state and added-subscriptions copy, which
  previously read "add one above to get notified of predicted severe
  events" (implies an automatic push that doesn't exist). Now explicitly
  states checks are on-demand via the "Check against fresh forecast" button,
  with no background push yet.
- **`concord-frontend/components/forecast/RegionalForecast.tsx`** — added a
  `DistrictCompass` sub-component: a small dependency-free SVG radial plot of
  all 7 districts at their real backend-computed anchor positions
  (`reg.anchor.x`/`reg.anchor.z`, unmodified data already returned by
  `forecast.regional`), color-coded emerald (measured) vs. zinc (no data),
  with an SVG `<title>` per point for accessible hover detail. Clicking a
  point or a detail card sets a shared `selectedId` that highlights the
  matching card with a cyan ring — a real two-way cross-reference between
  the spatial view and the data view, not decorative.

No backend changes were needed — every gap found was a frontend
presentation/wiring/copy issue, not a missing macro or missing data.

## Verification

- `cd concord-frontend && npx eslint app/lenses/forecast/page.tsx components/forecast/AlertSubscriptions.tsx components/forecast/RegionalForecast.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p . 2>&1 | grep -i forecast` — no output (0 errors touching this lens).
- `cd concord-frontend && npx vitest run tests/components/ForecastLensPage.test.tsx` — **5/5 pass**, unaffected by the keyboard-shortcut change (the test mocks `useLensCommand`).
- `cd server && node --test tests/forecast-domain-macros.test.js tests/forecast-domain-parity.test.js` — **33/33 pass** (16 tests / 6 suites in `-macros`, 17 tests / 8 suites in `-parity`; combined run reports 33 tests / 14 suites / 0 fail), unaffected — no backend files were touched.
- Re-grep for fabrication after the edit: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" concord-frontend/components/forecast/*.tsx concord-frontend/app/lenses/forecast/page.tsx` → still zero hits.
- Manual re-check of all 11 macro names against the frontend post-edit: all 11
  still called from real designed components; no macro's caller was removed
  or weakened.
- Did not touch `MultiDayOutlook.tsx`, `HourlyBreakdown.tsx`,
  `ForecastAccuracy.tsx`, `ForecastArchive.tsx`, `WeatherForecast.tsx`, or
  `server/lib/world-forecast.js` / `server/server.js` — no gap was found in
  any of them after auditing their macro coverage and fabrication surface.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
