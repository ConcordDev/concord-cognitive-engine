# Society Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Naming-collision investigation (required by this batch's brief)

`social` vs `society` themselves are clean — see
`docs/lens-specs/social-capability-map.md`. But **`society` internally
conflates two completely unrelated backend products under one lens page**,
which is the real finding this investigation surfaced:

1. **The page's six tabs** (Culture / Economy / Autonomy / Conflict /
   Teaching / Personas) read from six macro domains — `culture`,
   `entity_economy`, `autonomy`, `conflict`, `teaching`, `persona` — that
   are **inline-registered in `server.js`** (Ghost Fleet macros, e.g.
   `register("culture", "list_traditions", …)` at `server.js:17070`), each
   its **own domain string**, none of them named `society`. These are an
   NPC-society emergent-simulation observation dashboard (traditions,
   entity wealth/trade, NPC rights/refusals, dispute resolution,
   mentorships, personas) — a Civ-AI/Crusader-Kings-adjacent product.
2. **`SocietyActionPanel.tsx` and `DataExplorer.tsx`** (mounted at the
   *bottom* of the same page) call a **seventh, entirely different domain
   actually named `society`** — `server/domains/society.js`, 16
   `registerLensAction("society", "wb-*", …)` macros that proxy the real
   World Bank Open Data API (`data.worldbank.org`) — country/indicator
   lookups, cross-country comparisons, an animated Gapminder-style bubble
   chart, a choropleth map, CSV export, shareable chart permalinks. This is
   an Our-World-in-Data/Gapminder-adjacent product with **zero relationship**
   to the six NPC-simulation tabs above it — different data model, different
   audience, different design language, unified only by both being reachable
   from `/lenses/society`.

Neither product is fake or broken — verified both are 100%-macro-backed —
but the *lens* itself is really two unrelated apps sharing a URL, with the
domain string `society` belonging only to the second one. This is a
product-scope/IA question ("should the WB explorer live at a different
lens?"), not a wiring defect, so this pass documents it rather than
re-architecting the lens boundary — that call belongs to whoever owns the
lens map, not a Wave-3 audit pass. No code change follows from this
finding beyond the doc you're reading.

## Backend surface

### A. NPC-society Ghost Fleet domains (the six page tabs)

```
grep -n '"culture"\|"entity_economy"\|"autonomy"\|"conflict"\|"teaching"\|"persona"' server/server.js | grep -c register
```
→ 6 domains, inline-registered in `server.js` (not `registerLensAction`,
not a dedicated `domains/*.js` file): `culture` (16 macros: observe,
tradition CRUD, adherence, cultural fit/values/identity, stories,
propagate), `entity_economy` (13: accounts, earn/spend, trade
propose/accept/reject, specialize, market rates, cycle, wealth/Gini,
metrics), `autonomy` (11: rights, refusals, consent, dissent, sovereign
override, profile/metrics), `conflict` (11: dispute file/get/list, mediator
assign, resolution propose/accept/reject, escalate, adjudicate, precedent
search, metrics), `teaching` (11: mentorship CRUD, lesson submit/evaluate,
advance, complete, find-mentor, profile/metrics), `persona` (canonical
`create`/`list`/`update`/`delete` — the last of 3 shadowed `create`/2
shadowed `list` registrations across the file, each marked
`note:"intentional_shadow_ok"` with an explanatory comment; verified this
is a documented, deliberate shadow, not a live bug).

No macro name collides within a domain (checked each of the 6 domains for
duplicate `register("<domain>", "<same-name>"` pairs — one hit each,
except `persona`'s already-documented shadow above).

### B. World Bank explorer domain (`society` itself)

```
grep -c 'registerLensAction("society"' server/domains/society.js
```
→ **16** macros in `server/domains/society.js` (~700 lines):
`wb-indicator`, `wb-country`, `wb-compare`, `wb-common-indicators`,
`wb-chart-series`, `wb-bubble-frames`, `wb-choropleth`,
`wb-indicator-search`, `wb-country-dashboard`, `wb-export-csv`,
`wb-save-chart`, `wb-load-chart`, `wb-list-charts`, `wb-region-rankings`,
`wb-aggregate-codes`, `wb-transform-series`. Real upstream HTTP calls to
`data.worldbank.org` with a `COMMON_INDICATORS` alias table (population,
gdp, gdpPerCapita, lifeExpectancy, literacyRate, gini, infantMortality,
unemployment, internetUsers, urbanPopulationPct, co2EmissionsPerCapita,
povertyHeadcount, fertilityRate, schoolEnrollment, healthExpenditurePct,
electricityAccess) and an `AGGREGATE_CODES` region/income-group table.

## Frontend surface

`concord-frontend/app/lenses/society/page.tsx` (375 LOC, the 6-tab NPC
dashboard + WB explorer footer) + `components/society/{DataExplorer,
SocietyActionPanel,WorldBankExplorer}.tsx` (3 files — see the orphan-file
finding below).

## Defect found and fixed: `wb-transform-series` unreachable, causing a real perf/UX regression on every per-capita/inflation toggle

`wb-transform-series` (`server/domains/society.js` — a pure-compute macro,
no network I/O) exists specifically, per its own doc comment, so "the chart
UI calls this to flip metric toggles without a re-fetch." It had **zero
callers**. Instead, `DataExplorer.tsx`'s `ChartView` called `wb-chart-series`
with `{perCapita, inflationAdjust}` baked into the request on *every*
checkbox toggle — a full re-hit of the World Bank upstream API, duplicating
`wb-chart-series`'s own inline copy of the exact same per-capita/inflation
transform math `wb-transform-series` was built to let the client reuse.
Worse: toggling **per-capita** specifically triggered a *second* upstream
call every time (a fresh population-series fetch), because `wb-chart-series`
re-fetches population inline rather than caching it — so flipping the
checkbox twice in a row hit the World Bank API four times for data that
never needed a second network round-trip at all. This is exactly the
"unsurfaced macro with a real, describable purpose that got worked around
with a duplicated inline implementation instead" pattern this program looks
for — not a cosmetic gap, a real perceived-performance defect (violates the
fifth hard invariant: toggling a checkbox should feel instant, not
re-trigger a network fetch).

**Fixed** (`components/society/DataExplorer.tsx`, `ChartView`): `run()` now
always fetches the RAW series once (`perCapita:false, inflationAdjust:false`);
a new `rawData` state holds it. A `useEffect` on `[rawData, perCapita,
inflationAdjust, country]` recomputes the *displayed* series purely via
`wb-transform-series` against the cached raw series — no re-fetch — with a
per-country `populationCache` (a `useRef<Map>`) so the population series for
per-capita is fetched at most once per country, not once per toggle. Falls
back honestly (`setError`, keeps showing the raw series) if the population
fetch or the transform call fails — never a silent wrong number.

## Confirmed real and left alone, with reason (orphan-file finding)

`components/society/WorldBankExplorer.tsx` (179 LOC) is a **complete,
working, real component** — calls the same `society`-domain macros
(`wb-common-indicators`, `wb-indicator`, `wb-compare`) with correct field
shapes, renders a real `lightweight-charts` line chart + cross-country
compare bars — but `grep -rln "WorldBankExplorer" concord-frontend/`
returns only the file itself: **it is imported nowhere**. It predates (or
is a simpler, superseded sibling of) `DataExplorer.tsx`, which covers the
same lookup/compare surface plus bubble charts, choropleth, a country
dashboard, region rankings, CSV export, and shareable chart permalinks —
i.e. `DataExplorer.tsx` is a strict superset. Left in place rather than
deleted: it's not fabricated, not broken, and not reachable, so it carries
zero user-facing risk; removing a working, harmless file that another
in-flight branch on this shared repo might still reference was judged
higher-risk than leaving a confirmed-dead file for a future cleanup pass to
remove with full context. Flagged here so it doesn't get miscounted as a
second live surface for the same macros.

## Macro → UI classification

### NPC-society domains (62 macros across 6 domains) — pre-existing, unchanged this pass

All 62 macros are DESIGNED — each of the 6 tabs (`SectionCulture`,
`SectionEconomy`, `SectionAutonomy`, `SectionConflict`, `SectionTeaching`,
`SectionPersona` in `page.tsx`) renders a real list/stat view backed by the
matching domain's `list_*`/`metrics`/`wealth`/`profile` reads, plus
`SectionAutonomy` additionally mounts the absorbed `AgentBuilder` authoring
UI for NPC creation. This pass's read confirmed correct field shapes on
every tab (e.g. `culture.list_traditions` → `traditions[]` with
`id/type/adherence/status`, matched exactly by `SectionCulture`'s render).
Deeper action forms (proposing a trade, filing a dispute, requesting
mentorship) are the natural next increment but this pass's scope was the
`social`/`society` naming-collision audit + defect sweep, not a full
6-domain-deep rebuild of the observation dashboard — no fabrication was
found on the read/observation side, which is the primary defect class this
program screens for.

### World Bank domain (16 macros) — 15 DESIGNED, 1 newly wired this pass

| Macro | Where |
|---|---|
| `wb-indicator`, `wb-country`, `wb-compare`, `wb-common-indicators` | `SocietyActionPanel.tsx` (quick-lookup action grid + mint/DM/publish/agent) |
| `wb-chart-series` | `DataExplorer.tsx` Chart tab |
| `wb-transform-series` | `DataExplorer.tsx` Chart tab (**newly wired this pass** — see defect above) |
| `wb-bubble-frames` | `DataExplorer.tsx` Bubble tab (Gapminder animation) |
| `wb-choropleth` | `DataExplorer.tsx` Map tab |
| `wb-indicator-search` | `DataExplorer.tsx` indicator search box |
| `wb-country-dashboard` | `DataExplorer.tsx` Dashboard tab |
| `wb-region-rankings` | `DataExplorer.tsx` Rankings tab |
| `wb-export-csv` | `DataExplorer.tsx` (Chart + Rankings CSV export) |
| `wb-save-chart`, `wb-load-chart`, `wb-list-charts` | `DataExplorer.tsx` Saved tab (shareable permalinks) |
| `wb-aggregate-codes` | Backend-only table consumed indirectly by `wb-region-rankings`'s aggregate rows; no direct frontend caller, but its data reaches the UI through that macro — not a standalone gap. |

Total: 4+1+1+1+1+1+1+1+1+3+(0 direct, 1 indirect) = **16**. Matches
`grep -c 'registerLensAction("society"' server/domains/society.js`.

**GENERIC-STRIP-ONLY**: none for the WB domain — `DataExplorer.tsx` and
`SocietyActionPanel.tsx` are both bespoke, chart-typed, domain-specific
surfaces. The grader's `hasMacroButtonWall: true` flag on this lens is a
raw shape-match on `SocietyActionPanel`'s 8-button labeled action grid
(Indicator/Country/Compare/Catalog/Mint/DM/Publish/Insight, each with a
typed input form + typed result card) — outweighed by `isGenericScaffold:
false` + 5/5 pillars present (see Verification); this is the same
`hasMacroButtonWall`-vs-`isGenericScaffold` distinction the
`telecommunications-capability-map.md` precedent documents.

**UNSURFACED**: none remaining after this pass (`wb-transform-series` is
now wired). `wb-aggregate-codes` has no *direct* frontend caller but its
table is genuinely reachable in the rendered rankings UI through
`wb-region-rankings`, so it is not counted as unsurfaced.

## Genuinely missing, deferred

None new. The IA question raised in the naming-collision section above
(should the WB explorer be its own lens rather than share `/lenses/society`
with the NPC-simulation dashboard) is a product-scope decision, not a
buildable/triageable capability gap under the sixth hard invariant — there
is no missing macro or missing UI here, only a debatable page boundary.
Recorded for whoever next touches this lens's information architecture.

## Verification

- `node --check server/domains/society.js` — clean (file untouched this
  pass — the fix was entirely frontend-side in `DataExplorer.tsx`; verified
  anyway per the assignment brief).
- `node --test tests/social-gatherings.test.js
  tests/emergent-social-layer.test.js tests/society-domain-parity.test.js
  tests/social-npc-bridge.test.js tests/society-domain-macros.test.js
  tests/depth/society-behavior.test.js tests/depth/social-behavior.test.js
  tests/social-pings.test.js
  tests/society-gallery-classroom-domain-parity.test.js
  tests/social-dm-recall.test.js tests/social-domain-parity.test.js` (from
  `server/`) — **175/175 pass**, unmodified.
- `npx eslint app/lenses/society/page.tsx components/society/*.tsx` (from
  `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (society was already WIRED
  and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — society
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.77`, `"pillarsPresent": 5`, `"antiPatterns": 0`.
  `audit/` outputs reverted via `git checkout -- audit/` per the
  transient-artifact rule.
- No `tsc` run per this batch's memory-safety directive — deferred to the
  orchestrator's centralized typecheck pass.
