# orc.research-gaps — missing data → research queue

Solver id: `orc.research-gaps` · v1.0.0 · domain: orchestration · fidelity L1
Source: `server/lib/conkay/orc/research-gaps.js`
Engine dependency: SXE-41 (research engine) — not built in this lane.

## Tiers

The target tier routes every gap to the **research engine**
(literal re-find, SSRF-guarded fetch — engine ticket SXE-41). It
is **not computed** in wave 0: every run carries
`outputs.engineTier = {requested: "L1-research", status:
"NOT_COMPUTED", reason: "engine_unavailable:sxe-41", hint: …}`.

What the solver computes is the **queue** — and the queue is the
honesty mechanism. A declared data gap becomes a stable queue
item naming:

- the `property` and its `gapKind` — one of a declared vocabulary:
  `missing` (no value exists), `unsourced` (a value is claimed
  without a source), `unreadable` (an input could not be read);
- the requesting solver (`forSolver`), the declared `unit`, and
  the `sourceClass` that would satisfy it — `textbook`,
  `datasheet`, or `standard` (free public sources only; any other
  class refuses the run, named);
- `status: "QUEUED"`, `engine: "sxe-41"`, and — the point of the
  ticket — `valueStatus: "NOT_COMPUTED"` with the reason: *no
  value is guessed; it lands only when the research engine
  returns a sourced value.*

Duplicate needs (same property, same requester) dedupe into one
item with an occurrence count, reported in the warnings. The same
property for a different requester is a separate item.

Inputs (node props under the literal key `orc.researchGaps`):
`{needs: [{property, gapKind, forSolver?, unit?, sourceClass?,
context?}]}`.

## Reference case

A missing allowable stress for a beam solver → one queue item,
`status QUEUED`, `valueStatus NOT_COMPUTED`, no value-shaped field
anywhere in the output. Asserted in
`server/tests/conkay-orc-research-gaps.test.js`.

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.research-gaps",
  "inputs": { "needs": [ { "property": "allowableStress", "gapKind": "missing", "forSolver": "struct.beam-bending", "unit": "MPa", "sourceClass": "textbook" } ] } }
```

Expected envelope: status PASS (queue formed) with
`outputs.engineTier.reason == "engine_unavailable:sxe-41"`,
`outputs.queueCount == 1`, the item's `valueStatus ==
"NOT_COMPUTED"`, inputs echoed exactly.

## Adversarial shape

- Unknown `gapKind` or a non-free `sourceClass` (e.g. "blog") →
  `INVALID_INPUT` naming the vocabulary.
- Missing property → `INVALID_INPUT` naming the index; empty
  `needs` → `NOT_COMPUTED missing_input:needs`.
