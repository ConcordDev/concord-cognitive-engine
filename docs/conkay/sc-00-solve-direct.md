# SC-00 / SC-04 — solve.direct and the dimensional refusal

**Module:** `server/lib/conkay/solve-direct.js` · **Bridge:** `conkay_solve` direct mode in `server/lib/mcp-execution-bridge.js` · **Tests:** `server/tests/conkay-sc00-solve-direct.test.js`, `server/tests/conkay-sc04-refusal.test.js`

## What SC-00 adds

Before this build, the only way to run a registered solver was a Design IR
(or a stored designId): `conkay_solve` required one, and there was no
`solve.direct` entry anywhere in the tree (CB-0808's foundations evidence:
SC-00 NOT SATISFIED). `solveDirect(solverId, spec)` runs one registered
solver against caller-supplied typed inputs:

```js
solveDirect("beam.fea", {
  node: { kind: "Beam", material: "steel-a992",
          props: { support: "simply-supported" },
          geometry: { shape: "i-beam", length: "4 m", height: "300 mm",
                      flangeWidth: "150 mm", flangeThickness: "12 mm",
                      webThickness: "8 mm" } },
  loadCases: [{ id: "LC1", loads: [{ pointLoad: "60 kN" }] }],
})
```

The entry validates the inputs at its boundary, builds the minimal
in-memory Design IR for the one node, and runs the production machinery
entire — `openDesign` → `DesignEngine` → `envelope` — returning the
solver's envelope(s). Because the run goes through the real engine, the
SC-05 input-integrity arming applies by construction: a solver echoing a
value different from what the caller declared is refused
`input_substituted` on this path exactly as on the IR path. In the MCP
bridge, `{ solver_id, inputs }` (no `ir`, no `designId`) routes through
the same validation and IR construction, then the bridge's normal
compile → open → settle → signing pipeline; `dry_run` previews work too.

Returns: `{ ok: true, solver_id, status, results }` on a run (status
`NOT_COMPUTED` with empty results when the solver has no applicable
targets for the inputs), or `{ ok: false, reason, error }` with reason
`unknown_solver` / `invalid_input` / `ir_invalid`. It never throws on bad
input.

## What SC-04 adds

The refusal leg, at this boundary only. A dimensional field supplied as a
bare number, a unit-less string, or a unit-less `{ value }` object is
refused `invalid_input`, naming the field, the dimension (where the
compiler's own tables declare one — geometry keys via `paramDim`, position
axes as length, `TYPED_PROPS` props by their declared dimension), and the
remedy (declare the unit). Load fields are dimensional by contract: every
numeric load field is a physical quantity, so a bare load value is refused
the same way. Unit-carrying values in any of the three forms convert
exactly through `parseQuantity` and the compiler — `4000 mm` and
`13.123359580052493 ft` reproduce `4 m` bit-for-bit end to end.

`parseQuantity` is **not** changed, and the design-IR/chat authoring path
keeps its deliberate bare-SI coercion (agents authoring designs write
`position: { x: 0, y: 0, z: 0 }` or `mass: 1.5`; that coercion is tested
behaviour and stays). The refusal is a property of the solver-input entry:
a caller stating solver inputs owes declared units; a caller authoring a
design keeps the authoring convention. If a future ruling wants refusal
inside design authoring too, that is a separate ticket against the IR
compiler, not a change to this seam.

## Scope and limits

- **One node.** The direct spec describes a single node plus its load
  cases. Multi-node structure (edges, assemblies, children) is what the
  Design IR is for; solvers that need children or aggregate across nodes
  return their own `NOT_COMPUTED` on the direct path, honestly.
- **Dimension knowledge** for the refusal comes from the compiler's own
  tables. A dimensional value hiding in an untyped prop key is the
  solver's domain and is not policed here; geometry, position, typed
  props, and loads — the catalogue's dimensional surfaces — are.
- **Branch base.** This build sits on the SC-05 landing (sx/core-loop
  head) so the integrity arming it inherits is present in the tree; the
  bridge file is byte-identical between that base and the deployed main,
  so the bridge leg applies to the deployed build unchanged.
