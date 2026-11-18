# cad.part-geometry — real geometry for every part

Solver id: `cad.part-geometry` · v1.0.0 · domain: cad · fidelity L3
Source: `server/lib/conkay/cad/part-geometry.js`
Engine dependency: SXE-06 (OCC parametric template engine) — not built.

## Tiers

The target tier (parametric OCC templates for every part class in the
component library and domain packs) is **not computed** in wave 0:
every run carries `outputs.engineTier = {requested: "L3", status:
"NOT_COMPUTED", reason: "engine_unavailable:sxe-06", hint: …}` and a
matching warning.

Beside it, a labelled screening tier (`outputs.screening: true`,
`screeningTier: "analytic-template-library"`) instantiates a declared
template library in-process:

| template | shape | parameters (bounds, metres) |
|---|---|---|
| plate | box | length, width, height ∈ (0, 10] |
| shaft | cylinder | radius ∈ (0, 2], height ∈ (0, 20] |
| ball | sphere | radius ∈ (0, 5] |
| pipe | tube | outerRadius, innerRadius ∈ (0, 2], height ∈ (0, 20] |

The bounds are the templates' **declared validity envelope**: a
parameter outside its bound is `out_of_envelope` naming the parameter
and the bound — never silently clamped into range.

## The output contract: no part leaves without a solid and a slot

Every part record carries its exact analytic solid — volume, area,
centroid from `cad.mass-properties-brep`'s closed forms (shared via
its `exactSolid` export; the forms live in exactly one place) — and a
**material slot**:

- resolved: `materialSlot` names the source (`material library:
  steel`, or `declared input densityKgM3`) and `massKg` is computed;
- unresolved or undeclared: `materialSlot: null`, `massKg: null`, and
  `materialNote` names why. A material is never assumed to fill the
  slot.

Totals are honest about coverage: `totalMassKg` sums only the massed
parts and `massCoverage {withMass, withoutMass}` says how many parts
stand behind it. A malformed line (unknown template, missing or
non-finite parameter, duplicate id) refuses the whole run naming the
indexed field — a BOM with a malformed line has no honest partial
total.

Inputs (node props under the literal key `cad.partGeometry`):
`{parts: [{id, template, params, material?, densityKgM3?}]}`.

## Reference case

Unit plate (1×1×1 m, declared density 6000) → volume exactly 1 m³,
mass 6000 kg; a mixed BOM (plate + steel shaft + undeclared pipe +
unresolvable-material ball) → every line carries a solid, the shaft's
mass comes from the material library with the source named, the pipe
and ball stand massless with their reasons. Asserted in
`server/tests/conkay-cad-part-geometry.test.js`.

## Replay request (SXC-23 form)

```json
{ "solver_id": "cad.part-geometry",
  "inputs": { "parts": [
    {"id": "base", "template": "plate", "params": {"length": 1, "width": 1, "height": 1}, "densityKgM3": 6000},
    {"id": "knob", "template": "ball", "params": {"radius": 0.04}, "material": "unobtanium"} ] } }
```

Expected envelope: status WARN (screening — the unmassed part's
material note rides as the envelope's warning) with
`outputs.engineTier.reason == "engine_unavailable:sxe-06"`,
`outputs.parts[0].volumeM3 == 1`, `outputs.parts[1].materialSlot ==
null` with a `materialNote` naming unobtanium, and
`outputs.massCoverage == {withMass: 1, withoutMass: 1}`.

## Adversarial shape

- Parameter outside its template bound → `out_of_envelope` naming
  parameter + bound (e.g. plate length 11 vs (0, 10]).
- Unknown template → `unknown_template` listing the library.
- Missing parameter → `missing_input:parts[i].params.<name>`;
  non-finite → `INVALID_INPUT` naming it; tube inner ≥ outer →
  `INVALID_INPUT` naming the part.
- Missing `parts` → `NOT_COMPUTED missing_input:parts`.
