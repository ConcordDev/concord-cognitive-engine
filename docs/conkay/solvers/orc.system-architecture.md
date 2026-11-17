# orc.system-architecture — system architecture synthesis

Solver id: `orc.system-architecture` · v1.0.0 · domain: orchestration · fidelity L2
Source: `server/lib/conkay/orc/system-architecture.js`
Composes: `orc.intent-parse` (SX-ORC-01) · `orc.requirements` (SX-ORC-02) ·
`compiler/architectures.js` · engine leg SXE-21 (not built).

## What it does

Given a product brief, produce the system architecture: subsystems,
each parented on a requirement, with alternatives enumerated for
trade study.

- **Known kinds keep their compiled architecture.**
  `compileBrief` (road vehicle, L-bracket) supplies the subsystem
  nodes; each subsystem's allocated requirements are traced through
  the compiled CONTAINS tree from the requirements' solver targets
  (a requirement covers its target node and its descendants).
  `architectures.js` invents nothing, and neither does this solver.
- **Any other product gets generic synthesis** from the canonical
  subsystem taxonomy the ticket declares: structure ·
  armor/enclosure · interior · power · propulsion/actuation ·
  thermal · electrical · compute/controls · sensors · interfaces.
  Every subsystem is parented on the root requirement — the brief,
  verbatim (`REQ-SYS-ROOT`) — and ORC-02's system requirements are
  allocated by a declared metric→subsystem table (mass →
  structure/power/propulsion; topSpeed → propulsion/structure; power
  → power/thermal; range → power/propulsion; seats → interior;
  designWindSpeed → structure). A metric the table does not allocate
  is listed **unallocated with its reason** (budget: cost rolls up
  over all subsystems and is allocated at the system report,
  SX-ORC-12) — never dropped, never force-fit.

Alternatives are enumerated at the architecture level: when a
compiled architecture exists, the generic taxonomy stands beside it
as the alternative; when none exists, the compiled absence is named
with `compileBrief`'s own error.

**Content-bearing test (composition rule):** a brief counts as
readable if ANY leg of the chain can read it — ORC-01's quantity
vocabulary and ORC-02's requirement vocabulary differ (a budget-only
brief, "under $900", is requirement content with no ORC-01
quantities). The content-free verdict requires all three legs
(intent, requirements, compiler) to find nothing.

The SXE-21 engine leg (engine-grade architecture verification)
rides as `outputs.engineTier {requested L2, NOT_COMPUTED,
engine_unavailable:sxe-21}` with a warning; the JS synthesis is
reported beside it, labelled — never dressed as the engine result.

Inputs (node props under the literal key `orc.systemArchitecture`):
`{text}`.

## Reference case

"a bipedal robot that weighs 20 kg, does 3 m/s, runs 4 hours on a
charge" → generic synthesis: the ten taxonomy subsystems, each with
`parentRequirement == "REQ-SYS-ROOT"`, the root's source being the
brief verbatim; mass allocated to structure/power/propulsion. A car
brief → the compiled road-vehicle architecture with the generic
taxonomy as its trade-study alternative. Asserted in
`server/tests/conkay-orc-system-architecture.test.js`.

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.system-architecture",
  "inputs": { "text": "a bipedal robot that weighs 20 kg, does 3 m/s, runs 4 hours on a charge" } }
```

Expected envelope: status PASS with
`outputs.architecture.kind == "generic"`,
`outputs.subsystemCount == 10`, every subsystem's
`parentRequirement == "REQ-SYS-ROOT"`,
`outputs.rootRequirement.source` equal to the brief verbatim, and
`outputs.engineTier.reason == "engine_unavailable:sxe-21"`.

## Adversarial shape

- Content-free text ("hello there friend") → `NOT_COMPUTED
  no_parseable_design_content` (all three chain legs found nothing).
- Missing text → `NOT_COMPUTED missing_input:text`.
- A budget-only brief still synthesizes (generic path) with the
  budget requirement named in `requirementCoverage.unallocated`.
