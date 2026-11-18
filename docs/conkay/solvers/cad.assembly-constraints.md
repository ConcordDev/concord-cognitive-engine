# cad.assembly-constraints — assembly mates and constraint solving

Solver id: `cad.assembly-constraints` · v1.0.0 · domain: cad · fidelity L3
Source: `server/lib/conkay/cad/assembly-constraints.js`
Engine dependency: SXE-01 (OCC + SolveSpace geometric solver) — not built.

## Tiers

The target tier — a 3-D geometric constraint solver
(coincident/concentric/distance/angle/gear/slider) with motion-study
hand-off — is **not computed** in wave 0: every run carries
`outputs.engineTier = {requested: "L3", status: "NOT_COMPUTED",
reason: "engine_unavailable:sxe-01", hint: …}` and a matching
warning. `assembly-mates.js`'s kinematic mates stay as they are
(their own honesty note stands); this solver does not replace them.

Beside it, a labelled screening tier (`outputs.screening: true`,
`screeningTier: "gruebler-kutzbach-accounting"`) does assembly DOF
accounting by the **Grübler–Kutzbach criterion**:

- planar: `DOF = 3(n − 1) − Σ constraints` (revolute/prismatic
  remove 2, rolling contact removes 1)
- spatial: `DOF = 6(n − 1) − Σ constraints` (a joint with f freedoms
  removes 6 − f; vocabulary revolute/prismatic/cylindrical/
  spherical/planar/fixed)

with over-constraint detection: `DOF < 0` classifies the assembly
`over-constrained-by-count` and names the excess; duplicate joints
between the same pair with the same type are named in
`redundantCandidates` as review signals.

**The count is a criterion count, not a rank proof.** Special
geometries — the textbook case is a parallelogram linkage with a
redundant parallel link; the spatial case is a door on two aligned
hinges (count −4, real DOF 1) — can move at count 0 or jam at count
1. The caveat rides in the outputs as `dofNote`; the geometric tier
decides. Exactly one link must be marked `ground` — the count is
relative to ground, and zero or two grounds refuse the run.

Validity envelope: rigid parts (the ticket's own envelope).

Inputs (node props under the literal key `cad.assemblyConstraints`):
`{mechanism: "planar"|"spatial", links: [{id, ground?}], joints:
[{type, links: [a, b]}]}`.

## Reference case

4-bar: ground + crank + coupler + rocker, four revolute joints →
`DOF = 3(4−1) − 2·4 = 1`, classification "mechanism". A locked
triangle counts 0; adding a fourth revolute over-constrains it
(−2, named, with the duplicate joint flagged). Asserted in
`server/tests/conkay-cad-assembly-constraints.test.js`; the expected
values are the criterion applied by hand.

## Replay request (SXC-23 form)

```json
{ "solver_id": "cad.assembly-constraints",
  "inputs": { "mechanism": "planar",
              "links": [{"id":"ground","ground":true},{"id":"crank"},{"id":"coupler"},{"id":"rocker"}],
              "joints": [{"type":"revolute","links":["ground","crank"]},{"type":"revolute","links":["crank","coupler"]},{"type":"revolute","links":["coupler","rocker"]},{"type":"revolute","links":["rocker","ground"]}] } }
```

Expected envelope: status PASS (screening) with
`outputs.engineTier.reason == "engine_unavailable:sxe-01"`,
`outputs.dof == 1`, `outputs.classification == "mechanism"`, inputs
echoed exactly.

## Adversarial shape

- Joint type outside the mechanism's vocabulary (e.g. spherical in
  planar) → `INVALID_INPUT` naming the vocabulary.
- Zero or two ground links → `INVALID_INPUT` naming the count.
- Joint referencing an unknown link, or a link to itself →
  `INVALID_INPUT` naming it.
- Missing `mechanism`/`links` → `NOT_COMPUTED missing_input:<field>`.
