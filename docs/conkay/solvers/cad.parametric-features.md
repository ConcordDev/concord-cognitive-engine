# cad.parametric-features — parametric feature modeling

Solver id: `cad.parametric-features` · v1.0.0 · domain: cad · fidelity L2
Source: `server/lib/conkay/cad/parametric-features.js`
Engine dependency: SXE-21 (OCC parametric feature kernel) — not built.

## Tiers

The target tier (feature trees, configurations, on OCC via SXE-21) is
**not computed** in wave 0: every run carries
`outputs.engineTier = {requested: "L2", status: "NOT_COMPUTED",
reason: "engine_unavailable:sxe-21", hint: …}` and a matching warning.
No fallback number is ever labelled as the engine result.

Beside it, a labelled screening tier (`outputs.screening: true`,
`screeningTier: "sketch-constraints-relaxation"`) solves 2D sketch
constraints in-process.

## Screening tier: sketch constraints

Vocabulary: `fixed` (2 eqs) · `coincident` (2) · `distance` (1) ·
`horizontal` (1) · `vertical` (1). Solving is by successive projection
(relaxation): constraint projections apply in input order until the
max constraint residual is within the internal convergence target
1e-12 m — a guard band under the declared acceptance tolerance of
1e-9 m, so chained-constraint coordinate error stays well inside it —
or the 10,000-sweep cap is hit. Deterministic: same inputs, same
sweeps, same solved points. A solve that cannot settle is
`NOT_COMPUTED solver_not_converged: …` naming the residual — never a
settled lie.

Outputs: `solvedPoints`, `maxResidual`, `sweeps`, `constraintCount`,
and `dofByCount` = 2·points − scalar constraint equations. The count
is **not** a rank computation — dependent constraints can make the
true DOF higher; the field is named and caveated in the outputs
(`dofNote`), not hidden.

Inputs (node props under the literal key `cad.parametricFeatures`):

```json
{ "points": [{"id": "P1", "x": 0.1, "y": -0.1}, …],
  "constraints": [{"type": "fixed", "point": "P1", "x": 0, "y": 0},
                  {"type": "distance", "a": "P1", "b": "P2", "value": 3}, …] }
```

Units: sketch coordinates and distances in metres (SI), echoed as
submitted.

## Reference case

The perturbed rectangle (P1…P4 near a 3×2 rectangle) under fixed P1,
horizontal/vertical edge constraints, and distances 3 and 2 solves to
the exact rectangle (0,0) (3,0) (3,2) (0,2) with residual ≤ 1e-9 and
`dofByCount == 0` — the constrained sketch closes. Expected values are
the constraint declarations themselves. Asserted in
`server/tests/conkay-cad-parametric-features.test.js`.

## Replay request (SXC-23 form)

```json
{ "solver_id": "cad.parametric-features",
  "inputs": { "points": [{"id":"P1","x":0.1,"y":-0.1},{"id":"P2","x":2.8,"y":0.2},{"id":"P3","x":3.2,"y":1.8},{"id":"P4","x":-0.2,"y":2.1}],
              "constraints": [{"type":"fixed","point":"P1","x":0,"y":0},{"type":"horizontal","a":"P1","b":"P2"},{"type":"vertical","a":"P2","b":"P3"},{"type":"horizontal","a":"P3","b":"P4"},{"type":"vertical","a":"P4","b":"P1"},{"type":"distance","a":"P1","b":"P2","value":3},{"type":"distance","a":"P2","b":"P3","value":2}] } }
```

Expected envelope: status WARN (screening — the engine tier's
sxe-21 NOT_COMPUTED notice rides as the envelope's warning) with
`outputs.engineTier.reason == "engine_unavailable:sxe-21"`,
`outputs.dofByCount == 0`, solved points at the exact rectangle
corners within 1e-9, inputs echoed exactly.

## Adversarial shape

- Contradictory constraints (same pair at distances 1 and 5) →
  `solver_not_converged`, named with the residual.
- Unknown constraint type / unknown point reference / non-positive or
  non-finite distance / duplicate point id / non-finite coordinate →
  `INVALID_INPUT` naming the indexed field.
- Missing `points` → `NOT_COMPUTED missing_input:points`.
