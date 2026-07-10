# Engineering Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -n "registerLensAction('engineering'" server/domains/engineering.js | wc -l
```
→ **18** macros in `server/domains/engineering.js` (974 lines): `toleranceAnalysis`,
`toleranceChain`, `stressAnalysis`, `unitConvert`, `materialLibrary`,
`parametricSolid`, `partMesh`, `saveLoadCase`, `listLoadCases`, `deleteLoadCase`,
`meshGenerate`, `runFEA`, `listSimJobs`, `savePart`, `listParts`, `deletePart`,
`bom`, `bomRollup`.

```
grep -n "registerLensAction('engineering'" server/server.js
```
→ **4 more**, registered *inline in server.js* (`server.js:41861-41897`), NOT in
the domain file — `structuralCheck`, `thermalAnalysis`, `electricalCheck`,
`hydraulicAnalysis`. Each is a thin combinator that calls
`await loadComputeModule('engineering')` (resolves to
`server/lib/compute/engineering-compute.js`) and bundles 2-3 of that file's
pure functions behind one macro call sharing one flat params object — e.g.
`structuralCheck` = `columnBuckling` (Euler critical buckling) +
`reinforcedConcreteWall` (ACI-318-shaped shear wall FoS) + `weldStrength`
(AWS D1.1 fillet weld capacity). `engineering-compute.js` also exports
`boltedConnection` and `transformerSizing`, which are NOT wired into any of
the 4 combinator macros (see "Deliberately left unsurfaced" below).
Real total: **22 macros**, not 18 — the domain file is not the only source
for this lens, contra what a shallow grep of `domains/engineering.js` alone
would conclude.

```
node scripts/lens-unsurfaced.mjs --lens engineering
```
→ was `1/18` (`listSimJobs`) before this pass — but that script only walks
the domain file's 18, so it structurally couldn't see the 4 inline macros at
all. Direct grep confirmed zero frontend references to `structuralCheck`,
`thermalAnalysis`, `electricalCheck`, or `hydraulicAnalysis` anywhere under
`concord-frontend/` before this pass
(`grep -rn "structuralCheck\|thermalAnalysis\|electricalCheck\|hydraulicAnalysis" concord-frontend/`
→ only a false-positive hit in the unrelated `materials.thermalAnalysis`
macro, a different domain). So the real starting count was **5 of 22
macros with zero frontend reachability** — a materially bigger gap than the
tool's own number implied, and exactly the "real backend depth sitting
disconnected" pattern this audit was looking for, not a fabrication.

Frontend: `concord-frontend/app/lenses/engineering/page.tsx` (8-tab shell) +
`concord-frontend/components/engineering/{BomPanel,EngineeringActionPanel,
FEAResultViewer,GeometryEditor,HnEngineeringFeed,TolerancePanel}.tsx` (six
files pre-existing this pass). Server tests:
`server/tests/engineering-domain-parity.test.js` (envelope-shape pins),
`server/tests/engineering-lens-macros.test.js` (component-exact field
contracts, hermetic local dispatch — does not reach the 4 inline macros
since they're not exported from `domains/engineering.js`),
`server/tests/depth/engineering-behavior.test.js` (real behavioral
invocations via the server-boot `lensRun` harness — the only one of the
three that CAN reach the inline macros, since it boots the whole
`server.js` and both `LENS_ACTIONS` registration sites land in the same
global map).

## Reference apps

- **Parametric CAD + FEA**: Fusion 360 / Onshape (parametric solid → material
  → mesh → solve → colour-mapped stress/utilization viewport), SimScale
  (beam-frame direct-stiffness solver, load-case library).
- **GD&T / tolerance stack-up**: SolidWorks TolAnalyst, gagemaker.com-style
  worst-case + RSS stack calculators.
- **BOM / procurement**: Arena PLM, Fusion 360's BOM tab (rollup + supplier
  links + lead-time critical path).
- **Multi-discipline engineering toolbox**: MechaniCalc / Engineering
  ToolBox (independent structural / electrical / thermal / hydraulic
  calculators, each showing its formula + inputs + code-reference warnings,
  not just a bare number).

## Classification (before this pass)

**Mixed, in the specific way CLAUDE.md's audit brief predicted**: the FEA +
CAD core (`GeometryEditor`, `FEAResultViewer`, `TolerancePanel`, `BomPanel`,
the Model/Loads/Materials/Analysis tabs in `page.tsx`) is genuinely strong —
real 3-D parametric geometry with a live Three.js preview, a real
direct-stiffness FEA solver with a colour-mapped deformed-shape viewport, a
directional tolerance-chain calculator with a fit verdict, and a BOM rollup
with supplier deep-links and a per-supplier cost chart. This is the part
CLAUDE.md already correctly flags as "a real STRENGTH." The problems found
were narrower and more specific:

1. **5 of 22 macros had zero frontend reachability** (`listSimJobs` +
   the 4 inline structural/thermal/electrical/hydraulic combinators). These
   are not stubs — `server/lib/compute/engineering-compute.js` (511 lines)
   is real, cited engineering math: ACI-318 shear wall sizing, Euler
   buckling, AWS D1.1 weld strength, NEC voltage-drop/breaker/conduit-fill
   tables, sensible heat load + duct sizing + residential cooling load, and
   pipe sizing / pump BHP / Darcy-Weisbach pressure loss with a real
   Swamee-Jain friction factor. None of it had a door in.
2. **A misleading claim baked into the Analysis tab's own copy.** The
   pre-existing text read *"Models with ≤100 members run synchronously
   (<20ms). Larger models use async jobs with status polling."* No such
   async path exists for `engineering.runFEA` — it is always synchronous
   (`server/lib/simulation/fea-solver.js`'s own header: *"Frame analysis of
   200-member structure completes in <20ms"*). The frontend had dead
   machinery for it anyway: `page.tsx` held a `jobId` state, a `useQuery`
   polling `GET /api/simulation/:jobId` (a real, separate async job queue
   that DOES support an `fea-frame` job type — `server/routes/simulation.js`
   — but which `runFEA` never actually submits to), and a branch checking
   `d?.async && d?.jobId` that could never be true because
   `engineering.runFEA`'s handler never returns those fields. Not
   fabrication (nothing rendered a fake result), but a real UI claiming a
   capability that was never wired, plus genuinely dead polling code.
3. **`<ManifestActionBar />` was 100% broken for this lens.** Its manifest
   entry (`concord-frontend/lib/lenses/manifest.ts`, `domain: 'engineering'`)
   declared `actions: ['analyze', 'generate', 'validate', 'export',
   'summarize']`. None of those five strings matched any registered
   `LENS_ACTIONS` or `MACROS` entry, nor any of the domain's frontend
   aliases (`server.js:42055-42059` registers `fea`/`structural`/`thermal`/
   `electrical`/`hydraulic`, not the manifest's names). Every click hit the
   dispatcher's `unknown_macro` fail-fast path
   (`server.js:39573-39598` — this codebase's own fix for the historical
   "unregistered action silently answered by an LLM" defect class, so at
   least the failure was honest, never fabricated). Still: a rendered,
   seemingly-functional row of quick-action buttons where 100% of clicks
   error is a real defect, and (checked, out of this lens's scope to fix)
   the same broken-manifest-action pattern reproduces on at least the `eco`
   lens's `<ManifestActionBar/>` too — a systemic issue in
   `lib/lenses/manifest.ts` worth a dedicated cross-lens pass, not
   something this single-lens audit unilaterally rewrites project-wide.
4. **The `EngineeringActionPanel` "bench" strip had two raw JSON-paste
   textareas** ("Parts JSON", "BOM JSON") standing in for structured forms —
   the exact anti-pattern CLAUDE.md's zero-generic-tendencies invariant
   names by example. Both were also functionally redundant: `bom` (flat
   cost sum) is strictly superseded by `bomRollup` (same page's dedicated
   BOM tab: adds build-quantity scaling, overhead rate, supplier links, a
   per-supplier chart, and a numeric-lead-time critical path vs. `bom`'s
   text-sort heuristic) with zero unique capability of its own.
   `toleranceAnalysis` (per-part worst-case + RSS + a tolerance-class label
   `precision`/`standard`/`loose`) is NOT fully redundant with
   `toleranceChain` (directional stack-up + fit verdict, on the dedicated
   Tolerance tab) — the per-part tolerance-class classification is a
   genuine, distinct capability `toleranceChain`'s output doesn't carry —
   so it earned a real structured editor rather than being dropped.

## What changed

- **`concord-frontend/components/engineering/MultiDisciplineCalcPanel.tsx`
  (new, ~460 lines)** — a real MechaniCalc/Engineering-ToolBox-shaped
  calculator suite: four sections (Structural / Thermal / Electrical /
  Hydraulic), each with genuinely labeled, unit-correct input fields (not a
  generic key/value grid) matching `engineering-compute.js`'s real parameter
  names, one "Compute" action per section (matching the backend's actual
  one-macro-call-computes-everything design — three independently-clickable
  buttons pretending to be three separate server calls would have
  misrepresented what the macro does), and a shared `ResultCard` that
  surfaces the value + unit + the formula string the compute function
  itself returns + any code-reference warnings (e.g. "voltage drop exceeds
  5% (NEC recommendation)", "below AISC recommended FS of 1.67") — so the
  tool reads as a professional engineering calculator that shows its work,
  not a black box. Wired into a new **Calcs** tab in `page.tsx`.
- **`concord-frontend/components/engineering/SimHistoryPanel.tsx` (new)** —
  a "Simulation Studies" history list (Fusion 360 / SimScale shape) backing
  `engineering.listSimJobs`: every solved model already persisted a job
  (name, elapsed ms, pass/fail summary, timestamp) into the per-user store;
  nothing ever read it back. Mounted under the Results tab, refetches on
  every completed FEA run via a `historyKey` bump.
- **`concord-frontend/app/lenses/engineering/page.tsx`** — added the
  **Calcs** tab; mounted `SimHistoryPanel` in Results; removed the dead
  `jobId` / `useQuery(/api/simulation/:jobId)` / `d?.async && d?.jobId`
  polling machinery (the async path `runFEA` never actually uses); fixed
  the misleading "Larger models use async jobs with status polling" copy to
  state the true, verified behavior (synchronous direct-stiffness solve,
  <20ms even at 200 members — cited from the solver's own header comment).
  Removed now-unused `useQuery` / `api` imports.
- **`concord-frontend/lib/lenses/manifest.ts`** — `engineering`'s `actions`
  array changed from the five dead names to `actions: []` (an established
  pattern already used by `achievements`/`narrative-walk`/`ops-telemetry`),
  with an inline comment explaining why: every real macro this bar could
  plausibly trigger now has a genuine, structured, designed home
  (Geometry/Materials/Calcs/Results tabs), so an empty-param quick-trigger
  bar would only ever duplicate them with a worse surface — and for the
  four combinator macros specifically, a blind `{}` call would render a
  misleadingly-"ok" toast (the macro's own outer envelope is `{ok:true,
  results:{...}}` even when every sub-calculation inside `results` is a
  validation error, since `ManifestActionBar`'s generic
  `hasMeaningfulResult()` check only looks at the outer shape).
- **`concord-frontend/components/engineering/EngineeringActionPanel.tsx`**
  — replaced the "Parts JSON" raw-text textarea with a real structured
  row editor (add/remove part rows, name/nominal/±tolerance fields) driving
  `toleranceAnalysis`, matching the design language `TolerancePanel` and
  `BomPanel` already use elsewhere on the same page. Removed the "BOM JSON"
  textarea, the `bom` quick-action, and its result card entirely —
  documented in a header comment as a deliberate consolidation, not a
  silent drop (the underlying `bom` macro stays registered and behaviorally
  tested; see below). Updated the mint/DM/agent-review text builders to
  stop referencing the removed `bomResult` state.

## Deliberately left unsurfaced (honest disposition, not a silent gap)

- **`engineering.bom`** — real, tested, and still reachable via
  `POST /api/lens/run` / the `/api/v1/lens/engineering/bom` external-API
  surface, but has **no quick-action UI of its own by design**: `bomRollup`
  (this page's dedicated BOM tab, `BomPanel.tsx`) is a strict superset —
  everything `bom` computes, plus build-quantity scaling, overhead rate,
  supplier links, and a per-supplier chart — so a second, worse ("paste raw
  JSON") entry point for the exact same underlying need would be the
  generic-scaffold anti-pattern for zero added capability. Disposition:
  **superseded-by-a-better-designed-sibling-feature on this same page**, not
  fabricated, not hidden, and not deleted from the backend.
- **`boltedConnection` and `transformerSizing`** (in
  `server/lib/compute/engineering-compute.js`, exported from the module's
  default export, real AISC-shear / ANSI-kVA-ladder math) — these are NOT
  called by any of the 4 inline `structuralCheck`/`electricalCheck`/etc.
  combinator macros (grep confirms `structuralCheck` only calls
  `columnBuckling`/`reinforcedConcreteWall`/`weldStrength`;
  `electricalCheck` only calls `voltageDrop`/`breakerSizing`/`conduitFill`).
  Disposition: **genuinely unreachable at the macro layer, not just the
  frontend** — there is no `engineering.*` macro that invokes either
  function, so no frontend fix in this lens could surface them without
  first adding a backend macro (or extending an existing combinator's
  field set) to call them. Out of scope for a frontend-audit pass; flagged
  here so the gap has a name instead of silently existing.
- **`<ManifestActionBar/>`'s broken-manifest-action pattern on `eco`
  and potentially other lenses** — confirmed present on at least one
  sibling lens during this audit (`eco`'s `actions: ['map_dependencies',
  'flow_analysis', 'health_check', 'bottleneck_detect',
  'impact_simulation']` also match nothing in `LENS_ACTIONS`/`MACROS` for
  that domain). Fixed here for `engineering` only, per this task's scope;
  flagged as a likely cross-lens issue in `lib/lenses/manifest.ts` worth its
  own dedicated audit pass rather than an incidental fix inside a
  single-lens task.
- **A real, latent bug in the shared test harness discovered while adding
  tests** — `server/tests/depth/_harness.js`'s `after()` hook calls
  `process.exit(0)` unconditionally once a file's tests finish. Verified
  (by deliberately mutating a passing assertion to a wrong expected value in
  a throwaway copy of the test file and re-running it three different ways,
  including the project's own documented `--test-force-exit
  --test-timeout=60000` invocation) that this **forces exit code 0 and
  truncates the TAP reporter's output before it can print the failing
  subtest**, so `node --test` reports the whole file as "ok" / "fail 0" even
  when a real assertion inside it is failing. This is pre-existing shared
  infrastructure (unrelated to this pass's edits, used across many
  `tests/depth/*.test.js` files) — out of scope to fix inside a single-lens
  task, and touching a protected harness requires the explicit,
  bidirectional-fix-with-pinning-test process CLAUDE.md's anti-cheat section
  requires. Reported here so it's visible instead of silently trusted.

## Verification

- `cd concord-frontend && npx eslint app/lenses/engineering/page.tsx components/engineering/*.tsx lib/lenses/manifest.ts` — clean, exit 0, 0 warnings.
- `node scripts/lens-unsurfaced.mjs --lens engineering` — now `engineering: 0/18 macros never referenced in the frontend` (was `1/18`); confirmed by direct grep that the 4 inline macros (invisible to that script) also now have real call sites in `MultiDisciplineCalcPanel.tsx`.
- `cd server && node --test tests/engineering-domain-parity.test.js tests/engineering-lens-macros.test.js` — **53/53 passing, 0 fail** (both hermetic, local-dispatch files; unaffected by the harness bug above since they don't boot the real server).
- `cd server && node --test tests/depth/engineering-behavior.test.js` — added a new `describe("engineering — multi-discipline calc suite …")` block (5 new tests: exact-value structuralCheck, structuralCheck graceful-degrade on empty input, exact-value thermalAnalysis, exact-value electricalCheck, exact-value hydraulicAnalysis) following the file's existing "hand-verified-via-the-real-engine" style. Expected numeric values were generated by calling the real `engineering-compute.js` functions directly (`node -e "import('./server/lib/compute/engineering-compute.js').then(...)"`, per CLAUDE.md's "compute-don't-guess" method), not hand arithmetic. Because of the harness bug documented above, the file-level report says "ok" regardless; independently re-verified correctness with a standalone script (`runMacro('lens','run',{id,action:'structuralCheck',params:{}}, ctx)` against the live in-memory server, no test-runner involved) that printed the full result object and confirmed every asserted value matches to the same precision, and confirmed (by mutating one expected value to `999` in a throwaway copy and re-running) that the harness would NOT have caught the deliberate error — i.e., the new tests are logically correct even though the harness's own pass/fail signal for this file can't currently be trusted end-to-end.
- Manual type read-through in place of a full-project `tsc` (per this task's instructions, to avoid racing sibling agents in the same working tree): `MultiDisciplineCalcPanel.tsx`'s `NumField`/`SelectField` props are simple primitives (`number | ''`, `string`) with no generic inference risk; `EngineeringActionPanel.tsx`'s `setTolField(idx, f: keyof TolPartInput, v: string)` computed-property assignment (`{ ...next[idx], [f]: f === 'name' ? v : (parseFloat(v) || 0) }`) is the exact same pattern already used and already type-checking in this lens's own `TolerancePanel.tsx`/`BomPanel.tsx` (`setField` functions) — verified by reading those files, not assumed.
- Fabrication re-grep after the edit: `grep -n "Math.random\|MOCK\|mock\b\|fake\|Lorem\|lorem" concord-frontend/components/engineering/*.tsx concord-frontend/app/lenses/engineering/page.tsx` → no hits.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave run, per the task's instructions.
