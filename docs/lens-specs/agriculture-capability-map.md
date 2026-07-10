# agriculture — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("agriculture"' server/domains/agriculture.js` → 68

## Reference app + parity target

**Climate FieldView** (John Deere Ops Center / AgriWebb) — the real,
best-in-class precision-ag platform: field records, variable-rate
prescriptions, planting/harvest passes, nitrogen planning, satellite NDVI,
equipment telemetry, weather + soil, profit analysis, yield mapping. This
lens already carries a huge, genuinely-built backend (68 macros) and a
correspondingly large bespoke frontend (24 components, 6,654 LOC, 69%
bespoke ratio) — the stale `docs/lens-specs/agriculture.md` (which claims
"full backlog implemented … 95% parity") turned out to be *mostly* right,
but this audit found and fixed a real, connected defect cluster the doc's
checklist-only view didn't catch: a dead-end click and two orphaned macros.

## `node scripts/lens-unsurfaced.mjs --lens agriculture` (before fix)

```
agriculture: 2/68 macros never referenced in the frontend
  field-* (1): field-update
  plan-* (1): plan-crop
```

## Findings

### `field-update` — REAL GAP (fixed)

`FarmWorkbench.tsx` (the "2026 parity workbench" sidebar — fields / weather
+ soil / scouting) had `field-create`, `field-list`, and `field-delete`
wired in its Fields tab, but no way to correct a field's name, acreage,
soil type, or current crop after creation short of deleting and re-adding.
`field-update` (`server/domains/agriculture.js:755`) exists and was never
called from anywhere in the frontend.

**Fix:** added inline edit mode to `FarmWorkbench.tsx`'s `FieldsTab` — a
pencil button per field row swaps the static display for an edit form
(name/acreage/soil type/current crop) that calls `field-update`, mirroring
the existing "New field" form's fields and validation.

### `plan-crop` — REAL GAP, connected to a dead click (fixed)

This was the more significant finding. `plan-crop`
(`server/domains/agriculture.js:353`) is a real crop-rotation + planting
advisor: given a field's soil type + crop history, it ranks candidate next
crops against a rotation table (avoid same-family repeats, prefer soil fit),
then returns a recommended crop, planting window, expected yield band, and
a written rationale. Its own code comment says: *"Pre-this macro the
'plan-crop' UniversalAction button … was a dead click."* — i.e. it was
built specifically to fix a dead click, but nothing in the frontend ever
calls it by name.

Tracing why: the dashboard's per-item **Analyze** button
(`app/lenses/agriculture/page.tsx`, Fields/Crops/Equipment tabs) calls a
generic `analyze` macro (`server/domains/agriculture.js:657`) that
*recognizes* the artifact's shape and returns a routing hint —
`{ dispatched: 'plan-crop', note: 'Use the plan-crop action for full
output.', field: d.name }` for a Field artifact — but the frontend never
read that hint and never followed through. Worse: the `ActionResult` render
panel had no fallback for an unmatched result shape at all, so clicking
Analyze on **any** field (or on a failed action of any kind — the `ok:
false` branch too) opened an "Action Result" panel that rendered
completely empty. This is exactly the "renders nothing, looks like a
silent no-op" defect class the honest-by-construction bar exists to catch
— not fabricated data, but an equally real broken interaction.

**Fix** (`app/lenses/agriculture/page.tsx`):
1. `handleAction` now follows a `{ dispatched: '<macro>' }` routing hint
   with one real follow-up call, so clicking Analyze on a Field gets the
   actual `plan-crop` report (not just the redirect note). This is generic
   to the dispatcher's own contract (any future artifact kind the `analyze`
   router recognizes benefits automatically), not a one-off patch.
2. Added dedicated result cards for `plan-crop` (recommended crop,
   planting window, expected-yield band, ranked candidates, rationale),
   `predict-yield` (per-acre/total yield, reference band, summary), and
   `analyze-soil` (per-nutrient trend tiles colored by status, prioritized
   recommendations, summary) — the three shapes that had no renderer.
3. Added an honest fallback block for any other shape: shows
   `message`/`note` if present, otherwise a raw JSON dump — so a result
   never again renders as a blank panel that looks like nothing happened.

`plan-crop` still shows as "unsurfaced" under the static-grep detector
after this fix (it's invoked dynamically via the `dispatched` hint, never
as a literal `'plan-crop'` string in frontend source) — verified by hand
that the runtime path is real: `handleAction('analyze', id)` →
`{dispatched:'plan-crop'}` → `handleAction('plan-crop', id)` → the real
macro executes and its result renders in the new card. This is the same
"unsurfaced ≠ defect" caveat the audit methodology names, just in the
opposite direction from usual (verified-reachable rather than
verified-unreachable).

## Left alone (already real)

`rotationPlan` (a separate, manual-entry rotation tool in
`AgricultureActionPanel.tsx`'s operator bench — distinct from `plan-crop`'s
automatic field-record-driven version, both legitimate), `predict-yield`
and `analyze-soil` direct calls in `AgricultureActionPanel.tsx`/dashboard
quick-actions, the NDVI/telemetry/profit/trial/soil-grid panels, GBIF
biodiversity panel, and the World Bank cereal-yield live feed — all
pre-existing, all real.

## Verification

- `npx eslint app/lenses/agriculture/page.tsx components/agriculture/FarmWorkbench.tsx` — clean, 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — agriculture stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — agriculture: `tier: "polished"`, `isGenericScaffold: false` (unchanged; this was a correctness fix, not a polish-tier fix).
- `node scripts/lens-unsurfaced.mjs --lens agriculture` (after fix): `1/68` (`field-update` now surfaced; `plan-crop` remains a static-grep false negative per the dynamic-dispatch note above).
