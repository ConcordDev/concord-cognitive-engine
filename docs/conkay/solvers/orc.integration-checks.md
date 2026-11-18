# orc.integration-checks — cross-subsystem integration checks

Solver id: `orc.integration-checks` · v1.0.0 · domain: orchestration · fidelity L3
Source: `server/lib/conkay/orc/integration-checks.js`
Engine: JS — no engine tier on this ticket.

## What it does

Verifies that what the subsystem solvers and the architecture
declare is mutually consistent. It computes nothing about the
subsystems themselves; it checks the seams:

- **Power closure** — supplied = consumed + losses, residual in W.
- **Heat closure, per loop** — generated = rejected at steady
  state, residual per loop.
- **Mass within target** — actual ≤ target, margin reported.
- **CG within target** — per-axis |actual − target| ≤ toleranceM
  (always declared; the CG check has no default tolerance).
- **Interface compatibility** over a declared vocabulary:
  voltage (both sides equal), connector (type strings equal),
  flow (source capacity ≥ sink demand), thread (designation
  strings equal). A FAIL names both sides and both values.
- **Clearances** — gap ≥ required, margin reported.
- **Load paths** — segment chains continuous; a break names its
  index and the two nodes that fail to meet.

Every check row carries its quantities, its residual or margin,
and its verdict in a stable shape — these rows are the per-link
evidence the chain receipt (SX-CHAIN-RECEIPT) consumes.

A section the input does not declare is listed in `notRun` with
its reason — never silently passed; the verdict covers only the
checks that ran. If nothing ran, the run is `NOT_COMPUTED
no_checks_declared`. Closure tolerances: a declared `toleranceW`
is used as given; otherwise a relative 1e-9 of the largest term —
and the tolerance used plus its source (`declared` /
`default-relative-1e-9`) is reported in the check row. A fallback
that is printed, not silent.

Inputs (node props under the literal key `orc.integrationChecks`):
`{power?, heatLoops?, mass?, cg?, interfaces?, clearances?,
loadPaths?}` — shapes per section as in the solver docblock.

## Reference case

A healthy robot system (1000 W = 800 + 200; heat loop 450 = 450;
mass 18.5 ≤ 20 kg; CG within 0.02 m; 28 V/XT90/flow/thread
interfaces matched; clearances met; load path continuous) PASSes
every check. Breaking the bus to 28 V vs 24 V FAILs with the
detail "MISMATCH: side a declares 28 V, side b declares 24 V" —
the catalogue's named case. Asserted in
`server/tests/conkay-orc-integration-checks.test.js`.

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.integration-checks",
  "inputs": { "power": { "suppliedW": 1000, "consumedW": 800, "lossesW": 200 },
              "interfaces": [ { "id": "bus", "kind": "voltage", "a": { "volts": 28 }, "b": { "volts": 24 } } ] } }
```

Expected envelope: status WARN (the run computed — the envelope's
WARN carries the failing interface and the not-run sections as
notices; the verdict data below is the FAIL) with
`outputs.verdict == "FAIL"`, the power-closure row PASS with
residual 0, the interface:bus row FAIL naming both sides, and the
undeclared sections listed in `outputs.notRun`.

## Adversarial shape

- NaN or negative power values → `INVALID_INPUT` naming the
  section.
- Interface kind outside the vocabulary → `INVALID_INPUT` naming
  it; an interface missing a side → `INVALID_INPUT`.
- CG without a tolerance → `INVALID_INPUT` (no default exists).
- Empty input → `NOT_COMPUTED no_checks_declared`.
