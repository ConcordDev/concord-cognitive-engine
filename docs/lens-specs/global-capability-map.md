# Global Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("global"' server/domains/global.js
```
→ **12** macros, all `registerLensAction("global", ...)`. `server/domains/global.js`
is 1,002 lines.

```
grep -rl '"global"' server/domains/*.js server/server.js
```
→ only `server/domains/global.js` registers the exact `"global"` domain
string (server.js has plenty of the *word* "global" as an adjective, e.g.
`globalThis`, `_concordSTATE`, but no `registerLensAction("global"` /
`register("global"` calls of its own). No duplicate/competing registration.

Despite the generic name, this is **not** a cross-cutting platform-settings
lens or a news/geopolitics feed — reading all 12 handlers end to end shows
two distinct generations:

- **3 original "creative-tools" pure-compute macros** (`crossDomainSearch`,
  `aggregateDashboard`, `correlationMatrix`, lines 66–554): domain-agnostic
  analytics primitives — TF-style relevance search with dedup + diversity
  scoring, min-max/z-score/percentile normalization with composite-index +
  grading, and Pearson/Spearman correlation with collinearity detection.
  They read their working data from `artifact.data` (the classic
  `registerLensAction(ctx, artifact, params)` shape), not from `params`
  directly.
- **9 live World Bank Open Data macros** (lines 556–1001, comment: "LIVE
  WORLD BANK DATA-EXPLORATION MACROS"): `indicatorTimeseries`, `choropleth`,
  `compareCountries`, `scatterExplorer`, `searchIndicators`, `countryProfile`
  (all hit `https://api.worldbank.org/v2` through `cachedFetchJson`, 30 min
  TTL, no API key) plus `saveView` / `listViews` / `deleteView` (per-user
  shareable-view CRUD over an in-memory `globalThis._concordSTATE.globalSavedViews`
  Map). So this lens is, in practice, **a World Bank / Our World in Data
  style country-development-data explorer**, with three generic
  cross-domain analytics tools bolted on for power users.

Every World Bank macro fails **honestly** on network error or bad input —
`INDICATOR_CODE_RE`/`COUNTRY_CODE_RE` validate before any fetch, and a fetch
failure returns `{ ok:false, error: "World Bank unreachable: …" }`, never
synthetic data.

**Key backend fact that shaped the fix (verified by reading `server.js:39562-39568`):**
`POST /api/lens/run` (the route the `lensRun()` frontend helper calls
directly) builds a **virtual artifact** — `{ id:null, domain, type:
"domain_action", data: rest, meta:{} }` — where `rest` **is** the caller's
`params`/`input` object. So `crossDomainSearch`/`aggregateDashboard`/
`correlationMatrix`, despite reading `artifact.data.sources` /
`artifact.data.metrics` / `artifact.data.variables`, can be called directly
via `lensRun('global', 'aggregateDashboard', { metrics: [...] })` with **no
persisted artifact required** — `artifact.data.metrics` resolves to
`params.metrics`. This was the load-bearing discovery: the frontend's old
"Actions" tab used the *other* execution path (`useRunArtifact`, which POSTs
to `/api/lens/:domain/:id/run` against a real stored artifact row) and so
needed an artifact that could never be created — an unforced detour around a
perfectly reachable direct call.

`node scripts/lens-unsurfaced.mjs --lens global` → `global: 0/12 macros never
referenced in the frontend`, both before and after this pass. That number
was **necessary but not sufficient** going in: 3 of the 12
(`crossDomainSearch`, `aggregateDashboard`, `correlationMatrix`) were
"referenced" only through the dead artifact-detour above — every button that
called them was permanently `disabled` in production (see Classification).

## Reference apps

- **World Bank DataBank** (`databank.worldbank.org`) — the canonical
  indicator-explorer UX: pick indicator(s) + country(ies) + years, get a
  table/chart, save/share a query. This lens's `DataExplorer` component
  already tracks this closely (choropleth / time series / compare / scatter
  / catalog / profile, all six DataBank-style modes).
- **Our World in Data** (`ourworldindata.org`) — the "grid of real charts +
  narrative" idiom, and specifically its **"Correlates"/scatter-explorer**
  feature (does X correlate with Y across countries?) and its composite
  cross-indicator rankings — the direct model for the two new tabs added in
  this pass.
- **Gapminder** — animated bubble/scatter across time, already covered by
  the existing `scatterExplorer` mode.
- **REST Countries** (via `CountryAtlas`) — quick per-region country facts;
  already real, unchanged.

## Classification (before this pass)

**Mixed, with the defect concentrated in the page shell, not the
components.** The dedicated `components/global/*` files (`DataExplorer.tsx`,
`WorldBankPanel.tsx`, `CountryAtlas.tsx`, `CountryPicker.tsx`,
`IndicatorPicker.tsx`) were **entirely real** — all 9 World Bank macros
wired through a genuinely well-designed six-mode explorer with save/share
views, a REST Countries atlas, and a compact World Bank sparkline panel. No
fabrication anywhere in those five files.

The defect was in `app/lenses/global/page.tsx` (726 lines), which wrapped
the real explorer in three fabricated/dead tabs:

1. **"Regions" tab — 100% fabricated data styled as live.** A hardcoded
   `REGIONS` array (`North America` index `87`, `Europe` `82`, … six
   entries with fixed `index`/`trend` numbers that never changed) rendered
   as animated progress bars, **plus a `Math.random()`-driven 12-bar
   "sparkline" recomputed on every render** (`const h = 20 + Math.random() *
   80`) — sitting directly beneath the genuinely-live `WorldBankPanel`
   (labeled "REAL data" in its own header) and the real `DataExplorer`.
   This is exactly the CLAUDE.md defect pattern: an invented number
   dressed up next to real data.
2. **"Indicators" tab — the same fabricated `REGIONS` array, second skin.**
   A sorted list of the identical six hardcoded index numbers as horizontal
   bars. No new data, no macro call — pure duplication of tab 1's fabrication.
3. **"Actions" tab — a permanently-dead generic button wall.** Three
   buttons for `crossDomainSearch` / `aggregateDashboard` / `correlationMatrix`,
   gated on `globalArtifacts[0]?.id` from `useLensData('global',
   'global-dataset', { seed: [] })`. The seed array was empty (so dev-mode
   auto-seed never fired) and **no UI path anywhere in the codebase ever
   creates a `global-dataset` artifact** (`grep -rn "global-dataset"
   concord-frontend/` had exactly one hit: the page's own disabled-button
   copy, *"Create a global-dataset artifact first to run actions."*, which
   named a creation flow that didn't exist). The three buttons were
   permanently disabled in any real deployment — the exact "generic
   artifact-store detour that's actually a dead end" pattern this audit was
   briefed to look for. The macros themselves (verified by reading
   `server/domains/global.js:66-554`) are real, well-tested compute — they
   just had no reachable door, and the door the page pointed at (persist an
   artifact) was the wrong door (see the virtual-artifact fact above).

Stat cards at the top of the page compounded #1/#2: `Regions` (`REGIONS.length`),
`Trending Up` (`REGIONS.filter(trend==='up').length`), and `Avg Index`
(mean of the hardcoded indices) were all derived from the same fabricated
array, presented as summary metrics beside the one real stat (`Total DTUs`).

The "Trends" tab (DTU browse/search/paginate/sync-to-lens) was real but
mislabeled — it's a personal-corpus browser, not live global "trends."

## What changed

- **`concord-frontend/components/global/DevelopmentIndex.tsx` (new)** —
  replaces the "Regions" + "Indicators" tabs with a real **Global
  Development Index**. User picks 2+ curated indicators; for each, the
  component calls `global.choropleth` (latest real value per country,
  World Bank's own reporting set); every `(country, indicator)` pair is fed
  to `global.aggregateDashboard` as `{ domain: countryCode, name:
  indicatorCode, value, higherIsBetter }`. The macro's own min-max
  normalization (computed from the *actual* fetched values, not an invented
  benchmark) produces the ranking, grade, strengths/weaknesses — the same
  engine the old dead "Actions" tab left stranded, now running on real
  data. Renders a sortable, expandable ranked table (expand a country to
  see its per-indicator raw value + normalized contribution) plus a
  `SaveAsDtuButton` export (`apiSource: "worldbank"`).
- **`concord-frontend/components/global/IndicatorCorrelations.tsx` (new)**
  — replaces the dead `correlationMatrix` button with a real **Indicator
  Correlations** explorer (the Our World in Data "correlates" idiom — e.g.
  does internet access correlate with life expectancy across countries?).
  Fetches `global.choropleth` per selected indicator (2–6), intersects the
  country sets so every variable has an aligned value for the same country,
  then calls `global.correlationMatrix` for real Pearson/Spearman
  coefficients, significance, and collinearity — all macro-computed.
- **`concord-frontend/app/lenses/global/page.tsx` (rewritten)** — removed
  the `REGIONS` fabricated array (and its `Math.random()` sparkline), the
  "Regions" and "Indicators" tabs, and the entire dead "Actions" tab
  (button wall + `useLensData`/`useRunArtifact` artifact-detour +
  ~250 lines of per-macro result-rendering JSX that could never fire).
  Replaced with 4 tabs: **Data Explorer** (unchanged, already real),
  **Development Index**, **Correlations**, and **Search** (renamed from
  "Trends" to accurately describe what it does). The stat cards now show
  `Total DTUs` (live), `Saved Views` (live, `global.listViews` per-user
  count), `Countries Curated` and `Indicators Curated` (accurate static
  counts of the real catalogs `CountryPicker`/`IndicatorPicker` actually
  offer — no invented "index").
  - **"Search" tab** now also runs `global.crossDomainSearch` for real: on
    a ≥2-character query it fetches `global.searchIndicators` for World
    Bank catalog matches and merges them with the already-loaded DTU corpus
    as two sources (`{domain:'your DTUs', items}` / `{domain:'World Bank
    catalog', items}`), calling `crossDomainSearch` directly via `lensRun`
    (no persisted artifact — see the virtual-artifact fact above) and
    rendering the real relevance-ranked, deduplicated, diversity-scored
    merged list above the existing DTU pagination list. This gives
    `crossDomainSearch` a genuine, reachable home instead of a disabled
    button.
- **`concord-frontend/components/global/indicators.ts`** — was dead code
  (zero import sites anywhere in the codebase before this pass, confirmed
  by grep). Now imported and used by `DevelopmentIndex.tsx`,
  `IndicatorCorrelations.tsx`, and `page.tsx` (its `INDICATORS`/`COUNTRIES`
  catalogs + `formatIndicatorValue`/`indicatorLabel` helpers back the new
  tabs and the stat cards) — no longer orphaned.
- **No backend changes.** All 12 macros in `server/domains/global.js` were
  already real, correct, and covered by existing tests (see Verification) —
  this was purely a frontend reachability + fabrication fix.

## Verification

- `cd concord-frontend && npx eslint app/lenses/global/page.tsx components/global/DevelopmentIndex.tsx components/global/IndicatorCorrelations.tsx components/global/indicators.ts components/global/CountryPicker.tsx components/global/IndicatorPicker.tsx components/global/WorldBankPanel.tsx components/global/DataExplorer.tsx components/global/CountryAtlas.tsx` → **clean, exit 0** (one pre-existing `react-hooks/exhaustive-deps` warning on `items` was fixed in the same pass by wrapping it in `useMemo`).
- Fabrication re-grep: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/global/page.tsx components/global/*.tsx` → the only hit is a doc-comment in `DevelopmentIndex.tsx` *describing* the removed `Math.random()` sparkline, not live code.
- Dead-artifact re-grep: `grep -rn "global-dataset" concord-frontend/` → only doc comments explaining what was removed (plus a stale `.next` build cache entry, not source).
- `node scripts/lens-unsurfaced.mjs --lens global` → still `0/12 macros never referenced in the frontend`, but now genuinely reachable (verified by reading every new call site) rather than reachable-through-a-disabled-button.
- Manual type read-through in place of a full-project `tsc` (avoided here to not race the 5 sibling agents editing other lenses concurrently in the same working tree): `lensRun<T>()` generics on all new calls match the shapes read off the result (`ChoroplethResult`/`DashboardResult`/`CorrelationResult`/`CrossDomainResult` interfaces are structural subsets of what the macros return, verified against the exact `result:` object literals in `server/domains/global.js`); `SaveAsDtuButton` props (`apiSource`, `apiUrl`, `title`, `content`, `extraTags`, `rawData`, `compact`) match its exported `SaveAsDtuButtonProps` interface exactly.
- Backend tests (no backend files touched, re-run to confirm nothing regressed):
  - `cd server && node --test tests/global-domain-parity.test.js` → **24/24 pass**.
  - `cd server && node --test tests/depth/global-behavior.test.js` → **pass** (boots the in-memory server via the depth harness; full internal suite green, 0 fail).
- Did not touch any file outside `server/domains/global.js` (read-only,
  confirmed already-real, no changes needed), `app/lenses/global/page.tsx`,
  and `components/global/{DevelopmentIndex.tsx (new), IndicatorCorrelations.tsx (new), indicators.ts}`.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
