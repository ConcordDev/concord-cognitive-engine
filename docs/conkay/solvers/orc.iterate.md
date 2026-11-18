# orc.iterate — generic iterate-to-physical loop

Solver id: `orc.iterate` · v1.0.0 · domain: orchestration · fidelity L3
Source: `server/lib/conkay/orc/iterate.js` (registry form of `server/lib/conkay/iterate/loop.js`)
Engine dependency: SXE-21 (kernel settle) — not built in this lane.

## Tiers

The target tier routes the loop's top-tier checks through
**kernel settle** (engine ticket SXE-21), **not computed** in
wave 0: every run carries `outputs.engineTier = {requested:
"L3-kernel-settle", status: "NOT_COMPUTED", reason:
"engine_unavailable:sxe-21", hint: …}`.

The JS loop underneath is the existing generic
iterate-to-physical loop, previously reachable only through the
car evaluator and the Sentinel demo. This solver is its registry
form.

## What it does

Props carry a **design IR** plus **bounded design variables**
(ordered option lists, ≥ 2 options each). The loop:

1. compiles the IR and runs every applicable registry solver;
2. collects the failed checks;
3. for each failure, finds the design variables the failing run
   actually depends on (the engine records every value a solver
   reads — the link is computed, not declared) and tries their
   next options in order, re-running only what each edit
   invalidates;
4. keeps a trial only if the failing check passes and nothing
   that passed before now fails; otherwise reverts it and
   records why;
5. repeats until nothing fails or the iteration budget ends.

Invariants, surfaced from the loop rather than reimplemented:
**requirements and locked inputs are never edited** — hashed
before and after (`requirementsUnchanged` in the outputs), and a
design variable touching a locked input refuses the run up
front, named. When no bounded variable can fix a check,
requirement changes are **listed as options, never applied**.
Domains are reported side by side (`byDomain`), never combined
into one score. The loop repairs envelope-level FAIL checks
only — a verdict field inside a solver's outputs is data, not a
loop failure (declared in the registration's regime).

Standing guard: `orc.iterate` always excludes **itself** from
the inner loop's solver set (a design carrying orc.iterate props
inside the iterated design would otherwise recurse); the
exclusion is named in the outputs.

Inputs (node props under the literal key `orc.iterate`):
`{design: <IR>, variables: [{id, node, options: [{label, set}]}],
maxIterations? (1..64, default 8), excludeSolvers?}`.

Outputs: convergence, iteration count, initial/final check
summaries, final failures, per-domain status counts, the repair
log (accepted and reverted, with reasons), requirement options,
the loop's own receipt, and the final (repaired) design.

## Reference case

The loop machinery's golden brief: the **Sentinel M1 robot**,
carrying two deliberate faults (an undersized battery
configuration, a weak bracket section). With the demo's bounded
variables the loop converges — both faults repaired, zero final
FAILs, requirements unchanged. Without the battery variable it
does not converge, and the duration requirement surfaces as a
listed relax-option, unapplied. Asserted in
`server/tests/conkay-orc-iterate.test.js`.

## Replay request (SXC-23 form)

The Sentinel IR is a programmatic fixture; the replay form is:
run the loop suite's golden case through `conkay_solve
{solver_id: "orc.iterate"}` on a node whose `orc.iterate` props
carry the Sentinel design + variables (as the test does) →
expect envelope WARN (the kernel-settle tier's sxe-21
NOT_COMPUTED notice rides as the envelope's warning) with `outputs.converged == true`,
`outputs.finalFailures` empty, `outputs.engineTier.reason ==
"engine_unavailable:sxe-21"`, `outputs.requirementsUnchanged
== true`.

## Adversarial shape

- A variable touching a locked input → `INVALID_INPUT` naming
  the lock (the loop's own validation, surfaced).
- Missing design / variables → `missing_input` named;
  `maxIterations` outside 1..64 → `INVALID_INPUT`.
- A design that cannot compile → `INVALID_INPUT` carrying the
  graph build errors.
