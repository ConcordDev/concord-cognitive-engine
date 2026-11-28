# ConKay 10-layer re-audit — 2026-11

**Ticket:** CK-AUD-01 (parent MST-W3-16, ConKay M0) · **Seat:** B3
**Branch / base:** v1/conkay @ main `8d54173acbe7b3460bc88f7263338df3b6948c2f`
(the live backend of record at claim time, 2026-11-27)
**Baseline:** `CONKAY-GAP-AUDIT-2026-10-06.md` (Grok Bot, read-only,
2026-10-06) against the Full North Star (`CONKAY-FULL-NORTHSTAR-2026-10-06.md`)
**Roadmap:** this audit is the measured starting point for Phase A ("Prove the
solvers") of the ConKay Ultimate Plan (CB-1443 / CB-1447 mapping).
**Method:** for each of the baseline's 10 layers — re-census the branch-base
test corpus, run the mapped suites locally, issue a measured verdict. Every
layer row cites ≥1 test file plus its run result; a verdict is reproducible
from the cited tests. CI evidence for the locally-blocked suites is named as
CI's, never presented as a local run.
**Honesty rule (the baseline's own):** never invent liveness; Play ≈ I-beam /
linear-static beam-frame unless a measured run says more.

## The runs, in totals

Corpus at base: `server/tests` holds **3,641** `*.test.js` files; the
premise-method name census (conkay|physics|engineering) counts **160**; the
widened layer-map candidate set counts **241**. A curated **93-file** layer
map was run per-file in the repo's own harness form (`NODE_ENV=test node
--test --import=./tests/preload/no-egress.mjs`, from `server/`), 120 s cap
per file:

| Class | Files | Meaning |
|---|---|---|
| PASS | 59 | exit 0, **770 tests passed, 0 failed** |
| ENV-IMPORT | 29 | `ERR_MODULE_NOT_FOUND` — the worktree has no `server/node_modules`; these suites boot the server app (express, express-rate-limit, …). Uniform cause, spot-verified per file family. Their evidence rests on GitHub CI, where the same suites run under `test:ci`. |
| FAIL | 2 | real test failures at this base — named in Findings |
| ENV-OCC | 1 | the OCC leg fails on this machine's OCP build (below) |
| LONG | 2 | suites that exceed the per-file cap; green through every test observed, completion not observed locally (service restarts); remainder rests on CI |

Two baseline NOW-slices have landed on main since 2026-10-06 and are verified
at this base: the frozen beam V&V corpus (`server/tests/vv/beam-corpus.json`)
and `analysisReceipt` in `server/lib/conkay/beam-study.js`.

The #2356 audit sweep (deployed 2026-11-15) and Gate 2 (PR #2396, 2026-11-19)
are inside this base. The SC-foundations work (SC-00/SC-04/SC-05) sits on side
branches (v1/sc-foundations, sx/core-loop), is **not** in this base, and moves
no verdict here.

## Summary

| # | Layer | 2026-10-06 | 2026-11-27 (measured) |
|---|---|---|---|
| 1 | General geometry | PARTIAL | **PARTIAL** — design-graph/drawing suites much broader and green; the OCC live path is not proven in this environment (OCP version mismatch) |
| 2 | Real meshing | PARTIAL | **PARTIAL** — CFD mesh convergence (GCI) now pinned; FE meshing still 1D subdivision |
| 3 | Full structural physics | PARTIAL | **PARTIAL** — largest growth: linear buckling landed, dynamics/stability/solid-stress + CFD/EM/thermal catalogue green; modal, nonlinear, contact still absent |
| 4 | Materials | PARTIAL | **PARTIAL** — micromechanics / multiphase / viscoelastic breadth green; no unified stress–strain or fatigue acceptance yet |
| 5 | Real boundary conditions | PARTIAL | **PARTIAL** — cleanest layer: all six mapped suites green; springs / prescribed displacement / contact still unevidenced |
| 6 | Engineering failure criteria | PARTIAL | **PARTIAL, one named red** — the chat tool's safety-verdict path fails its own suite (26/27) |
| 7 | Verification & validation | PARTIAL | **PARTIAL** — headline delta: the frozen beam corpus landed and passes 14/14 |
| 8 | Engineering workflow | PARTIAL | **PARTIAL** — macros / iterate loop / workspace spec green; workbench + persistence suites rest on CI locally |
| 9 | AI as interface | PARTIAL | **PARTIAL, one named red** — the chat beam-sizing tool fails 4 of its 8 sizing assertions |
| 10 | Certification-grade discipline | STUB / early PARTIAL | **PARTIAL** — the one upgrade: `analysisReceipt` landed; five provenance/envelope/safety suites green |

No layer reaches LIVE beyond the baseline's own narrow sense (Play ≈ I-beam /
beam-frame), and none is claimed to. Nine labels hold at PARTIAL with
materially stronger evidence; layer 10 moves off STUB.

## Layer 1 — General geometry · PARTIAL (was PARTIAL)

Baseline: OCC kitchen LIVE path (fillet/chamfer/loft/revolve proofs); analytical
kitchen-sink fallback; STEP export/import; assemblies + mates exist; no real
sketch solver, no IGES.

Measured at base: `conkay-design-graph` **66/66 PASS** · `conkay-ga-drawing`
**10/10 PASS** · `conkay-cad-body` LONG (green through every test observed at
the cap; the suite is a long car-packaging layout-derivation set) ·
`conkay-show-solid` 4 PASS + the OpenCascade exact test **fails in this
environment**: the OCP build here lacks `TopoDS.Wire_s` (API-version mismatch)
— the OCC live path is therefore **not proven here**, and this audit does not
claim it · `conkay-occ-path-confinement`, `conkay-assembly-mates-v2`,
`conkay-assembly-drawing`, `conkay-present-glb` ENV-IMPORT (CI carries them).

Verdict: the intent→design-graph→drawing surface is broader and fully green
where it runs locally. The baseline's central gap stands: arbitrary parametric
product geometry still rides on the OCC path, whose liveness is an environment
question this run could not settle. PARTIAL.

## Layer 2 — Real meshing · PARTIAL (was PARTIAL)

Baseline: `engineering.meshGenerate` = 1D beam subdivision only; no shell/solid
FE mesh; FEA gate labels element family honestly.

Measured: `fea-gate` **21/21 PASS** (the element-family honesty gate holds) ·
`engineering-fea-scene` **6/6 PASS** · `conkay-cfd-gci` **13/13 PASS** and
`conkay-cfd-des` **14/14 PASS** — mesh-convergence (Grid Convergence Index)
evidence exists and is pinned **for CFD** · `parametric-mesh`,
`parametric-mesh-archetypes`, `depth/mesh-behavior` ENV-IMPORT.

Verdict: meshing is no longer only a beam subdivision story — parametric mesh
archetypes exist and CFD carries real convergence discipline, which is exactly
Phase A machinery. Structural FE meshing (shell/solid) is still absent. PARTIAL.

## Layer 3 — Full structural physics · PARTIAL (was PARTIAL) — largest growth

Baseline: linear-static 3D Euler–Bernoulli beam-frame LIVE with analytical V&V;
buckling / modal / dynamic / nonlinear MISSING.

Measured, all PASS locally: `conkay-frame-fe` **23/23** · `fea-frame-element`
**6/6** (closed-form PL/AE, PL³/3EI, ML/EI, inclined member, portal symmetry,
instability reported not zeroed) · `fea-reactions` **4/4** ·
`engineering-column-buckling-check` **5/5** — the baseline's "next measured
slice" Euler column check has landed, and frame FE carries linear buckling
(Ultimate Plan §2) · `conkay-dynamics-forward` 5/5 · `conkay-dynamics-inverse`
9/9 · `conkay-dynamics-full-body-rnea` 10/10 · `conkay-stability-dynamic`
12/12 · `conkay-solid-stress` **5/5** · `physics-energy-accounting` 3/3 (the
energy ledger's current three channels; the full ledger is CK-CR-01's build) ·
`conkay-aero-cfd` 12/12 · `conkay-cfd-des` 14/14 · `conkay-em-fdtd` 5/5 ·
`conkay-em-magnetostatic` 5/5 · `conkay-heat-transfer` 15/15 ·
`conkay-thermal` 10/10 · `conkay-pipe-flow` 13/13 · `multi-physics-bundle`
20/20. `e2e/design-simulate-fea-loop` ENV-IMPORT (the end-to-end loop rests on
CI locally).

Verdict: the solver catalogue behind this layer is far wider than the
baseline's beam-frame picture — buckling exists, dynamics and stability are
pinned, and CFD/EM/thermal families are green. Still absent, as the Ultimate
Plan's own gap list states: modal analysis, solid FE in the build path,
nonlinear/contact. PARTIAL.

## Layer 4 — Materials · PARTIAL (was PARTIAL)

Baseline: ~12 engineering materials with E/ν/ρ/yield/CTE; `conkay/material-library.js`
+ a stress solver with Basquin/Miner fatigue pieces not wired as FEA acceptance;
no stress–strain curves.

Measured PASS: `material-availability` **33/33** · `materials-periodic-table`
21/21 · `conkay-micromechanics` 16/16 · `conkay-multiphase-elasticity` 18/18 ·
`conkay-material-ir` 13/13 · `conkay-viscoelastic` 11/11 ·
`conkay-constituent-properties` 10/10 · `materials-stress` 7/7.
ENV-IMPORT: `material-profiles`, `materials-corrosion-6061`,
`materials-select-honesty`, `depth/materials-behavior`,
`depth/materials-fractography-behavior`.

Verdict: breadth is real — composites, multiphase and viscoelastic behaviour
are pinned, not just a 12-row table. The baseline's structural gap stands: no
unified stress–strain-curve or fatigue acceptance wired into the FE path.
PARTIAL.

## Layer 5 — Real boundary conditions · PARTIAL (was PARTIAL) — cleanest layer

Baseline: per-DOF fixity, UDL lumping, gravity/thermal as loads; springs,
prescribed displacement, pressure, contact MISSING.

Measured: **all six mapped suites PASS** — `conkay-pressure-vessel` 12/12
(pressure loading is real) · `conkay-joint-stiffness` 11/11 ·
`conkay-stability-pressure-distribution` 10/10 · `conkay-joint-bolt-screening`
9/9 · `conkay-actuation-joint-torque` 9/9 · `conkay-hardpoints` 1/1.

Verdict: joints, pressure and actuation loads are pinned behaviour, beyond the
baseline's fixity-mask picture. Springs, prescribed displacement and contact
remain unevidenced in the corpus. PARTIAL.

## Layer 6 — Engineering failure criteria · PARTIAL, one named red (was PARTIAL)

Baseline: |σ_axial| + σ_bend vs allowable with FoS/utilisation; no continuum
von Mises/Tresca, no AISC/bolt/weld code checks.

Measured PASS: `fea-gate-archetypes` 21/21 · `conkay-fea-bone-stance-stress`
13/13 · `conkay-long-term-limit-states` 9/9 · `beam-study` 8/8 ·
`fea-stress-section-consistency` 4/4 (true-c on sections is CK-CR-02's pin).
**Named red:** `conkay-safety-factor-and-tool` **26/27** — the test
"executeToolCall runs the solver and returns the safety verdict" fails at this
base (assertion at test line 98: expected true, got false). The sibling test —
`conkay_design.solve` is registered and returns the same check — **passes**:
the solver returns the verdict; the chat tool-call path does not surface it.
That is a measured defect on main, recorded in Findings.

Verdict: criteria breadth grew (limit states, archetype gates, section
consistency). Code-clause checks (AISC/Eurocode/ASME packs) remain Phase G of
the Ultimate Plan, not present capability. PARTIAL.

## Layer 7 — Verification & validation · PARTIAL (was PARTIAL) — headline delta

Baseline: beam V&V strong (closed-form frame/reactions/beam-study suites); the
frozen beam corpus was a to-do (NOW-slice #2); no commercial/reference corpus.

Measured: **`vv/beam-corpus` 14/14 PASS** — the frozen corpus
(`server/tests/vv/beam-corpus.json`) has landed on main and passes at this
base · `conkay-verdict-bridge` 12/12 · `conkay-basis-discriminator` 9/9 ·
`beam-study` 8/8 · `fea-frame-element` 6/6 · `fea-reactions` 4/4.
ENV-IMPORT: `depth/engineering-beam-study-behavior`,
`depth/engineering-behavior`, `conkay-verdict-event-shape` (5 tests green
before its import-blocked leg), `solver-input-integrity`.

Verdict: the V&V centre of gravity moved from ad-hoc closed-form suites to a
frozen, cited corpus — the seed of Phase A's `server/tests/conkay/validation/`
layout (which does not yet exist; CB-1447). A commercial/reference side-by-side
corpus is still absent. PARTIAL.

## Layer 8 — Engineering workflow · PARTIAL (was PARTIAL)

Baseline: #1014 workspace (Project → I-beam study → solve → DTU) LIVE; full
CAD→mesh→solver→report→Collab chain not landed.

Measured PASS: `engineering-lens-macros` 35/35 · `conkay-iterate-loop` 17/17 ·
`conkay-build` 5/5 · `conkay-workspace-spec` 4/4 ·
`engineering-bom-model-rollup` 3/3. ENV-IMPORT:
`depth/engineering-workspace-persist`, `depth/engineering-model-persist`,
`conkay-workbench`, `conkay-workbench-continuation`, `conkay-erp-bom`,
`conkay-k1-dtu-create-stage-beats`.

Verdict: the study→solve→iterate loop is pinned; the workbench/persistence
legs rest on CI in this environment. The full-chain gap (CAD and mesh ends,
report generation, Collab) stands as the baseline stated it. PARTIAL.

## Layer 9 — AI as interface · PARTIAL, one named red (was PARTIAL)

Baseline: deterministic NLP→intent→FEA/mesh + agent/chat surfaces LIVE; no
multi-candidate optimise→rank loop.

Measured PASS: `conkay-chat-brief-parser` 35/35 · `conkay-knowledge-layer`
31/31 · `conkay-chat-orchestrator` 8/8 · `conkay-brain-route` 5/5 ·
`conkay-chat-what-if` LONG (green through every test observed at the cap).
ENV-IMPORT: `conkay-nlp-design-intent`, `conkay-new-design-routing`,
`mcp-chat-bridge-conkay-ir`.
**Named red:** `chat-tools-beam-sizing` **4/8** — all four sizing assertions
fail at this base: A36 sized to 125 mm with deflection governing; 6061-T6 to
160 mm; the no-width fall-through to the legacy solver; and the missing-inputs
ask (live harness case `edge.missing-inputs`). The chat sizing tool's answers
diverge from the suite's expected sizing. Recorded in Findings. (The
layer-6 red is this layer's sibling symptom: the registered solver path
passes, the chat tool path fails — the interface, not the math.)

Verdict: the organiser surface is broad and mostly green; the two reds are
both on the chat-tool path and both measured. The optimise→rank loop remains
Phase D, not present capability. PARTIAL.

## Layer 10 — Certification-grade discipline · PARTIAL (was STUB / early PARTIAL)

Baseline: DTU keep + artifact provenance UI; `analysisReceipt` a to-do
(NOW-slice #3); no immutable snapshots, solver-version pin, unit ledger, or
audit trail.

Measured: `analysisReceipt` **exists at this base** in
`server/lib/conkay/beam-study.js` (with registry and structural-members
references) — NOW-slice #3 landed · `conkay-safety-case` 21/21 ·
`provenance-guard` 13/13 · `envelope-artifact` 13/13 ·
`platform-provider-dtu-provenance` 9/9 · `conkay-envelope-refusal` 8/8.
ENV-IMPORT: `dtu-provenance-onwrite`, `e2e/dtu-creation-provenance-loop`,
`conkay-k1-stage-beats`.

Verdict: the receipt machinery the baseline asked for now exists and its
surrounding provenance/envelope suites are green — enough to move the layer
off STUB. Still short of certification-grade: no immutable analysis
snapshots, no sign-off workflow, and the receipt's solver-id hardening is
PR #2386, in Phase A review, not in this base. PARTIAL.

## Findings (measured defects at this base)

1. **Chat tool safety-verdict path red.** `conkay-safety-factor-and-tool`
   26/27: `executeToolCall` does not return the safety verdict the registered
   `conkay_design.solve` action returns. (Layers 6/9.)
2. **Chat beam-sizing answers diverge.** `chat-tools-beam-sizing` 4/8: both
   material sizing cases, the legacy fall-through, and the missing-inputs ask
   fail their assertions. (Layer 9.)
3. **OCC exact path unproven in this environment.** `conkay-show-solid`'s
   OpenCascade test fails against this machine's OCP build
   (`TopoDS.Wire_s` missing — API version mismatch). Environment-scoped, not
   a JS defect; the OCC liveness question stays open until run against the
   pinned kitchen venv. (Layer 1.)
4. **Phase A done-conditions unmet** (CB-1447): `server/tests/conkay/`
   validation layout unbuilt; 27 `conkay-engine-*.yml` workflows reference
   102 paths that do not exist (all dispatch-only). The M0 runway + the
   workflow retire/wire item are the closing path.

## Reproduction

```
git worktree add -b v1/conkay <dir> 8d54173acbe7b3460bc88f7263338df3b6948c2f
cd <dir>/server
NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs <file>
```

Per-file results (exit code, pass/fail counts, class) are tabulated from the
run logs of 2026-11-27; the 93-file map is the curated layer map in this
audit's working record. Suites marked ENV-IMPORT require
`server/node_modules` (absent in the audit worktree by design — no installs
during the rerun freeze); their standing evidence is GitHub CI
(`test:ci` / `test:depth:ci` in `server/package.json`). Verdicts in this
document rest only on runs and reads performed at the base above.
