# cad.drawings-detail — detail and assembly drawings

Solver id: `cad.drawings-detail` · v1.0.0 · domain: cad · fidelity L2
Source: `server/lib/conkay/cad/drawings-detail.js`
Engine dependency: SXE-06 (OCC family — HLR rendering via
`cad/drawing-kernel.js`) — not available in this lane.

## Tiers

The target tier is the **rendered sheet** — orthographic projection
with hidden-line removal and section views from the OCC HLR kernel.
It is **not computed** in wave 0: every run carries
`outputs.engineTier = {requested: "L2-rendered", status:
"NOT_COMPUTED", reason: "engine_unavailable:sxe-06", hint: …}` and
`outputs.planOnly: true`. The GA sheets under `drawings/*` stay as
they are.

What the solver computes is the **sheet plan**:

- **One sheet per part** — every part has a sheet (the reference
  case's first clause), with views [front, top, side] planned and
  sections assigned to the rendered tier.
- **Dimensions re-measured from the part's solid.** The dims are
  validated through `cad.mass-properties-brep`'s `exactSolid` (its
  own field-named errors), and the per-shape extents are taken from
  those validated dims. A caller-declared `claimed` extent set is
  checked against the re-measure; every disagreement beyond
  1e-6 mm is named in `outputs.discrepancies` — reported, never
  silently corrected.
- **GD&T callouts** per part, validated against the 14-symbol ASME
  Y14.5 characteristic vocabulary (mirroring
  `assembly-drawing.js`'s `GDT_SYMBOLS` key-for-key; the table is
  carried locally because importing that module would drag pdfkit
  and the assembly store into a hermetic solver's graph — a test
  pins the mirror against the source text). Callouts are drafting
  callouts, not CMM certification.
- **Balloons** numbered in input order — the BOM order
  `cad.bom-structure` (SX-CAD-08) formalizes; named in the outputs
  as `bomLink`.

Parts outside the exact analytic set (box, cylinder, sphere, tube)
still get their sheet, with `dimensionStatus: "not_measured"`, no
dimensions, and the reason named per sheet — the OCC tier measures
those.

Units: solid dims are declared in metres (the mass-properties
contract) and echoed as submitted; sheet dimensions and GD&T values
are millimetres by the exact ×1000 conversion (SC-04).

Inputs (node props under the literal key `cad.drawingsDetail`):
`{parts: [{id, solid: {shape, dims}, claimed?: {x, y, z} (mm),
gdt?: [{symbol, value (mm), datum?, feature?}]}]}`.

## Reference case

Plate (box 0.1 × 0.05 × 0.02 m, claimed 100/50/20 mm) + pin
(cylinder r 0.01 m, h 0.03 m, cylindricity callout 0.01 mm) → two
sheets, balloons 1–2, plate dimensions re-measured 100/50/20 mm,
pin 20/20/30 mm, zero discrepancies. A claim of 99 mm on the plate's
x is named as a discrepancy (claimed 99, measured 100). Asserted in
`server/tests/conkay-cad-drawings-detail.test.js`; expected values
are the analytic extents computed by hand.

## Replay request (SXC-23 form)

```json
{ "solver_id": "cad.drawings-detail",
  "inputs": { "parts": [
    { "id": "plate", "solid": { "shape": "box", "dims": { "length": 0.1, "width": 0.05, "height": 0.02 } }, "claimed": { "x": 100, "y": 50, "z": 20 } },
    { "id": "pin", "solid": { "shape": "cylinder", "dims": { "radius": 0.01, "height": 0.03 } }, "gdt": [{ "symbol": "cylindricity", "value": 0.01, "datum": "A" }] } ] } }
```

Expected envelope: status PASS (plan) with
`outputs.engineTier.reason == "engine_unavailable:sxe-06"`,
`outputs.sheetCount == 2`, sheet 1 dimensions 100/50/20 mm,
`outputs.discrepancies` empty, inputs echoed exactly.

## Adversarial shape

- Unknown GD&T symbol → `INVALID_INPUT` naming the vocabulary.
- Negative solid dims → `INVALID_INPUT` from exactSolid, wrapped
  with the part index.
- NaN GD&T value → `INVALID_INPUT` naming the field.
- Duplicate part ids → `INVALID_INPUT`; missing `parts` →
  `NOT_COMPUTED missing_input:parts`.
