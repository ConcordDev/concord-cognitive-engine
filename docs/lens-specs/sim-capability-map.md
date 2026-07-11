# Sim Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/sim.js` (1163 LOC) in full —
> `grep -n 'registerLensAction("sim"' server/domains/sim.js` lists all
> 15 macros. Frontend audited by reading `app/lenses/sim/page.tsx`
> (2744 LOC before this session) in full plus every imported component
> under `components/sim/` (`SimRepos.tsx`, `SystemDynamicsBuilder.tsx`,
> `AgentBasedRunner.tsx`, `DiscreteEventRunner.tsx`, `SimToolkit.tsx`).
> Also traced the macro dispatch chokepoint (`POST /api/lens/run` vs
> `POST /api/lens/:domain/:id/run`, `server.js:39530` and `:39745`) to
> understand why some calls silently no-op — this is the root cause of
> the defect below, not a guess.

## Backend surface — 15 macros, all real, all pure/deterministic compute

`server/domains/sim.js` is genuine engineering, not scaffolding:

- **Original 4** (pure-compute, artifact-shape input): `scenarioRun`
  (rule-based field-transition stepper — growth/decay/add/cap/floor),
  `parameterSweep` (single-parameter what-if across a range),
  `monteCarlo` (uniform/normal sampling, sum/product/max/min
  aggregation, exact percentiles + 90% CI), `sensitivityAnalysis`
  (deterministic ± perturbation elasticity/tornado ranking).
- **8 added for AnyLogic/Vensim-parity** (params-aware): `systemDynamics`
  (real Euler-integrated stock-and-flow solver with feedback-loop
  polarity detection — `integrateSystemDynamics`), `saveModel` /
  `listModels` / `loadModel` / `deleteModel` (per-user persistent
  system-dynamics model store), `agentBased` (three real spatial-grid
  agent runtimes: SIR epidemic, Schelling segregation, Lotka-Volterra
  predator-prey — toroidal grid, seeded RNG, real neighbor-radius
  infection/happiness/hunt logic), `discreteEvent` (a genuine
  next-event time-advance M/M/c queue simulator — exponential
  interarrival/service sampling, event list, utilization/throughput/
  wait-time statistics), `evaluateFormula` (shunting-yard parser + RPN
  evaluator, no `eval`), `goalSeek` (bisection for target-hit,
  golden-section search for maximize/minimize), `calibrate`
  (coordinate-descent parameter fitting against historical data —
  SSE/RMSE/R²), `scenarioDiff` (real Welch's two-sample t-test with
  Cohen's d effect size).

Every handler returns `{ok, result?, error?}` and never throws (verified
by reading every `try/catch`). None of the 15 macros touch an LLM —
this is exactly the "compute-don't-guess" deterministic-engine class
CLAUDE.md calls out as an oracle, not a place an LLM should be
guessing.

## Reference app

**AnyLogic** — the real category leader for multi-paradigm simulation
(the only major tool that does system dynamics + agent-based +
discrete-event in one product, which is exactly this lens's scope; the
domain file's own header comment says "AnyLogic / Vensim parity").
Secondary references: **Vensim/Stella** for the stock-and-flow builder,
**Oracle Crystal Ball / @RISK** for the Monte Carlo + sensitivity
tooling.

## Defect found and fixed

**Field-shape mismatch silently dead-ended 4 of 15 macros behind a
generic quick-action panel — a real defect, not a stale claim.**

The page had a prominent "Simulation Analysis Engine" panel (4 buttons:
Run Scenario / Param Sweep / Monte Carlo / Sensitivity) plus a toolbar
"Sensitivity Analysis" button, both dispatching through
`useRunArtifact('sim')` → `POST /api/lens/sim/:id/run` → the generic
`lens.run` macro (`server.js:38305`), which calls
`handler(ctx, artifact, params)` where `artifact.data` is the
**persisted Scenario record** (`{name, description, variables,
assumptions, iterations, ...}`).

The four legacy macros (`scenarioRun`, `parameterSweep`, `monteCarlo`,
`sensitivityAnalysis`) read **only** `artifact.data` and structurally
ignore their third `params` argument (`_params` — underscore-prefixed,
literally unused). A Scenario's `data` has no `initialState`/`rules`/
`baseState`/`trials` fields — that shape belongs to a different,
older mental model these 4 macros predate. Effect at runtime:

- `scenarioRun`, `parameterSweep`, `sensitivityAnalysis` **always**
  short-circuited to their `"Provide initialState/baseState and rules"`
  placeholder message, regardless of what the user configured — three
  designed, discoverable buttons that could never produce real output.
- `monteCarlo` happened to partially work by coincidence (a Scenario's
  `variables[]` entries carry `min`/`max`, which the macro also reads),
  but only for the **first scenario in the list** (`scenarioArtifacts[0]
  ?.id || 'sim'`) regardless of which scenario the user had selected —
  not a designed feature, an accident of overlapping field names.
- The other 7 macros in `sim.js` that DO read `params` correctly
  (`evaluateFormula`, `goalSeek`, `scenarioDiff`, `calibrate`,
  `systemDynamics`, `agentBased`, `discreteEvent`) are dispatched from
  `SimToolkit.tsx`/`SystemDynamicsBuilder.tsx`/`AgentBasedRunner.tsx`/
  `DiscreteEventRunner.tsx` via the **direct** `lensRun('sim', name,
  input)` helper → `POST /api/lens/run` (`server.js:39530`), which
  builds `virtualArtifact.data = input` — i.e. `artifact.data` IS the
  caller's params for that path. This is why those 7 worked and the 4
  didn't: two different dispatch mechanisms exist in this codebase, and
  the 4 legacy macros were only ever exercised by the wrong one.

**Fix (this session, no backend changes needed):**

1. Extended `SimToolkit.tsx` with four new bespoke tools (Scenario Run,
   Param Sweep, Monte Carlo, Elasticity) that call the 4 legacy macros
   via the *correct* `lensRun` direct-dispatch path with real,
   user-authored params (a shared `parseStateLines`/`parseRuleLines`
   text-format parser, matching the existing tool idiom of small typed
   forms + real result rendering — not a JSON-paste textarea). Each
   tool has its own honest empty/error rendering (`res.message` shown
   verbatim when the macro legitimately has nothing to compute, e.g.
   an empty rules list).
2. Removed the broken "Simulation Analysis Engine" panel from
   `page.tsx` (dead state: `simActionRunning`, `scenarioRunResult`,
   `paramSweepResult`, `monteCarloResult`, `sensitivityResult`,
   `handleSimAction`, and the now-unused `useRunArtifact` import/call).
3. Removed `<UniversalActions domain="sim" artifactId={null} compact />`
   — a generic AI-catchall action bar mounted with `artifactId={null}`
   (i.e. calling `analyze`/`generate`/`suggest` with no artifact
   context at all), the same GENERIC_TRIO-adjacent scaffold class
   already stripped from sibling lenses this wave.
4. Fixed the toolbar **"Sensitivity Analysis"** button
   (`handleRunSensitivity`), which had the identical mismatch — it's
   scoped to a Scenario's `variables[]`/`sensitive` flags, which is a
   Monte-Carlo/statistical model, not a rules-based dynamical system,
   so it can never honestly synthesize a `baseState`+`rules` payload.
   The honest fix reuses the REAL, already-computed correlation-based
   sensitivity ranking that `runMonteCarloChunked` produces as a
   byproduct of every simulation run (visible in the Results tab's
   existing Sensitivity panel) instead of a mismatched macro call —
   this is a genuine statistical technique (per-variable
   sample-outcome correlation across all Monte Carlo trials), not a
   fabrication. Users who specifically want the deterministic ±
   perturbation elasticity technique can reach the real macro directly
   via Studio → Analysis Toolkit → Elasticity.

Net effect: all 15 macros are now DESIGNED-tier reachable (0/15
unsurfaced, same as before, but now genuinely functional instead of
accidentally-half-working), and two generic-scaffold surfaces were
removed.

## 1.5 Reference-parity checklist

| # | Item (AnyLogic / Vensim / Crystal Ball) | Disposition |
|---|---|---|
| 1 | Stock-and-flow visual model builder + Euler integration | ALREADY REAL — `SystemDynamicsBuilder.tsx` → `systemDynamics`, feedback-loop polarity detection |
| 2 | Persistent model library | ALREADY REAL — `saveModel`/`listModels`/`loadModel`/`deleteModel`, per-user store |
| 3 | Agent-based spatial simulation | ALREADY REAL — `AgentBasedRunner.tsx` → `agentBased` (SIR / Schelling / predator-prey on a toroidal grid) |
| 4 | Discrete-event queueing simulation | ALREADY REAL — `DiscreteEventRunner.tsx` → `discreteEvent`, genuine next-event M/M/c solver |
| 5 | Monte Carlo with percentiles + CI | ALREADY REAL, now actually reachable — new SimToolkit tool → `monteCarlo` |
| 6 | Sensitivity / tornado chart | ALREADY REAL, now actually reachable — new SimToolkit "Elasticity" tool → `sensitivityAnalysis`; correlation-based variant already worked via the Results tab |
| 7 | Goal-seek / target-driven optimization | ALREADY REAL — `SimToolkit.tsx` → `goalSeek` (bisection + golden-section search) |
| 8 | Scenario comparison (statistical significance) | ALREADY REAL — `SimToolkit.tsx` → `scenarioDiff`, Welch's t-test + Cohen's d |
| 9 | Historical calibration | ALREADY REAL — `SimToolkit.tsx` → `calibrate`, coordinate-descent SSE minimization |
| 10 | Safe formula/expression evaluator | ALREADY REAL — `SimToolkit.tsx` → `evaluateFormula`, shunting-yard, no `eval` |
| 11 | Rule-based quick what-if projection | GENUINELY MISSING → FIXED this session (new SimToolkit "Scenario Run" + "Param Sweep" tools) |

**Coverage summary:** 11 of 11 checklist items real; 2 previously
unreachable due to the field-shape defect above, now fixed and wired
through the correct dispatch path. This lens genuinely earns its
"AnyLogic parity" framing — the gap was wiring, not engineering depth.

## Honestly-deferred / not touched this session

- **`monteCarlo`'s RNG is `Math.random()`, not seeded.** Unlike
  `agentBased`/`discreteEvent` (which use a seeded `makeRng`),
  `monteCarlo` results aren't reproducible run-to-run. This is a
  pre-existing property of the macro, not a regression — flagging it
  as a candidate for a future `seed` param, ENGINEERING triage (no
  external dependency, a small deterministic-RNG swap), not urgent
  enough to bundle into this defect-fix session since it doesn't
  affect honesty (no fabricated numbers, just non-reproducible ones).
- **The client-side Monte Carlo engine in `page.tsx`
  (`runMonteCarloChunked`) and the backend `sim.monteCarlo` macro are
  two independent, non-unified implementations** (client: 6
  distributions incl. exponential/gamma/poisson/beta/triangular, no
  formula-aggregation modes, chunked/progressive; backend: 2
  distributions, 4 aggregation formulas, exact percentiles in one
  shot). Left both in place — they serve genuinely different UX needs
  (progressive UI feedback for large scenario runs vs. instant backend
  compute for quick tool use) and unifying them was out of scope for a
  field-shape-mismatch fix.

## Files touched

- `concord-frontend/app/lenses/sim/page.tsx` — removed the broken
  "Simulation Analysis Engine" panel + its dead state/handler, removed
  `<UniversalActions>`, fixed `handleRunSensitivity` to reuse the real
  Monte Carlo correlation-based sensitivity engine instead of a
  mismatched macro call, removed now-unused `useRunArtifact` import.
- `concord-frontend/components/sim/SimToolkit.tsx` — added 4 new tools
  (Scenario Run, Param Sweep, Monte Carlo, Elasticity) wired to the 4
  previously-mismatched macros via the correct direct `lensRun`
  dispatch, with a shared rule/state text-line parser.

## Verification

- `node --check server/domains/sim.js` — OK (no backend changes made;
  confirms baseline).
- `cd server && node --test tests/sim-domain-parity.test.js` —
  **39/39 passing** (all 9 macro-group suites: scenarioRun,
  parameterSweep, monteCarlo, sensitivityAnalysis, systemDynamics,
  agentBased, discreteEvent, model-store CRUD, scenarioDiff).
- `cd server && node --test tests/depth/sim-behavior.test.js` —
  **1/1 passing** (the real behavioral-invocation suite covering
  evaluateFormula/systemDynamics/discreteEvent/agentBased/goalSeek/
  calibrate/scenarioDiff/scenarioRun/parameterSweep/
  sensitivityAnalysis/model-store with exact computed-value
  assertions).
- `cd concord-frontend && npx eslint app/lenses/sim/page.tsx
  components/sim/SimToolkit.tsx` — clean, exit 0, zero
  errors/warnings.
- `node scripts/lens-unsurfaced.mjs --lens sim` — `0/15 macros never
  referenced` (unchanged — but now genuinely, not accidentally, true).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,
  "NO-BACKEND-CALL":2}` total 260 (unchanged, holds).
- `node scripts/grade-ux-polish.mjs --honest` — sim: `tier:"polished"`,
  `isGenericScaffold:false`, `honestCapped:false`. Before → after:
  `usesGenericBody` true→**false**, `hasInlineActionWall` true→**false**,
  `bespokeRatio` 0.347→**0.438**, `pageLoc` 2744→**2469** (net −275
  lines of dead/generic surface removed while adding ~370 lines of real
  bespoke tool UI to `SimToolkit.tsx`).
- `git checkout -- audit/` after each grader run — regenerated audit
  JSON/MD never committed.
