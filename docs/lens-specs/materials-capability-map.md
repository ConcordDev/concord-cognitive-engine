# materials — Capability Map (Wave 2 rebuild, Space/lab-science archetype)

Reference apps: **MatWeb** (searchable materials property database,
side-by-side comparison) and **Ansys Granta MI** (material selection by
spec, Ashby charts, composite/rule-of-mixtures analysis, datasheet
generation, standards cross-reference, sustainability metrics). This lens
targets that materials-selection-tool shape, not a generic inventory CRUD
app.

Backend: `server/domains/materials.js` — 19 registered `materials.*` macros.

## Pre-rebuild audit finding

`node scripts/grade-ux-polish.mjs --honest` classified `materials` as
`tier: "functional"` with `isGenericScaffold: true` (`honestCapped: true`).
As with `lab`, the underlying components (`MpSearch.tsx`, `CorrosionThermalPanel.tsx`,
`MaterialShortlist.tsx`, `MaterialsToolkit.tsx`, `CrystalViewer.tsx`,
`MaterialActionMenu.tsx` — 1,650 LOC combined pre-rebuild) were substantially
real and macro-wired. Two genuine problems were found on top of that,
both fixed this pass:

1. **The generic-scaffold tell was real, not a false positive.** The page
   also mounted `<UniversalActions domain="materials" ...>` and a
   collapsible `<LensFeaturePanel lensId="materials" />`, on top of the real
   panels — removed.
2. **A fake-looking action button that silently did the wrong thing.** Every
   row in the "Library" CRUD tabs (Material/Test/Comparison/Supplier/
   Composite/Standard) had a lightning-bolt "Activate" button wired to
   `handleAction('analyze', item.id)` → `POST /api/lens/materials/:id/run`
   with `action: 'analyze'`. **No `materials.analyze` macro exists** —
   `LENS_ACTIONS.get('materials.analyze')` is `undefined`, so the request
   fell through to `lens.run`'s AI catch-all (`utilityCall`), silently
   routing every click through a generic LLM prompt instead of any of the
   three real deterministic engines (`compareProperties`, `selectMaterial`,
   `compositeAnalysis`) that could have answered it. This is exactly the
   "button that looks like it does the real thing but doesn't" class the
   zero-fake-data invariant is about — it wasn't fabricated *data*, but it
   was a fabricated *affordance*. Removed the button; replaced with three
   dedicated, macro-correct tools (below) instead of trying to force one
   generic button to cover three different data shapes.

## Capability checklist

| Capability (MatWeb/Granta MI parity) | Macro(s) | Status | Disposition |
|---|---|---|---|
| Materials property database search (external, live) | `mp-search`, `mp-material` | ALREADY REAL | `MpSearch.tsx` — Materials Project formula search with save-as-DTU + `MaterialActionMenu` (spec/quote/compare/publish/agent). |
| 3D crystal structure viewer | `mp-structure` | ALREADY REAL | `CrystalViewer.tsx` — WebGL unit-cell + atom-site render. |
| Personal shortlist (candidate materials, add/remove) | `shortlist-add/-list/-remove` | ALREADY REAL | `MaterialShortlist.tsx`. |
| Side-by-side shortlist comparison, best-per-property | `shortlist-compare` | ALREADY REAL | `MaterialShortlist.tsx` compare view. |
| Shortlist summary stats | `shortlist-dashboard` | **WAS BACKEND-CAPABLE-BUT-UNSURFACED** | **Fixed this pass** — `MaterialShortlist.tsx` header now shows "N shortlisted across M categories" from a real `shortlist-dashboard` call (previously computed nowhere in the frontend). |
| Ashby chart (2D material-selection scatter, material index) | `ashby-plot` | ALREADY REAL | `MaterialsToolkit.tsx` AshbyTab. |
| Multi-criteria weighted ranking | `multi-criteria-rank` | ALREADY REAL | `MaterialsToolkit.tsx` RankTab. |
| **Property comparison across arbitrary material sets** (density/tensile/thermal-K/melting/modulus/hardness, per-property ranking + overall score) | `compareProperties` | **WAS BACKEND-CAPABLE-BUT-UNSURFACED — now real** | **Built this pass**: new `MaterialsToolkit.tsx` CompareTab — checkbox-select 2+ shortlisted materials, run the real `compareProperties` engine, render per-property ranking bars + overall-suitability leaderboard. The old per-row "Activate" button never reached this macro at all. |
| **Select-by-spec** (requirements: min tensile / max density / min melting / max cost / application → ranked qualifying candidates) | `selectMaterial` | **WAS BACKEND-CAPABLE-BUT-UNSURFACED — now real** | **Built this pass**: new SelectTab — a real requirements form against the whole shortlist as candidates, calling `selectMaterial`, showing recommended pick + qualifying count + per-candidate pass/fail detail. |
| **Composite property prediction** (rule of mixtures — Voigt/Reuss bounds, specific strength/stiffness) | `compositeAnalysis` | **WAS BACKEND-CAPABLE-BUT-UNSURFACED — now real** | **Built this pass**: new CompositeTab — repeatable component rows (name/volume-fraction/density/tensile/modulus), calling `compositeAnalysis`, rendering Voigt+Reuss bounds and the rule-of-mixtures caveats the engine returns. |
| Corrosion-risk assessment by material/environment | `corrosionRisk` | ALREADY REAL | `CorrosionThermalPanel.tsx` (via `CalcPanel`). |
| Thermal-behavior analysis (safety margin, application suitability) | `thermalAnalysis` | ALREADY REAL | `CorrosionThermalPanel.tsx`. |
| Exportable material datasheet | `datasheet` | ALREADY REAL | `MaterialsToolkit.tsx` DatasheetTab (plaintext export). |
| Mechanical test-data import (CSV, column stats) | `import-test-csv` | ALREADY REAL | `MaterialsToolkit.tsx` ImportTab. |
| Standards cross-reference (ASTM/ISO/DIN/JIS/UNS) | `standards-crossref` | ALREADY REAL | `MaterialsToolkit.tsx` StandardsTab. |
| Sustainability / embodied-carbon metrics | `sustainability` | ALREADY REAL | `MaterialsToolkit.tsx` CarbonTab. |
| Structured library records (materials/tests/comparisons/suppliers/composites/standards) | n/a (generic lens-artifact CRUD, not a `materials.*` macro) | ALREADY REAL | `page.tsx` Library tabs — real per-type structured forms (not JSON-paste), legitimate record-keeping even without a live compute call per row. |
| Supplier RFQ / quote request | n/a (`/api/social/dm`) | ALREADY REAL | `MaterialActionMenu.tsx` Quote pane — DMs a supplier with formula/qty/date. |
| Periodic-table / element browser UI | none | GENUINELY MISSING | No backend macro serves periodic-table data; MP search covers compound lookup but not an element browser. Deferred — would need a new data source, not a UI fix. |
| Failure-analysis / fractography workflow | none | GENUINELY MISSING | No macro models fracture-surface analysis. Out of scope for this pass; would need new domain logic. |
| PLM/CAD integration | none | GENUINELY MISSING | No macro or route touches CAD/PLM systems. Deferred as a connector-tier project, not a lens-page gap. |

## What changed this pass

1. Removed `<UniversalActions domain="materials" ...>` and the collapsible
   `<LensFeaturePanel lensId="materials" />` from `app/lenses/materials/page.tsx`.
2. Removed the per-row "Activate" (Zap) button in the Library tabs — it
   called a nonexistent `materials.analyze` macro and silently fell through
   to the generic AI catch-all. Removed `useRunArtifact`/`handleAction` along
   with it (now dead code).
3. Added three new `MaterialsToolkit.tsx` tabs — **Compare**, **Select by
   Spec**, **Composite** — wired to the three materials-domain macros
   (`compareProperties`, `selectMaterial`, `compositeAnalysis`) that had real
   backend implementations but no designed UI path at all before this pass.
4. Wired `shortlist-dashboard` into `MaterialShortlist.tsx`'s header as a
   small real stat, closing the last unsurfaced macro.
5. Left `MpSearch`, `CorrosionThermalPanel`, `CrystalViewer`,
   `MaterialActionMenu`, the Ashby/Rank/Datasheet/Import/Standards/Carbon
   tabs, and the structured Library CRUD tabs untouched — they were already
   real, designed, and (where applicable) macro-wired.

## Verify gate results

- `npx eslint app/lenses/materials/page.tsx components/materials/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- No materials-specific vitest file exists (`grep -rl materials concord-frontend/tests`
  matches only an unrelated in-world crafting-material badge test) — noted
  honestly rather than silently skipped.
- `node scripts/verify-lens-backends.mjs` — `materials` still reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `materials` now
  `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`.
