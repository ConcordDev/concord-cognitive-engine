# orc.edit-commands — deterministic plain-language edits

Solver id: `orc.edit-commands` · v1.0.0 · domain: orchestration · fidelity L0 (screening)
Source: `server/lib/conkay/orc/edit-commands.js` · Grammar: `server/lib/conkay/compiler/edit-parser.js`

## What it does

Turns a plain-language edit sentence into checked graph operations and
applies them to a design IR. The sentence is parsed by the deterministic
`parseEdit` grammar (materials, geometry params, named props, tyre speed
rating). The parser never guesses a node or a number: a sentence it cannot
read comes back as `NOT_COMPUTED edit_not_read: <parser error verbatim>`.

Outputs:

- `ops` — the parser's op list verbatim (`{node, path, value}`).
- `editedNodes` / `untouchedNodes` — the exact partition of the design's
  nodes, so "edits every bracket, nothing else" is checkable from the
  output alone.
- `inverseOps` — each op's prior value; applying them restores the
  original design (undo by construction).
- `design` — the edited IR (the input design is never mutated).

Quantities in sentences are parsed by the units layer and stored SI
(e.g. a 12 mm thickness lands as 0.012 m). Rerun invalidation is not
re-implemented here: it is the DesignEngine's recorded-reads staleness,
and the edited-node set this solver returns is exactly its input.

## Inputs

Node props under the literal key `orc.edit-commands`:

```json
{ "text": "change all bolts to A490", "design": { "design": {"id": "d1"}, "nodes": [...], "edges": [] } }
```

The design rides the typed input explicitly — the same shape
solve.direct / `conkay_solve` use.

## Reference case

Design: bolts B1, B2 (material `iso-3506-a2-70`) and plate P1
(`steel-a36`, box geometry). Sentence: `change all bolts to A490`.

Expected: `editedNodes == [B1, B2]`, `untouchedNodes == [P1]`, both bolts'
material becomes `astm-a490`, P1 byte-identical, and applying
`inverseOps` restores the original design deep-equal. Asserted in
`server/tests/conkay-orc-edit-commands.test.js` (reference source: the
parser's own deterministic grammar; the expected values are the grammar's
documented mappings, not the solver's output).

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.edit-commands",
  "inputs": { "text": "change all bolts to A490",
              "design": { "design": {"id": "d1", "name": "D1"},
                          "nodes": [
                            {"id": "B1", "kind": "Bolt", "name": "bolt one", "material": "iso-3506-a2-70"},
                            {"id": "B2", "kind": "Bolt", "name": "bolt two", "material": "iso-3506-a2-70"},
                            {"id": "P1", "kind": "Plate", "name": "plate", "material": "steel-a36",
                             "geometry": {"shape": "box", "length": "200 mm", "width": "100 mm", "height": "10 mm"}} ],
                          "edges": [] } } }
```

Expected envelope: status PASS; `outputs.editedNodes` = [B1, B2];
`outputs.untouchedNodes` = [P1]; `outputs.ops` carries exactly two
material ops with value `astm-a490`; inputs echo `text` verbatim.

## Adversarial shape

- Unreadable sentence → `NOT_COMPUTED edit_not_read: …`, never a guess.
- Edit naming a nonexistent part → `NOT_COMPUTED` naming the part.
- Missing `text` or `design` → `NOT_COMPUTED missing_input:<field>`.
- Design that does not compile → `INVALID_INPUT: design does not compile: …`.
