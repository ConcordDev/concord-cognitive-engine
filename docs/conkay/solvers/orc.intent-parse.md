# orc.intent-parse

Free-text request → typed brief for ANY product. Catalogue SX-ORC-01,
wave 0, PRG-17. Fidelity L1 (screening), in-process JS, no engine.

## What it does

Registered solver `orc.intent-parse` (v1.0.0) runs on any design node
carrying `props["orc.intent"] = { text, proposed? }`. It generalizes the
five read domains of `chat/brief-parser.js` (car, bracket, beam, truss,
sentinel-part — those produce claims + an IR skeleton via
`parseChatBrief`) and extends the typed brief to open text: quantities
are extracted by `chat/quantities.js` for any request, and every number
in the brief is traced to the user's text by literal re-find
(PLAN-CONKAY-SENTINEL rule).

## Inputs / units

| input | shape | rule |
|---|---|---|
| `text` | string | the user's request, verbatim. Missing/empty → `NOT_COMPUTED missing_input:text`. |
| `proposed` | optional list of `{name, value, unit}` | model-proposed quantities. Admitted ONLY on literal re-find of value + unit in `text`. Non-finite, ≥1e300, or negative values are rejected as `INVALID_INPUT`, named. |

Units: SI inside. Extracted quantities echo `raw` (as written), `unit`,
`dim`, and the SI value. Bare numbers (no unit) are returned under
`bareNumbers` with the disposition "not admitted as a quantity" — never
read as SI (SC-04 discipline at this layer). Ambiguous units (`ton`,
`tons`) are excluded and named in `warnings`, never guessed.

## Outputs (envelope)

`outputs.domain` (one of the five read domains, or `null` with
`missing: ["domain"]` — an open brief is a quantities-only brief, never
an invented domain), `outputs.quantities[]` (each `traced: true` with
its source), `outputs.claims[]` + `outputs.ir` for read domains,
`outputs.admittedProposals[]` / `outputs.rejectedProposals[]` (each
rejection named with its reason), `outputs.missing[]`.

Status: PASS for a read-domain brief with claims; WARN for an open
brief or an excluded ambiguous quantity; NOT_COMPUTED only when the
text is missing or carries no parseable design content at all.

## Reference + locator

The reference case is the catalogue's 20-brief corpus (robot, car,
drone, kettle, footbridge, house, rocket, prosthetic hand, PCB,
reactor — two briefs each), implemented in
`server/tests/conkay-orc-intent-parse.test.js`: every admitted number
is re-found literally in its brief by the test itself. The cited rule
is the Sentinel literal re-find rule (PLAN-CONKAY-SENTINEL); quantities
and units vocabulary from `chat/quantities.js`.

## Replay request (walker / MCP)

Via a design whose node carries the brief:

```json
{ "nodes": [{ "id": "B1", "kind": "Part", "name": "request",
  "props": { "orc.intent": { "text": "design a footbridge over the creek, 12 m span, 3 m wide" } } }],
  "edges": [] }
```

Expected envelope: `orc.intent-parse@B1`, status PASS,
`outputs.domain == "truss"`, `inputs.text` echoing the request
verbatim, ≥2 traced quantities. Reachability via solve.direct and
chain.run rides SC-00 / SXC-26 (not yet built — named, not claimed).

## Known substrate finding (filed 2026-11-17)

`physics/solvers/graph-adapter.js`'s two halves disagree at this build:
`graphTargets` checks the literal dotted prop key (the shape compiled
nodes carry) while `graphRunner` reads via `ctx.get`'s dot-splitting
path walk, so an adapter-based solver is targeted and then reads
nothing (`props.<ns> is empty or absent`). This solver therefore
carries a local targets/run pair that checks and reads the same
literal key. The adapter is shared machinery; it is not edited here.
