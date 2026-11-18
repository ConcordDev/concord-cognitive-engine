# cad.bom-structure — multi-level bill of materials

Solver id: `cad.bom-structure` · v1.0.0 · domain: cad · fidelity L2
Source: `server/lib/conkay/cad/bom-structure.js`
Engine: JS — no engine tier on this ticket. `erp-bom.js` and
`assembly-export.js`'s `buildBom` stay as they are; this is the
registry form.

## What it does

Takes a nested BOM (`items`, each with `qty`, optional `children`,
leaf `massProperties`, optional `unitCost`) and flattens it to
numbered lines with mass and cost rolled up through the tree. Leaf
masses come from `cad.mass-properties-brep` — the same path
`orc.mass-bom` (SX-ORC-07) uses, so a part's mass agrees across the
stack.

Roll-up rules, all declared in the outputs as `costRule`:

- A leaf's unit mass is its solid's mass. An assembly's unit mass
  is Σ child.qty × child unit mass. A line carrying **both**
  children and massProperties is refused, named — its mass would
  be ambiguous.
- An unresolvable leaf (unknown material, no declared density, bad
  dims) is **unmassed**, with the mass-properties reason carried
  verbatim; the null propagates through every ancestor, the total
  is null, and a labelled partial subtotal stands beside it.
  Nothing is silently zero-massed.
- **Unpriced stays null.** A line with a declared `unitCost` is
  priced as purchased: extended cost = qty × unitCost, and its
  children's costs are NOT rolled into it (the price includes
  them; the children still count for mass and structure). An
  unpriced line's cost is the sum of its children's extended costs
  when every descendant is priced — per parent unit — else null.
  Totals follow the same discipline: null beside a labelled priced
  subtotal whenever anything is unpriced.
- Item numbers are hierarchical ("1", "1.1", "2") — the
  multi-level form of the balloons `cad.drawings-detail`
  (SX-CAD-07) numbers flat per drawing set.
- Quantities are required and explicit — never defaulted to 1.
  The same part id may appear under different parents (each
  occurrence is its own line, counted each time); duplicates
  among siblings are refused, named.

Nesting is capped at 32 levels and 10,000 lines; beyond that the
run refuses, named.

Inputs (node props under the literal key `cad.bomStructure`):
`{items: [{id, qty, massProperties?, unitCost?, children?}],
currency?}`.

## Reference case

Base assembly (2× a 1 kg cube + 1× a 1 kg box) plus a top line of
3× the cube at unitCost 5 → total mass exactly 6 kg (Σ part masses
through the tree); total cost null (the base branch is unpriced),
priced subtotal 15, unpriced lines named in discovery order. A
fully priced tree totals exactly, and a purchased kit at
unitCost 40 does not double-count its priced child. Asserted in
`server/tests/conkay-cad-bom-structure.test.js`; masses computed
by hand (0.1 m cube at 1000 kg/m³ = 1 kg), with ~1e-9 kg float
tolerance against the analytic forms' IEEE-754 rounding.

## Replay request (SXC-23 form)

```json
{ "solver_id": "cad.bom-structure",
  "inputs": { "currency": "USD", "items": [
    { "id": "base", "qty": 1, "children": [
      { "id": "A", "qty": 2, "massProperties": { "shape": "box", "dims": { "length": 0.1, "width": 0.1, "height": 0.1 }, "densityKgM3": 1000 } },
      { "id": "B", "qty": 1, "massProperties": { "shape": "box", "dims": { "length": 0.2, "width": 0.1, "height": 0.05 }, "densityKgM3": 1000 } } ] },
    { "id": "A", "qty": 3, "massProperties": { "shape": "box", "dims": { "length": 0.1, "width": 0.1, "height": 0.1 }, "densityKgM3": 1000 }, "unitCost": 5 } ] } }
```

Expected envelope: status WARN (the unpriced assembly line rides
as a warning — its total stays null beside the priced subtotal)
with `outputs.totalMassKg` ≈ 6
(±1e-9), `outputs.totalCost == null`, `outputs.pricedSubtotal
== 15`, lines numbered ["1", "1.1", "1.2", "2"], inputs echoed
exactly.

## Adversarial shape

- Missing qty → `missing_input` naming the line (quantities are
  never defaulted).
- Negative unitCost, zero qty, duplicate sibling ids, a line with
  both children and massProperties, a leaf without massProperties
  → `INVALID_INPUT` / `missing_input` naming the field and item.
- Unknown material on a leaf → the line and its ancestors are
  unmassed with the reason carried; the run still returns the
  structure.
