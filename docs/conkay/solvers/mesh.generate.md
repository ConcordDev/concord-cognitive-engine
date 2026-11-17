# mesh.generate

Meshing for FE/FV. Catalogue SX-CAD-01, wave 0, PRG-17.
Target fidelity L3 (engine tier), screening tier in-process.

## Tiers — read this first

The L3 tier is engine-bound: gmsh (**SXE-06**) and Netgen
(**SXE-11**), both in the queued engine wave and not installed at
this build. Per the catalogue's honesty rules the engine tier answers
`NOT_COMPUTED engine_unavailable:sxe-06 (gmsh),
engine_unavailable:sxe-11 (netgen)` with the install hint — never a
quiet downgrade. Beside it, a **labelled screening tier**
(`outputs.screening == true`, `outputs.tier == "screening-structured"`)
computes a real structured hex mesh for box geometry in-process.
A non-box shape has no screening path: the whole result is the engine
tier's NOT_COMPUTED. When SXE-06/SXE-11 land on the SXE-00 engine
framework, the engine tier arms inside this solver's `run()`; the
screening tier stays as the labelled fast path.

## Inputs / units

Node props `props["cad.mesh"]`:

| input | rule |
|---|---|
| `shape` | `"box"` for the screening tier; anything else → engine NOT_COMPUTED |
| `dims` | {length, width, height} in metres, positive finite; violations → `INVALID_INPUT` naming the field |
| `divisions` | {nx, ny, nz} positive integers, ≤512 per axis, ≤2,000,000 cells total; over-cap → `mesh_out_of_envelope` naming the cap |
| `targetSizeM` | alternative to divisions: per-axis counts are `ceil(dim / targetSizeM)` |

No resolution is assumed: neither `divisions` nor `targetSizeM` →
`missing_input:divisions`.

## Outputs (envelope)

Screening: `nodes`, `cells`, `cellDimsM`, `minCellVolumeM3`,
`maxCellVolumeM3`, `maxAspectRatio`, `quality {aspectLimit: 20,
withinThresholds}` — an over-aspect mesh is returned with the
violation named in warnings (envelope WARN), not silently accepted.
Always present: `engineTier {requested: "L3", status: "NOT_COMPUTED",
reason}` naming both engine tickets, echoed in warnings.

The descriptor carries `engineDependent: ["sxe-06", "sxe-11"]`.
Note for SXC-20: at this build `listSolvers()`' projection does not
surface `engineDependent` (it rides the frozen descriptor via
`getSolver`); the status regeneration must extend the projection or
read descriptors — named in SX-CAD-01's check file.

## Reference + locator

Unit cube mesh quality (the catalogue's named case): 1×1×1 divisions
→ 8 nodes, 1 cell, cell volume 1, aspect 1 — exact integers of the
inputs, asserted in
`server/tests/conkay-cad-mesh-generate.test.js`, with the refinement
trend (×2 divisions per axis → ×8 cells, ÷8 cell volume). Quality
vocabulary per the gmsh / Netgen documentation.

## Replay request (walker / MCP)

```json
{ "nodes": [{ "id": "P1", "kind": "Part", "name": "block",
  "props": { "cad.mesh": { "shape": "box",
    "dims": { "length": 1, "width": 1, "height": 1 },
    "divisions": { "nx": 2, "ny": 2, "nz": 2 } } } }], "edges": [] }
```

Expected envelope: `mesh.generate@P1`, WARN (the engine tier's
absence is a warning by design), `outputs.cells == 8`,
`outputs.screening == true`, `outputs.engineTier.status ==
"NOT_COMPUTED"` naming sxe-06 and sxe-11. With the engines absent a
PASS-labelled L3 result is a failure of this check, not a success.
