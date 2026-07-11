# math — Frontend Rebuild Program, Wave 3 audit

Category leader: Wolfram Alpha / Desmos / Mathematica (computational math engine
+ symbolic solver + plotter). Backend: `server/domains/math.js` — a real,
from-scratch computer algebra system (tokenizer → recursive-descent parser →
AST → simplifier → symbolic differentiation → symbolic + numeric (Simpson's
rule) integration → equation solving with step-by-step working → unit
conversion → number theory → natural-language query parsing), plus
statistics, linear algebra, polynomial analysis, and regression fitting.

## Backend surface

11 macros registered via `registerLensAction("math", ...)`:
`grep -n 'registerLensAction("math"' server/domains/math.js`

```
statisticalAnalysis  matrixOperations   polynomialAnalysis  regressionFit
symbolicCompute      stepSolve          naturalQuery        plotFunction
unitConvert          numberTheory       casHistory
```

No shadowing re-registration of the `math` domain exists in `server.js`
(`grep -n 'register.*"math"' server/server.js` → empty) — the domain file is
what actually runs.

## What's real / already-wired (before this pass)

`components/math/SymbolicWorkbench.tsx` (682 LOC) is a genuinely deep,
purpose-built CAS surface — 7 panels (Ask/nlquery, Symbolic CAS, Step Solver,
Plotter, Units, Number Theory, History), each calling its own real macro
(`naturalQuery`, `symbolicCompute`, `stepSolve`, `plotFunction`, `unitConvert`,
`numberTheory`, `casHistory`) through `lensRun('math', action, input)` with
field shapes that were verified (via `lensRun` in
`server/tests/depth/_harness.js`) to match what the backend actually reads.
This panel alone accounts for 6 of the 11 macros and is DESIGNED, not
generic-scaffold — bespoke inputs per operation (variable/bounds for
calculus, from/to units, tool-specific n/m/k/count fields for number theory),
real result rendering (step-by-step working, root lists, chart overlays via
`ChartKit`), and a persistent per-user CAS history.

`components/math/MathActionPanel.tsx` (271 LOC) is a second bespoke panel
covering the remaining 4 macros (`statisticalAnalysis`, `matrixOperations`,
`polynomialAnalysis`, `regressionFit`) plus DTU mint/publish/DM/agent
follow-on actions, all wired to real routes (`dtu.create`, `/api/social/dm`,
`chat_agent.do`).

All 11 macros are therefore DESIGNED (real backend + bespoke UI), not
GENERIC-STRIP-ONLY or UNSURFACED — but three had field-shape bugs (below) that
made them silently non-functional despite looking wired.

## Defects found and fixed

All three were confirmed with a live boot of the real server via
`lensRun()` from `server/tests/depth/_harness.js` (compute-don't-guess,
per CLAUDE.md's runtime-truth-over-source-guessing rule) — not inferred from
reading source alone.

1. **`MathActionPanel#actStats` sent the wrong field name — the Stats button
   always returned "No numeric values to analyze," for any input.**
   `server/domains/math.js#statisticalAnalysis` reads `artifact.data.values`;
   the frontend called `callMacro('statisticalAnalysis', { data })`, so the
   virtual artifact ended up as `{ data: { data: [...] } }` — no `values` key
   anywhere. Verified live: sending `{ data: [...] }` returns
   `{"message":"No numeric values to analyze."}` regardless of the array
   content; sending `{ values: [...] }` returns the full stats payload
   (mean/median/stdDev/quartiles/outliers/shape). Fix: `actStats` now calls
   `callMacro('statisticalAnalysis', { values: data })`.
   (`concord-frontend/components/math/MathActionPanel.tsx`)

2. **`MathActionPanel#actMatrix` result rendering read the wrong key — the
   computed matrix (transpose/inverse/multiply output) was never displayed.**
   `matrixOperations` returns the computed matrix under `result.matrix`
   (verified live: `{"operation":"transpose", ..., "matrix":[[1,3],[2,4]]}`),
   but the frontend's `MatrixResult` interface and render branch looked for
   `result.result`. Transpose showed nothing but a toast; inverse showed only
   the determinant (present on that response too) and silently dropped the
   actual inverse matrix. Fix: `MatrixResult` interface + the render branch
   now read `matrix`, not `result`.

3. **`matrixOperations` UNSURFACED capabilities: `rank`, `eigenvalues`, and
   `multiply` were real, tested backend operations with zero UI path** — the
   dropdown only offered `determinant | transpose | inverse`. For a
   Wolfram-Alpha-caliber matrix tool this is a real capability gap, not a
   taste call. Fix: extended the op dropdown to all six backend operations,
   added a conditional "Matrix B" input for `multiply`, and added
   eigenvalue (real + complex-pair) and rank/full-rank rendering. Verified
   live: `multiply` → `{"matrix":[[19,22],[43,50]]}` for
   `[[1,2],[3,4]]×[[5,6],[7,8]]`; `eigenvalues` on `[[2,1],[1,2]]` →
   `{"eigenvalues":[3,1], "trace":4, "determinant":3}`; `rank` on the
   singular `[[1,2],[2,4]]` → `{"rank":1, "fullRank":false}` — all correct.

4. **`app/lenses/math/page.tsx`'s primary "Evaluator" tab routed to an LLM
   chat call instead of the real CAS — a compute-don't-guess violation.**
   `handleEvaluate` called `apiHelpers.chat.ask(expression, 'math')`, i.e. an
   LLM was asked to do arithmetic/symbolic evaluation, when
   `server/domains/math.js#naturalQuery` is a deterministic engine that
   already handles exactly this shape of input (plain expression evaluation
   is its documented fallback branch) and is the oracle every other panel on
   this same lens (`SymbolicWorkbench`'s "Ask" panel) already uses. Verified
   live that `naturalQuery` correctly evaluates the tab's own quick-example
   expressions deterministically:
   `"sin(pi/4) + sqrt(2)"` → `2.12132034`,
   `"(-5 + sqrt(25 - 4*2*3)) / (2*2)"` → `-1`,
   `"(1 + sqrt(5)) / 2"` → `1.61803399` (all hand-checkable). Fix:
   `handleEvaluate` now calls `lensRun('math', 'naturalQuery', { query:
   expression })` instead of the chat endpoint.

## Investigated and honestly deferred

- **Complex-degree (>4) polynomial root-finding and closed-form integration
  for arbitrary non-linear-argument functions** are backend-documented gaps
  (`rootsDetail: { note: "Root-finding for degree > 4 not implemented" }`,
  `casIntegrate` returns `null` → numeric Simpson's-rule fallback). These are
  genuine CAS-completeness limits, not frontend wiring defects — DATA-SOURCING
  n/a, ENGINEERING: a general polynomial root-finder (Durand–Kerner) and a
  fuller symbolic-integration table (integration by parts, trig
  substitution, partial fractions) are real, scoped future engineering work,
  not something to fake client-side. The lens already surfaces the numeric
  fallback honestly (`closedForm: false`, method labeled) rather than
  pretending a closed form exists.
- **LaTeX rendering in the Formulas tab is a hand-rolled Unicode substitution
  (`renderFormula`), not a real LaTeX engine (KaTeX/MathJax).** This is a
  pre-existing, cosmetic-only gap (superscripts/fractions render as Unicode
  approximations); left alone this pass because it doesn't affect
  correctness of any computed result and is a genuine "nice-to-have polish"
  item, not a fabricated-data or dead-macro defect — out of scope for a
  defect-finding pass per the task's own scope guidance.

## Verification

- `node --check server/domains/math.js` — OK (file untouched; sanity check only).
- `server/tests/math-safety.test.js`, `server/tests/depth/math-behavior.test.js`,
  `server/tests/invariants/property-load-bearing-math.test.js`,
  `server/tests/math-domain-parity.test.js` — 59/59 passing, 0 failures
  (unmodified, run as-is).
- `cd concord-frontend && npx eslint app/lenses/math/page.tsx components/math/*.tsx` — clean, 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` — no new errors in `lenses/math` or `components/math`.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` (math counted WIRED; totals unchanged from baseline).
- `node scripts/grade-ux-polish.mjs --honest` — `math` tier: `polished` (`audit/ux-polish.json`).
- All three field-shape/routing fixes were reproduced live against the
  real backend before and after the fix via `lensRun()` in
  `server/tests/depth/_harness.js`, per the compute-don't-guess method.

## Left alone, with reason

- `MathStackFeed`, `ArxivPanel`, `STSVKExplorer`, `SubLensQuickNav`,
  `RealtimeDataPanel`, `DTUExportButton`, `LensFeaturePanel`,
  `ManifestActionBar`/`RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel`
  (the standard cross-lens scaffold) — all pre-existing, all real/wired to
  their own backends, none of them the recurring generic-CRUD-instead-of-real-
  macro defect pattern. The lens already has two substantial bespoke
  components (`SymbolicWorkbench` at 682 LOC, `MathActionPanel` at 271 LOC)
  alongside the scaffold, which is the shape `grade-ux-polish.mjs`'s
  generic-scaffold detector expects for a non-generic lens — confirmed by
  the `polished` tier result above.
- The client-side quadratic/linear solver embedded directly in
  `app/lenses/math/page.tsx`'s "Solver" tab duplicates a subset of the
  backend `stepSolve` macro's capability (which additionally handles general
  non-polynomial equations via bisection). It was left alone because its own
  math is independently correct (standard quadratic formula, hand-verifiable)
  and it is not fabricated — `SymbolicWorkbench`'s "Step Solver" panel already
  exposes the fuller backend `stepSolve` macro (including the
  non-polynomial/bisection path) elsewhere on the same page, so the
  capability gap this duplication represents is already closed by a sibling
  panel rather than missing outright.
