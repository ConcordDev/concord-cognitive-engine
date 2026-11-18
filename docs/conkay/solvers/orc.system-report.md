# orc.system-report — system report with per-part receipts

Solver id: `orc.system-report` · v1.0.0 · domain: orchestration · fidelity L1
Source: `server/lib/conkay/orc/system-report.js`
Engine: JS — no engine tier on this ticket.

## What it does

The calc-sheet pattern extended to systems: an assembler over the
landed solvers' **outputs objects** (not envelopes) —
`orc.system-architecture`, `orc.mass-bom`, `cad.bom-structure`,
`orc.integration-checks`, `orc.research-gaps` — that produces the
report a human or a walker reads. Its honesty rule is the
reference case: **every claim links to a receipt**. Each extracted
claim carries `{solver, evidence}` — the producing solver and the
path of the value inside its outputs.

The assembler **copies values; it computes no new engineering
numbers.** The one computation it owns is consistency: the mass
total arrives by two independent paths (orc.mass-bom's roll-up,
cad.bom-structure's tree roll-up) and must agree within 1e-9 kg —
a disagreement is named in `inconsistencies` with both values
standing, never averaged or picked from.

Sections absent from the input are named in `missingSections`
and stamp the report `PARTIAL` (`COMPLETE` only when all five
sections are present and consistent) — a report that quietly
omits the integration section reads as a pass it never earned.
NOT_COMPUTED values ride as claims with `value: null` and their
status/reason carried: a massless part, an unpriced BOM total,
and a NOT_RUN integration section appear in the report *as gaps*,
not as absences.

A `previous` input (the same section shapes from an earlier
design version) produces the **realistic-version diff**: claims
keyed identically across versions, listed as added / removed /
changed with before and after values.

Inputs (node props under the literal key `orc.systemReport`):
`{system: {id, name?}, architecture?, massBom?, bom?,
integration?, gaps?, previous?}` — each section the producing
solver's outputs object; a section missing its anchor fields
refuses the run, naming the section and field.

## Reference case

The full upstream chain run live (robot architecture, a 1 kg cube
through mass-bom and BOM, a closing power budget, one research
gap) assembles a COMPLETE report: every claim receipted, the two
mass roll-ups agreeing. Doubling the BOM quantity stamps the
report PARTIAL with the disagreement named. Asserted in
`server/tests/conkay-orc-system-report.test.js`, which runs the
real upstream solvers rather than hand-shaped fixtures.

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.system-report",
  "inputs": { "system": { "id": "rig-1" },
              "massBom": { "totalMassKg": 1, "parts": [ { "id": "block", "massKg": 1 } ], "cgM": [0, 0, 0.05], "cgNotComputed": null, "masslessParts": [] } } }
```

Expected envelope: status WARN (the PARTIAL completeness rides as
the envelope's warning — sections are named, never silently
omitted) with `outputs.completeness ==
"PARTIAL"` (four sections missing, named), the `mass.totalKg`
claim valued 1 with receipt `{solver: "orc.mass-bom", evidence:
"massBom.totalMassKg"}`, `outputs.unreceipted` empty.

## Adversarial shape

- No `system.id` → `NOT_COMPUTED missing_input:system.id`; no
  sections → `missing_input:sections`.
- A section that is not the producing solver's outputs (missing
  anchor fields, or an array) → `INVALID_INPUT` naming the
  section and the field it does not carry.
