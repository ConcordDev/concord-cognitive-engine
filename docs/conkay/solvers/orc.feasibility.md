# orc.feasibility

Physics feasibility bounds before geometry. Catalogue SX-ORC-04,
wave 0, PRG-17. Fidelity L1 (screening), in-process JS.

## What it does

Registered solver `orc.feasibility` (v1.0.0) runs on any design node
carrying `props["orc.feasibility"] = { bound, ...inputs, claimed? }`.
It generalizes `compiler/feasibility.js` (electric-aircraft range
only) into a bound library — textbook closed-form ceilings no design
in the class can exceed:

| bound | ceiling | citation |
|---|---|---|
| `carnot` | η ≤ 1 − Tc/Th (absolute temperatures) | Çengel & Boles |
| `betz` | Cp ≤ 16/27 ≈ 0.5926 | Betz |
| `rocket` | Δv = Isp · g0 · ln(m0/mf) | Tsiolkovsky |
| `breguet-electric` | R = η · (E*/g) · (L/D) · battery fraction | Anderson |
| `specific-energy` | claimed Wh/kg vs a declared technology ceiling | declared best-case input |

With `claimed` given, the verdict is `within-bound` or
`exceeds-bound` with the margin — a successful computation with a
negative verdict, returned with the violated bound named in warnings
(envelope WARN), never softened and never reported as a solver
failure. Without `claimed`, the verdict is `bound-only`.

Best-case technology inputs are labelled: the specific-energy
ceiling defaults to 300 Wh/kg (best-case current lithium-ion
pack-level) and is echoed in `assumptions` as a `defaulted` value
whenever the default is used; a caller-supplied ceiling is not
labelled defaulted. Missing inputs → `missing_input:<field>`;
non-finite, negative-where-physical, or ≥1e300 inputs, cold ≥ hot,
mass ratio ≤ 1, efficiency or battery fraction over 1 →
`INVALID_INPUT` naming the field.

## Outputs (envelope)

`bound`, `boundValue`, `unit`, `claimed`, `verdict`, `margin`,
`citation`. Inputs echo exactly the values used.

## Reference + locator

Textbook closed forms (Anderson, *Aircraft Performance & Design*;
Turns; Çengel & Boles, *Thermodynamics*; Ashby) — the catalogue's
named reference cases are the Breguet range form and the Carnot
bound, recomputed from the formulas in
`server/tests/conkay-orc-feasibility.test.js` (11 legs), never read
back from the solver.

## Replay request (walker / MCP)

```json
{ "nodes": [{ "id": "B1", "kind": "Part", "name": "plant",
  "props": { "orc.feasibility": { "bound": "carnot",
    "hotK": 600, "coldK": 300, "claimed": 0.75 } } }], "edges": [] }
```

Expected envelope: `orc.feasibility@B1`, WARN,
`outputs.boundValue == 0.5`, `outputs.verdict == "exceeds-bound"`,
with the violated bound named in warnings. A PASS here is a failure
of the check, not a success.
