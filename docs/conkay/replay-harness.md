# The walker replay harness (SXC-23)

Module: `server/lib/conkay/replay/harness.js` · CLI: `server/scripts/conkay-replay.mjs` · Pin: `server/tests/conkay-replay-harness.test.js`

## What it does

Every solver ticket ships `docs/conkay/solvers/<id>.md` with a
**replay request** and an **expected envelope**. The harness
extracts those replays, executes them against the live registry
through `openDesign` (the ConKay chat / MCP execution path), and
checks the stated expectations. The walker runs it post-fix:

```
cd server && node scripts/conkay-replay.mjs
```

Exit code 1 when any replay fails. The CI pin runs the same
module, so a replay that fails in CI fails for the walker.

## Replay forms

- **IR-form** — a JSON design fragment `{nodes, edges}` whose
  node props carry the solver's graphProp key.
- **solver_id-form** — `{solver_id, inputs}`, normalized to a
  one-node design under the solver's graphProp key.
- **Fixture form** — no JSON block; the input is a programmatic
  fixture (today: `orc.iterate` over the Sentinel M1 demo IR),
  bound by name in the harness and reported as `[fixture]`.

## The universal contract (checked per replay)

1. The named envelope exists (`<solver>@<node>`).
2. Its status equals the status the doc declares (the first
   PASS/WARN/FAIL token of the Expected paragraph).
3. Supplied input values are preserved exactly (SC-05): no
   supplied leaf value may change or vanish from an echoed
   structure. Solver-defaulted additions and declared
   restructurings (an IR prop softening) are reported, not
   hidden. A supplied top-level key the solver declares it
   does not echo (today: `orc.edit-commands`' `design` — it
   echoes the command text; the edited design returns in
   outputs) is reported NOT-ECHOED and pinned to a known set.
4. Every simple backticked equality in the Expected paragraph
   — `outputs.<path> == <number|string|boolean|null>` — holds.

Expectations the grammar cannot reduce (contains, sums-back,
names, ≥, set literals) are reported per doc as **UNREDUCED**
fragments for the walker to read — never silently skipped. The
pin holds the unreduced set, and the not-echoed set, to exactly
the known sets: new entries fail CI until a human classifies
them (SXC-25's shrink-only discipline).

## First-run findings (2026-11-18, branch sx/core-loop)

The harness's first run failed 14 of 19 replays — every failure
a **doc declaration**, not a solver: eleven docs declared
`status PASS` where the engine's envelope is WARN, because
these solvers emit designed warnings (engine-tier NOT_COMPUTED
notices, a PARTIAL report, unpriced BOM lines, skipped chain
steps). The docs were corrected at the declaration layer to
declare WARN with the reason named; no solver behavior changed.
That is the harness's purpose: the walker's spec must state
what the envelope actually does, or the post-fix replay grades
fiction.
