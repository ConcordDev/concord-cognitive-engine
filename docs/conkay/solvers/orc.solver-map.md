# orc.solver-map

Subsystem → solver graph. Catalogue SX-ORC-05, wave 0, PRG-17.
Fidelity L1 (screening), in-process JS.

## What it does

Registered solver `orc.solver-map` (v1.0.0) runs on any design node
carrying `props["orc.solver-map"] = { subsystems: [{name, needs}] }`.
For every need it ranks the live registry's declared solvers and
reports candidates (top fidelity first, labelled `selected` /
`fast-path` with tiers) — or a **gap** naming the need verbatim.
Every unread input lands in `outputs.gaps`; nothing is dropped and
nothing is matched by invention.

Matching is a declared, deterministic rule: need and solver texts
({id, method, domain, regime}) are tokenized identically; a candidate
must match at least **two** distinct need tokens (one for a
single-token need) — the floor exists because a generic single word
force-matches ("telepathy link" matched a solver on "link" alone
during this build; that false mapping is what the gap list exists to
prevent, and the reference case pins it). Score = distinct matched
tokens; ordering is score, then declared fidelity, then id — the map
is re-derivable by hand from the registry's own declarations, the
same declarations SXC-20's status regeneration reads.

## Inputs / outputs

Inputs echo verbatim. Outputs: `map[]` per subsystem with per-need
`candidates[]` {solver, tier, score, role} or `gap: true`; `gaps[]`
{subsystem, need, reason}; `registrySize`; `fullyMapped`. A subsystem
with no declared needs maps to a named gap. Malformed subsystems
(missing name/needs, non-string needs) are `INVALID_INPUT` /
`missing_input` naming the indexed field.

## Reference + locator

The registry's own declarations are the cited source (validity
envelope: registry contents). The CI reference case
(`server/tests/conkay-orc-solver-map.test.js`) maps a robot brief's
five subsystems — structure→cad.mass-properties-brep,
actuation→actuation.joint-torque, power→orc.feasibility,
planning→orc.intent-parse — and pins "telepathy link" as a verbatim
gap.

## Replay request (walker / MCP)

```json
{ "nodes": [{ "id": "B1", "kind": "Part", "name": "plan",
  "props": { "orc.solver-map": { "subsystems": [
    { "name": "structure", "needs": ["mass properties"] },
    { "name": "comms", "needs": ["telepathy link"] } ] } } }],
  "edges": [] }
```

Expected envelope: `orc.solver-map@B1`, WARN (one gap),
structure's selected candidate is `cad.mass-properties-brep`, and
`outputs.gaps` contains exactly the "telepathy link" need, verbatim.
