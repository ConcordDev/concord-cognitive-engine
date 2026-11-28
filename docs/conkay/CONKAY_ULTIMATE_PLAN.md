# ConKay — the plan to its ultimate form

Owner, 2026-11-28: "Jarvis level in capability but with actual CERN level
physics that can really build and design things using real math, and the LLM
is just essentially the organizer … the greatest CAD designer ever, full
physics, a completely new and unique extension of Concord."

This document is the plan. It says where ConKay stands, what it is measured
against, what each phase builds, and how each phase is proven done. It is a
work order, not a claim: nothing here is shipped unless a phase's "done when"
is met and pinned by a test.

Companion documents: `docs/conkay/CONKAY_CAPABILITY_AUDIT_2026-11-27.md` (the
measured starting point), `docs/lens-specs/conkay-capability-map.md` (what
shipped, per pass, with its benchmarks).

---

## 1. The thesis

Every serious engineering tool does one or two steps of the work well. None
does the whole loop, and none can show where every number came from:

```
intent (plain words, any units)
  → design (parts, shapes, materials, loads)
  → every applicable check, by real solvers
  → sizing and shaping by the math
  → uncertainty on every number
  → a lab test plan
  → measured results calibrate the model
  → a proven design, forkable and sellable, with its proof attached
```

ConKay's claim to "greatest" is not that each solver beats the best
commercial solver. It is that **the whole loop is one system, the model only
organizes, and every number is traceable, uncertainty-quantified, and
eventually lab-calibrated.** Verification is the product.

### Rules every phase keeps

1. **The model organizes; the math decides.** Kay may choose what to build,
   what may change and sensible bounds. Every dimension, margin and
   probability comes from a solver run. Kay may only report what a tool returned.
2. **Honest by construction.** A check that cannot run says why (NOT_COMPUTED
   with a reason). No fallback constants, no invented material values, no
   probability rounded to zero.
3. **Every number has provenance.** Solver id and version, inputs, source of
   every constant (textbook section, standard clause, datasheet, measurement,
   "stated by the person"), and its uncertainty.
4. **Benchmarked before trusted.** A solver joins the build catalogue only
   with a pinned benchmark and a stated error band and regime.
5. **Game physics is never evidence.** Concordia can show a design; only
   engineering solvers can check it.

---

## 2. Where ConKay stands (2026-11-28)

Shipped and pinned by tests (details and benchmarks in the capability map):

- Build from a brief: Kay plans a design graph; every applicable solver checks it.
- Any units in, the person's units back.
- Shapes: primitives, extrusions with holes and fillets (exact section
  properties), revolves (Pappus, capacity), lofts (NACA sections).
  OpenCascade solids where installed, with a volume cross-check and STEP export.
- Physics in the build catalogue: frame FE (stress, deflection, linear
  buckling, thin-wall local buckling), pressure vessels, pipe flow, 1-D heat,
  DC electrical, Cantera chemistry, tipping stability, cooling of a filled
  vessel (natural convection and radiation), lifting-line aerodynamics.
- Editable 3D builds: pick a part, change it in any unit, every check re-runs,
  parts coloured by their worst check.
- Sizing by the math: the lightest design in given bounds (or stock sizes)
  on which every check passes, with the binding checks named.
- Uncertainty on every margin: seeded Monte Carlo over cited material scatter
  (JCSS PMC), load and size scatter; probability each check is not met with
  its interval; the input that moves it most; a second run with safety
  factors at 1.
- Kay as organizer of the open build: tools to edit, size and check
  uncertainty, owner-only.

Known gaps (from the audit): no modal analysis, no solid FE in the build path
(CalculiX driver exists, not provisioned), no general CFD (OpenFOAM lane is
vehicle-only), no fatigue on load histories, no sweeps/shells/booleans/threads,
no assembly constraint solve for builds, no DFM or tolerance stacks, no lab
loop; 27 engine CI workflows have no driver behind them.

---

## 3. What it is measured against

| Area | Reference leaders | The bar ConKay must reach | ConKay's intended edge |
|---|---|---|---|
| Parametric CAD | SolidWorks, Siemens NX, CATIA, Creo, Onshape | feature tree, constraint sketches, assemblies, drawings with GD&T, STEP/IGES round trip | geometry generated from intent and sized by the solvers, not drawn by hand |
| Structural FEA | Ansys Mechanical, Abaqus, Nastran | NAFEMS linear/nonlinear/contact/modal benchmarks within published tolerance | convergence-checked automatically on every result, uncertainty attached |
| Multiphysics | COMSOL, Ansys Workbench | coupled thermal-structural, fluid-structure, electro-thermal | coupling chosen by the design graph, not set up by an analyst |
| CFD | Ansys Fluent, STAR-CCM+, OpenFOAM | Ahmed body, NACA airfoils, pipe/duct benchmarks with GCI | any object, not just vehicles; uncertainty on drag/lift |
| Generative / topology | Fusion generative design, nTop, Altair OptiStruct | SIMP / level-set topology optimization reproducing published cantilever/MBB results | optimum sized to a reliability target, made manufacturable, with proof |
| Reliability / UQ | Ansys optiSLang, NESSUS, UQLab | FORM/SORM, importance and subset sampling matching published reliability benchmarks | on by default for every design, not a separate product |
| Code checks | Tekla, RISA, SkyCiv, PV Elite | AISC 360, Eurocode 3/5, ASME BPVC VIII clause checks matching worked examples | generated calc packs, every clause cited |
| Manufacturing | Fusion CAM, Mastercam, PrusaSlicer, DFMPro | DFM rules, toolpaths, slicing, cost | checked in the same loop as the physics |
| Test / digital twin | Siemens Simcenter Testlab, model updating tools | test planning, model updating from measurement | the calibration becomes a DTU others build on |

"Greatest" is defined, per row, as: **meets the bar on the published
benchmarks, and does the intended-edge column, which the reference leaders
do not.** A row is not claimed until both are true.

---

## 4. The phases

Order matters: phases A and B are what nobody else has and are cheap
relative to the rest; C–E are the long road.

### Phase A — Prove the solvers (foundation)

Build:
- A validation suite: every solver pinned to published benchmarks (NAFEMS
  LE/FV/NL series, textbook closed forms, published test data), each with its
  regime and error band. One file per solver family under
  `server/tests/conkay/validation/`, cases cited.
- Automatic solution verification: every FE/CFD result in a build runs a
  mesh study and reports a Grid Convergence Index, or says it did not.
- A side-by-side harness: the same models in ConKay and a reference result
  (published, or an operator-run commercial solve), the differences published.
- Retire or wire the 27 dead engine workflows: each gets its driver and test,
  or is deleted.
- A public "solver register" page: every solver, its benchmarks, its error
  band, its last validation run.

Done when: every solver in the build catalogue has at least one cited
benchmark passing within its stated band in CI, and no CI workflow points at a
missing file.

### Phase B — Reliability and the lab loop (the unique core)

Build:
- Reliability methods beyond Monte Carlo: FORM/SORM, importance sampling,
  subset simulation — so probabilities like 10⁻⁴ to 10⁻⁶ are reachable.
- Size to a reliability target: "lightest design with P(fail) ≤ 10⁻³ with
  safety factors at 1", replacing the fixed safety factor where the person
  asks for it (reliability-based design optimization).
- Correlated inputs and real distributions (lognormal, Weibull, Gumbel for
  extreme loads), with sources.
- Test plans generated from the model: what to load, where to gauge, the
  predicted reading and its band at each gauge, the pass criterion.
- Measurement ingest: a person uploads readings (CSV, gauge logs); ConKay
  runs Bayesian model updating — material and model-form parameters
  re-estimated with their uncertainty.
- The calibrated model is stored as a DTU ("validated by test N, residual R"),
  cited by every design that uses it.

Done when: the published reliability benchmarks (e.g. Rackwitz–Fiessler,
standard limit-state examples) match; a sized-to-target design's achieved
probability is verified by independent sampling; one real physical test
(a beam or bracket in a maker lab) has gone round the loop and its update is
reproducible from the stored data.

### Phase C — Full physics

Build, each joining the catalogue only through Phase A:
- Modal analysis (natural frequencies, mode shapes) in the frame solver, then
  on solids.
- Solid FE on the real B-rep solids: CalculiX (and code_aster) provisioned in
  the deploy image; linear, then contact and material nonlinearity.
- Fatigue: rainflow counting, S-N and ε-N curves with sources, Miner's rule,
  weld and notch detail categories.
- Transient thermal and thermal-structural coupling.
- General CFD: OpenFOAM for any object, with mesh studies and GCI.
- Electromagnetics (Elmer, Meep), multibody dynamics (Chrono), batteries
  (PyBaMM), circuits (ngspice), crash (OpenRadioss).
- Coupled multiphysics chosen by the design graph (heat → stress,
  flow → vibration).

Done when: each family passes its NAFEMS (or equivalent) benchmarks within
band, and a lamp, a cup, a bracket, a small UAV wing and a vehicle subframe
each get their deciding physics checked end to end.

### Phase D — The math shapes it

Build:
- Topology optimization (SIMP, then level-set) inside the design space the
  person or Kay defines, producing geometry that goes back through the full
  check loop.
- Multi-objective trade studies: mass, cost, carbon, stiffness,
  manufacturability — Pareto fronts with each point a checked design.
- Material selection from property charts (Ashby indices) with sourced data.
- Sizing beyond lengths: discrete choices (material shortlist, bolt sizes,
  layout options).

Done when: the published topology benchmarks (MBB beam, cantilever) are
reproduced; a generated part passes every check and its reliability target
after being made manufacturable.

### Phase E — A full geometry kernel

Build:
- Constraint sketches and a parametric feature tree, editable in the Workshop.
- Sweeps, shells, booleans, fillets and chamfers on edges, threads, patterns.
- Assemblies with mates solved for builds (reusing `assembly-mates.js`),
  interference and clearance checks.
- Drawings with dimensions and GD&T; STEP/IGES import of a person's own parts
  into a build.

Done when: a defined set of reference parts (bracket, flanged housing,
threaded fitting, lofted blade) can be built, edited and round-tripped
through STEP into commercial CAD with matching volume and mass properties.

### Phase F — Making it real

Build:
- Design-for-manufacture checks per process (machining reach, draft angles,
  minimum walls for molding, overhangs for printing).
- Tolerance stack-ups (worst case and statistical) on assemblies.
- Toolpaths (CAM) and print slicing (CuraEngine/PrusaSlicer drivers).
- Bill of materials with real stock sizes and supplier prices, and cost.

Done when: a design goes from brief to a part that is actually made, and its
measured dimensions and mass match the model within its stated tolerances.

### Phase G — Proof as the product

Build:
- Calculation packs generated against codes: AISC 360, Eurocode 3 and 5,
  ASME BPVC VIII, and aircraft/vehicle rules where they apply — every clause
  cited, every number traceable to a solver run.
- A provenance ledger on every result: solver id and version, inputs, sources,
  uncertainty, convergence evidence, validation status.
- An independent re-run: anyone with the DTU can reproduce every number.

Done when: generated packs reproduce published worked examples from the
codes, and a licensed engineer can review a pack without asking where a
number came from.

### Phase H — What only Concord can do

Build:
- Every design, material dataset, calibrated model, test record and solver
  run is a DTU with lineage.
- Fork a tested design; the ancestors earn royalties through the existing
  cascade when the fork sells. The proof travels with it.
- A marketplace of verified designs and tested materials: what sells is the
  evidence, not just the file.
- Live multiplayer design on the Yjs layer, with checks re-running for everyone.
- Other agents design through ConKay over MCP, held to the same rules.
- Concordia shows builds in the world, labelled as a view, never as evidence.

Done when: a design forked twice has its royalties paid to both ancestors on
a sale, and its proof (checks, uncertainty, test calibration) is visible on
the listing.

---

## 5. How progress is reported

- Per phase: the "done when" above, each line pinned by a named test.
- A solver register (Phase A) is the single place to see what is trusted and
  how well.
- The comparison table in §3 is updated only when a row's bar and edge are
  both met, with the benchmark run that proves it.
- Every pass appends to `docs/lens-specs/conkay-capability-map.md` with its
  benchmarks, as now.

## 6. Risks, stated

- **Solver depth.** Open engines are younger than commercial ones. Mitigation:
  Phase A benchmarks and published side-by-side comparisons; never claim
  parity a benchmark has not shown.
- **Compute.** Solid FE, CFD and reliability sampling are expensive.
  Mitigation: job queue, GPU where engines support it, surrogate models only
  with their own stated error, and FORM/importance sampling instead of brute
  Monte Carlo.
- **Liability.** Generated designs could be used unchecked. Mitigation: every
  report states its regime, gaps and uncertainty; code packs are for review by
  a licensed engineer, and say so.
- **Data.** Material scatter and fatigue data need real sources. Mitigation:
  cite published data (JCSS, MMPDS, handbooks); where none is known, the
  property is held and the gap is said; the lab loop grows the dataset.
- **Scope.** This is years of work. Mitigation: the phase order, one
  validated piece at a time, each one useful on its own.
