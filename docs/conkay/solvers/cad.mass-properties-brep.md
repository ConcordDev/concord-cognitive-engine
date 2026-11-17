# cad.mass-properties-brep

Exact mass properties from B-rep integrals on analytic solids.
Catalogue SX-CAD-03, wave 0, PRG-17. Fidelity L2, in-process JS.

## What it does

Registered solver `cad.mass-properties-brep` (v1.0.0) runs on any
design node carrying `props["cad.massProperties"]` and returns volume,
surface area, mass, centroid, and the full inertia tensor in closed
form for the analytic solid set: **box, cylinder, sphere, tube**.
There is no tessellation in this tier. A shape outside the set is
`NOT_COMPUTED` naming the OCC kernel path (`cad/body-kernel.js` /
occ-bridge) — a mesh approximation is never labelled exact. (The mesh
tier is a separate surface: `lib/asset-gen/mass-properties.js`.)

## Inputs / units

| input | rule |
|---|---|
| `shape` | one of box / cylinder / sphere / tube; anything else → NOT_COMPUTED `shape_not_in_exact_set` |
| `dims` | box {length, width, height} · cylinder {radius, height} · sphere {radius} · tube {outerRadius, innerRadius, height} — metres, positive finite; violations → `INVALID_INPUT` naming the field; missing → `missing_input:dims.<field>` |
| `densityKgM3` | explicit density wins when declared |
| `material` | otherwise resolved in `material-library.js`; an unknown id is refused by name — no density is ever assumed |

Origins: box and sphere at their centre; cylinder and tube at the
base centre, axis = z. Inertia is about the centroid, principal axes;
products of inertia are computed zeros by symmetry.

## Outputs (envelope)

`volumeM3`, `areaM2`, `massKg`, `centroidM`, `inertiaKgM2`
{Ixx, Iyy, Izz, Ixy, Ixz, Iyz}, `densitySource`. Inputs are echoed
exactly as submitted (`inputs.densityKgM3` carries the resolved
density with its source named in the outputs).

## Reference + locator

Textbook closed forms — cube `I = (1/6) m a²` (the catalogue's named
reference case), cylinder `I_axis = (1/2) m r²`, sphere
`I = (2/5) m r²`, tube `I_axis = (1/2) m (R² + r²)` — asserted to
1e-9 relative in `server/tests/conkay-cad-mass-properties.test.js`
from first principles, never read back from the solver.

## Replay request (walker / MCP)

```json
{ "nodes": [{ "id": "P1", "kind": "Part", "name": "block",
  "props": { "cad.massProperties": { "shape": "box",
    "dims": { "length": 1, "width": 1, "height": 1 },
    "densityKgM3": 6000 } } }], "edges": [] }
```

Expected envelope: `cad.mass-properties-brep@P1`, status PASS,
`outputs.massKg == 6000`, `outputs.inertiaKgM2.Ixx == 1000`.
Reachability via solve.direct / solver.select fast-path labelling
rides SC-00 / SX-XC-01 (named, not claimed).
