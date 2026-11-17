# orc.mass-bom

Mass per part and total, BOM budget. Catalogue SX-ORC-07, wave 0,
PRG-17. Fidelity L2, in-process JS.

## What it does

Registered solver `orc.mass-bom` (v1.0.0) runs on any design node
carrying `props["orc.mass-bom"] = { parts, budgetKg?,
contingencyFraction? }`. Each part's mass is its exact B-rep volume
(`cad.mass-properties-brep`) times a **sourced** density — declared
`densityKgM3` or a material-library resolution, with the source named
per part. There is no stand-in density: a part whose density cannot
be resolved is reported **massless with its reason** in
`outputs.masslessParts`, excluded from the totals, and named in
warnings (the catalogue's reference case).

Assembly properties follow `mass.cg`'s discipline: CG =
Σ mᵢrᵢ / Σ mᵢ over positioned massive parts; a massive part without
a position makes the CG and assembly inertia **not computed, naming
the part** — nothing is assumed to sit at the origin (the mass total
still stands). Inertia is the full tensor about the assembly CG by
the parallel-axis theorem. Part positions are translations only at
this tier; there is no orientation input, and a rotated part is out
of scope (named here, not silently treated as unrotated geometry —
the per-part tensor is axis-aligned by construction of the input).

Budget: with `budgetKg` declared, the verdict compares the total
with the declared maturity contingency applied
(`totalWithContingencyKg`); over-budget is a WARN verdict with the
margin, not a solver failure. `contingencyFraction` is a declared
policy input in [0, 1); absent means 0, echoed in inputs — no silent
contingency.

## Reference + locator

Assembly mass = Σ parts, per-part values from the closed forms in
`docs/conkay/solvers/cad.mass-properties-brep.md` with material
sources per part (the catalogue's cited source). Asserted in
`server/tests/conkay-orc-mass-bom.test.js`, including the CG of a
two-part assembly computed independently in the test.

## Replay request (walker / MCP)

```json
{ "nodes": [{ "id": "A1", "kind": "Part", "name": "assembly",
  "props": { "orc.mass-bom": { "budgetKg": 7000, "parts": [
    { "id": "block", "position": [0, 0, 0],
      "massProperties": { "shape": "box",
        "dims": { "length": 1, "width": 1, "height": 1 },
        "densityKgM3": 6000 } },
    { "id": "ghost", "position": [1, 0, 0],
      "massProperties": { "shape": "sphere", "dims": { "radius": 1 },
        "material": "unobtanium" } } ] } } }], "edges": [] }
```

Expected envelope: `orc.mass-bom@A1`, WARN (the massless part),
`outputs.totalMassKg == 6000`, `outputs.masslessParts` names "ghost"
with the unresolvable-material reason, and
`outputs.budget.verdict == "within-budget"`. A total that quietly
includes a density for "ghost" FAILS this check.
