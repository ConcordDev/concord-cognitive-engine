# resonance — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("resonance"' server/domains/resonance.js` → 11
> (engagementScore, audienceMatch, impactPrediction, proposePair, listPairs,
> resonanceGraph, pairDrilldown, resonanceAlerts, resonanceToInsight,
> listInsights, pairTrend) plus 3 more registered inline in `server.js` via
> the generic `register()` pattern: `grep -n 'register("resonance",' server.js`
> → `resonance.boundary` (:29339), `resonance.history` (:29601),
> `resonance.scan` (:29615) — the real cross-domain boundary-detection engine
> this lens is named for.

## Reference app + parity target

**A live signal-analysis instrument, not a dashboard** — closest real analogue
is a spectrum analyzer / SDR waterfall display (the page literally renders a
frequency-spectrum canvas + a radial constraint-boundary field) crossed with
an arXiv-grounded research tool. `page.tsx` (1499 → 1524 LOC) is a genuinely
substantial, bespoke build: two hand-rolled `<canvas>` visualizations
(`ResonanceFieldCanvas`, `ResonanceSpectrumCanvas`), a live/pairs/history/
health/growth tabbed instrument panel, threshold-configuration sliders, a
signal-classification legend, JSON/CSV export, and two large bespoke child
components — `CrossDomainWorkbench.tsx` (1017 LOC, surfaces all 8
`registerLensAction("resonance", ...)` analogy-tooling macros:
proposePair/listPairs/resonanceGraph/pairDrilldown/resonanceAlerts/
resonanceToInsight/listInsights/pairTrend) and `ResonanceArxiv.tsx` (80 LOC,
live arXiv feed of real physics resonance/synchronization papers — an honest
DATA-SOURCING win, no fabrication). `bespokeRatio` on the honest UX grader is
0.413 with `maxBespokeComponentLoc` 1018 — real depth, not scaffold.

## Findings

### `scan`/`historyData`/`growth` queries hit the wrong endpoints — REAL BUG (fixed)

The page's three core `useQuery` calls were pointed at completely
different-shaped endpoints than the ones the actual `resonance.boundary` /
`resonance.history` / `lattice.resonance` macros expose, so the entire "Live"
view — the centerpiece of the lens — was silently rendering defaults/zeros
forever:

- **Boundary scan** (`scan`, typed `BoundaryScan` with `signal`,
  `classification`, `frontier`, `interior`, `gradient`, `coherenceDirection`,
  `crossDomainAlignment.topPairs`) was fetched from
  `apiHelpers.emergent.latticeBeacon()` → `GET /api/lattice/beacon`, which
  returns an unrelated DTU-tier counter shape (`{ boundary: { totalDTUs,
  hyperCount, ... } }`). None of `BoundaryScan`'s fields exist in that
  response — every signal meter, the classification banner, and the pairs
  view were reading `undefined` and falling back to `0` / `'noise_floor'`.
  The real endpoint, `GET /api/resonance/boundary`
  (`runMacro("resonance","boundary",...)`), returns exactly the shape the
  page's own TypeScript interface expects.
- **History** (`historyData.readings`) was fetched from
  `apiHelpers.emergent.resonance()` → `GET /api/lattice/resonance`
  (`register("lattice","resonance")`), which returns `{ coherence,
  resonance: { homeostasis, continuity, ... } }` — no `readings` array at
  all, so the sparkline and history tab never had real data. The real
  endpoint is `GET /api/resonance/history`
  (`runMacro("resonance","history",...)` → `{ ok, readings, count }`).
- **Growth/health meters** (`homeostasis`, `repairRate` in the left rail and
  Health tab) were read as `growth?.growth?.homeostasis` /
  `growth?.growth?.maintenance?.repairRate` from
  `apiHelpers.guidance.health()` → `GET /api/system/health`, whose `health`
  object has a `growth: { dtusLast24h, dtusLast7d }` shape — no
  `homeostasis` field ever existed there, so that meter was permanently 0%.
  The real homeostasis/repair-rate snapshot lives at `GET /api/lattice/resonance`
  (the same `lattice.resonance` macro misused for history above) under
  `resonance.homeostasis` / `resonance.repairRate`.
- **"Scan Boundary" button** (`scanMutation`) called
  `apiHelpers.bridge.beacon()` → `POST /api/macros/run` with
  `{domain:'emergent', name:'bridge.beacon'}`, which runs
  `runBeaconCheck(STATE)` — an unrelated continuity-check macro with no
  connection to the boundary/pairs computation at all. Clicking "Scan
  Boundary" never advanced the resonance signal or wrote a new history
  point. The real action is `POST /api/resonance/scan`
  (`runMacro("resonance","scan",...)`), which computes a fresh boundary
  reading, persists it to `STATE.__resonanceHistory`, and returns the full
  `BoundaryScan`.

**Fix:** added a dedicated `apiHelpers.resonance` namespace in
`lib/api/client.ts` (`boundary()`, `scan()`, `history()`,
`latticeHealth()`) hitting the four correct routes, and repointed all three
queries + the scan mutation in `page.tsx` at it. Also added a `LatticeHealth`
TypeScript interface matching the real `lattice.resonance` macro shape and
fixed the `homeostasis`/`repairRate` field paths. Left the pre-existing
`apiHelpers.emergent.latticeBeacon` / `.resonance` / `apiHelpers.bridge.beacon`
helpers in place — they're used correctly elsewhere (`HeartbeatBar.tsx`,
`command-center/page.tsx`, `NerveCenter.tsx`) for their own, different
purposes; only this lens's usage was wrong.

### Honest "insufficient data" state added

`resonance.boundary` returns `{ ok:false, error:"Insufficient DTU density
for boundary detection", count }` when the corpus has fewer than 20 DTUs —
previously this rendered as a silent, unexplained 0% signal (indistinguishable
from a real "no cross-domain resonance detected" reading). Added a small
honest banner in the Live view that surfaces the real reason and DTU count
when `scan.ok === false`, so a genuinely-empty corpus doesn't read as a false
"noise floor" measurement.

### Fabricated-success envelope bug in the Domain Actions bar (fixed)

`handleResonanceAction` (drives the Engagement Score / Audience Match /
Impact Prediction buttons, via `useRunArtifact('resonance')` →
`POST /api/lens/:domain/:id/run` → `register("lens","run")`) only checked
the outer `res.ok`, which `register("lens","run")` sets to `true`
unconditionally (it unwraps an inner `.result` key but never propagates an
inner `{ok:false}`). A real handler failure (e.g. `engagementScore`'s
`catch` path returning `{ok:false, error:"handler_error", message}`) would
render blank `Score:`/`Tier:` fields dressed as a normal result, with the
error message tacked on as an aside instead of a clear failure state. Fixed
to also check `res.result?.ok === false` and render a clean "Action failed"
message in that case. (`CrossDomainWorkbench.tsx`'s 8 macros are unaffected —
they use the shared `lensRun()` helper in `lib/api/client.ts`, which already
unwraps nested envelopes and inner `{ok:false}` correctly.)

## Macro classification

| Macro | Surface | Class |
|---|---|---|
| `resonance.boundary` / `.scan` / `.history` | `page.tsx` Live/Pairs/History/Health tabs (now correctly wired) | DESIGNED |
| `resonance.engagementScore` / `.audienceMatch` / `.impactPrediction` | "Resonance Analysis" action bar, bespoke result cards per action | DESIGNED |
| `resonance.proposePair` / `.listPairs` / `.resonanceGraph` / `.pairDrilldown` / `.resonanceAlerts` / `.resonanceToInsight` / `.listInsights` / `.pairTrend` | `CrossDomainWorkbench.tsx` (1017 LOC bespoke UI) | DESIGNED |

All 14 macros are DESIGNED — none reached only through a generic
button-wall/JSON-paste surface. `ManifestActionBar`/`RecentMineCard`/
`AutoActionStrip` are present but supplementary to substantial bespoke
components (`bespokeRatio` 0.413), consistent with the grader's
`isGenericScaffold: false` verdict.

## Verify gate

- `npx eslint app/lenses/resonance/page.tsx lib/api/client.ts` — 0 errors/warnings.
- `npx tsc --noEmit` — not run this pass (container OOM risk per standing rule); manual type review of the touched interfaces/queries done instead.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (resonance WIRED).
- `node scripts/grade-ux-polish.mjs --honest` — `resonance`: `tier: "polished"`, `isGenericScaffold: false`.
- Backend (unchanged, re-verified green): `node --test tests/depth/resonance-behavior.test.js tests/resonance-domain-parity.test.js` — 15/15 pass, 0 fail.
