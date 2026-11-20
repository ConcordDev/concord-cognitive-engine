# SC-05 — the input-integrity guard, armed on the production IR path

**State of record before this fix** (B2's `EQUIV-EVIDENCE.md` §2, re-verified
at B3 against the deployed build 21303b4672): the registry's
input-integrity guard (`inputIntegrityViolation` in
`server/lib/conkay/physics/registry.js`) fires only when the caller passes
`supplied`/`ignored` to `envelope()`. The direct path arms it; the
production path — MCP `conkay_solve` → `openDesign` →
`DesignEngine.ensure()` — called
`envelope(s, target, raw, { runtimeMs, revision })` and never armed it.
On the path every production solve takes, a solver echoing a different
number than the design declares reported PASS; the guard fired only when
a solver confessed in its own `substitutions` list.

**The fix** (`server/lib/conkay/graph/engine.js`): `ensure()` now passes
`supplied: declaredInputs(this.graph, run.target)` to `envelope()`.
`declaredInputs` builds the design's declared values for the run's target
from exactly the records a solver reads through the context:

- the target node's `geometry`, `props`, and `position` — every field
  the graph itself represents numerically (a finite number or a parsed
  `{ value }` quantity) under its field name. Booleans and strings are
  declarations of another kind (a flag like `props.massBudget: true`, a
  support kind) and are never coerced into numbers — `Number(true)`
  would invent a declaration the design never made;
- the target's material record (`graph.materialOf`) — every finite
  numeric field under its record name, plus the registry's canonical
  aliases `E` = `youngsModulusPa` and `yield` = `yieldPa`;
- the loads on the target — every finite numeric field as
  `<field>.<loadCase>` (the corpus echo form), and bare only when every
  load case agrees on the value.

The guard then compares the solver's echo against what the design
actually served: a mismatch is `NOT_COMPUTED` with
`input_substituted:<name> (supplied …, used …)`, never a PASS. Design
edits re-derive `supplied` on recompute, so the guard always checks
against the current declared values.

**Honest limits**

- The `ignored` half is deliberately **not** derived. Which declared
  values a solver may legitimately not consume is per-solver knowledge
  the engine does not have (a bending solver does not consume a
  compression load that a buckling run on the same node does); guessing
  it would refuse honest runs. `input_not_used` therefore still arms
  only where a caller can name the unappliable inputs — the direct
  path, or a future per-solver input declaration.
- Non-numeric declarations (support kind, geometry shape, names) are
  not comparable and stay out of `supplied`; the guard's own
  conservatism is preserved — names the design does not declare are
  never compared, and a solver's derived values under undeclared names
  pass unchecked, exactly as on the direct path.

**Evidence** — `server/tests/conkay-sc05-ir-arm.test.js` (7 legs, through
the real `openDesign` → `ensure` shape): the shipped `beam.fea` on the
evidence design still PASSes with `maxDeflection` byte-identical to the
unarmed figure (0.00450911598961386 m, B2's check-1 value); an honest
test solver echoing the declared values PASSes; substituted material /
geometry / load echoes are `NOT_COMPUTED` naming supplied vs used; a
design edit re-arms against the new value; a solver's own `notComputed`
keeps its own reason. Pristine control (the pre-fix `engine.js`): the
four substitution legs fail — the violations pass uncaught — and the
three honest legs pass in both worlds.
