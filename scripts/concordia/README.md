# Concordia activity density compiler (CP-10)

`compile-activities.mjs` compiles CONCORDIA_PLAN §4.11's activity density
targets into per-land placement manifests. GATE-7 counts density from the
manifests, not by eye.

## Inputs

- `lands.json` (this folder) — the ten lands and their square footprints
  from plan §4.2. Phase A is the M5 footprint; Phase B is the M7
  footprint. A caller may pass its own lands array of the same shape
  (`{name, sideKm: {A, B}}`) to the library or via `--input`.
- Density targets are §4.11's, held as constants in the compiler:
  per km² — major POI 1.5 · minor POI 6 · encounter groups 10 ·
  gatherable nodes 40 · quest touchpoints 3.

## Count rule

For a land of area A km², the compiled count per category is
`round(target × A)`, halves rounded up. The plan's per-16 km² column
(24 · 96 · 160 · 640 · 48) is exact under this rule. Every manifest
carries the exact (unrounded) product beside the rounded count, so the
gate judges the rounding instead of trusting it.

Note: §4.2's stated Phase A total (~44 km², the plan's own estimate)
does not equal the sum of its per-land table (52.5 km²). The compiler
works per land from the per-land figures, which are what §4.11's
acceptance is stated against; the discrepancy is the plan's, recorded
here rather than silently resolved.

## Output

Per land: `{land, phase, sideKm, footprintKm2, targetsPerKm2,
exactProducts, counts, placements, checksum}`. Placements are
deterministic (seeded PRNG per land + category; positions in the land's
local frame, metres) with stable ids (`<land>:<category>:<index>`), so
the same input compiles byte-identically and manifests can be diffed
and recounted. The set also carries per-category `totals`.

## Refusals

Invalid input never produces a count. The compiler throws a named
error: `ERR_NO_LANDS` · `ERR_LAND_SHAPE` · `ERR_DUPLICATE_LAND` ·
`ERR_SIDE_NOT_FINITE` (missing, NaN, Infinity, or non-number side) ·
`ERR_SIDE_NOT_POSITIVE` · `ERR_UNKNOWN_PHASE` · `ERR_UNKNOWN_ARG`
(CLI). The CLI exits 2 on a refusal.

## Use

```
node scripts/concordia/compile-activities.mjs                 # Phase A summary
node scripts/concordia/compile-activities.mjs --phase B       # Phase B summary
node scripts/concordia/compile-activities.mjs --out manifests.json
```

Tests: `server/tests/concordia-activity-density.test.js`
(`cd server && node --test tests/concordia-activity-density.test.js`).
