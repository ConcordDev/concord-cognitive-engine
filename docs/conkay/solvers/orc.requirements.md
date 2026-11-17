# orc.requirements

Requirements extraction and flow-down. Catalogue SX-ORC-02, wave 0,
PRG-17. Fidelity L1 (screening), in-process JS.

## What it does

Registered solver `orc.requirements` (v1.0.0) runs on any design node
carrying `props["orc.requirements"] = { text, allocations? }`. It
generalizes `compiler/requirement-parser.js` (brief → numeric targets
with SI conversion and the exact source words) into the NASA SE
Handbook shape (NASA/SP-2016-6105 Rev2): every requirement carries
its level, its bound in SI with the as-given value echoed, its source,
and a verification method (analysis / test / inspection /
demonstration) with either a verifying solver that **exists in the
registry** or an explicit `flagged-no-verifying-solver` status with a
reason.

Flow-down: the system mass bound is allocated to subsystems
(structure / propulsion / energyStorage / payloadAndAvionics) by
declared fractions. Fractions are inputs (`props.allocations`); the
built-in table (0.30 / 0.25 / 0.25 / 0.20) applies only when no input
is given, and every fraction used is echoed in `assumptions` as
`defaulted` — an allocation is policy, not physics. Fractions outside
(0, 1] or summing over 1 are `INVALID_INPUT` naming the field. Other
metrics are verified at system level, not silently subdivided.
Part-level flow-down requires the architecture step (SX-ORC-03) and
is named as such in `outputs.flowDown.partLevel`; no part requirement
is invented here.

## Inputs / units

| input | rule |
|---|---|
| `text` | the brief, verbatim. Missing → `NOT_COMPUTED missing_input:text`; no numeric targets in the requirement vocabulary → `NOT_COMPUTED no_requirements_extracted` |
| `allocations` | optional {subsystem: fraction} map; validated as above |

Units: SI inside; each bound echoes `given` (as written) beside the
SI value. Every number traces to the brief text (the extraction is
literal) or to a declared allocation fraction.

## Outputs (envelope)

`requirements[]` — {id, level, metric, bound {kind, si, unit, dim,
given?}, source, verification {method, verifyingSolver, status,
flagReason?}} plus subsystem rows with `derivedFrom` and
`allocationFraction`; `intent` (the unparsed remainder, never
dropped); `flowDown {levels, partLevel}`; `flagged[]` — the ids of
every flagged requirement, so the reference case ("each requirement
has a verifying solver output or is flagged") is checkable at a
glance.

## Reference + locator

NASA Systems Engineering Handbook, NASA/SP-2016-6105 Rev2 —
requirements definition/flow-down and the verification taxonomy. The
CI reference case (`server/tests/conkay-orc-requirements.test.js`)
uses requirement-parser's own documented brief ("a car that weighs
2,500 lb, does 180 mph, seats 4" → mass ≤ 1133.98 kg · topSpeed ≥
80.47 m/s · seats 4) and asserts the verified-or-flagged invariant
against the live registry.

## Replay request (walker / MCP)

```json
{ "nodes": [{ "id": "B1", "kind": "Part", "name": "request",
  "props": { "orc.requirements": { "text": "a car that weighs 2,500 lb, does 180 mph, seats 4" } } }],
  "edges": [] }
```

Expected envelope: `orc.requirements@B1`, PASS,
`outputs.requirements` contains REQ-SYS-mass with
`verification.verifyingSolver == "cad.mass-properties-brep"` and four
REQ-SUB-*-mass rows whose bounds sum back to the system bound; every
other requirement is verifiable, verifiable-by-inspection, or listed
in `outputs.flagged` with a reason.
