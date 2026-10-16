# Universal Silver: registry gap report (phase 1)

Generated 2026-10-15T11:20:30.483Z at `7b451e230` by `server/scripts/silver-registry-report.mjs`, from the live maps of an in-process server boot. Contract 0.1.0. Read-only: nothing was run or promoted.

## Registry keys vs distinct engines

The live LENS_ACTIONS + MACROS maps hold **34007** keys. 18532 are sub-lens delegates (`lib/sub-lens-handlers.js`: `code.rust.git-commit` forwards to `code.git-commit`), folded into their parent. 3513 more are one shared handler mounted on many domains (save, share, star, ...), folded into one entry each. That leaves **11962** distinct macro entries. (CLAUDE.md's ~10,600 counts literal `register` calls in source; the live maps also hold loop-registered and generated actions.)

## Totals

| | count |
|---|---:|
| registry entries | 12046 |
| domains | 598 |
| conkay-solver | 57 |
| macro | 11962 |
| runtime-capability | 27 |
| fully declared (every contract field `declared`) | 0 |
| validation: uncertified / benchmarked / accepted | 12046 / 0 / 0 |

Every entry is `uncertified` in v0 by construction: `benchmarked` needs a cited benchmark passing within tolerance, which the registry cannot see. Evidence (tests that exist, oracle cases) is listed, never counted as certification.

## Contract coverage by source

Per field, the share of entries in each state. `runtime` = reported per run only (ConKay receipts); `hint` = an informal doc-comment hint; `inferred` = derived by a heuristic here, not stated by the owner.

### conkay-solver (57)

| field | declared | runtime | hint | inferred | missing |
|---|---:|---:|---:|---:|---:|
| id + version | 57 (100.0 %) |  |  |  |  |
| domain | 57 (100.0 %) |  |  |  |  |
| fidelity | 57 (100.0 %) |  |  |  |  |
| inputs |  | 57 (100.0 %) |  |  |  |
| outputs |  | 57 (100.0 %) |  |  |  |
| units | 17 (29.8 %) |  |  |  | 40 (70.2 %) |
| frame |  |  |  |  | 57 (100.0 %) |
| assumptions |  | 57 (100.0 %) |  |  |  |
| limits | 18 (31.6 %) |  |  |  | 39 (68.4 %) |
| method + reference | 57 (100.0 %) |  |  |  |  |
| provenance | 57 (100.0 %) |  |  |  |  |
| risk + authorization |  |  |  | 57 (100.0 %) |  |

### macro (11962)

| field | declared | runtime | hint | inferred | missing |
|---|---:|---:|---:|---:|---:|
| id + version | 59 (0.5 %) |  |  | 11903 (99.5 %) |  |
| domain | 11962 (100.0 %) |  |  |  |  |
| fidelity |  |  |  |  | 11962 (100.0 %) |
| inputs |  |  | 169 (1.4 %) |  | 11793 (98.6 %) |
| outputs |  |  |  |  | 11962 (100.0 %) |
| units |  |  |  |  | 11962 (100.0 %) |
| frame |  |  |  |  | 11962 (100.0 %) |
| assumptions |  |  |  |  | 11962 (100.0 %) |
| limits |  |  |  |  | 11962 (100.0 %) |
| method + reference | 59 (0.5 %) |  |  |  | 11903 (99.5 %) |
| provenance |  |  |  |  | 11962 (100.0 %) |
| risk + authorization | 59 (0.5 %) |  |  | 11903 (99.5 %) |  |

### runtime-capability (27)

| field | declared | runtime | hint | inferred | missing |
|---|---:|---:|---:|---:|---:|
| id + version | 27 (100.0 %) |  |  |  |  |
| domain | 27 (100.0 %) |  |  |  |  |
| fidelity |  |  |  |  | 27 (100.0 %) |
| inputs | 4 (14.8 %) |  |  |  | 23 (85.2 %) |
| outputs | 4 (14.8 %) |  |  |  | 23 (85.2 %) |
| units |  |  |  |  | 27 (100.0 %) |
| frame |  |  |  |  | 27 (100.0 %) |
| assumptions |  |  |  |  | 27 (100.0 %) |
| limits |  |  |  |  | 27 (100.0 %) |
| method + reference | 27 (100.0 %) |  |  |  |  |
| provenance |  |  |  |  | 27 (100.0 %) |
| risk + authorization | 27 (100.0 %) |  |  |  |  |

## Macros

| | count |
|---|---:|
| classifier class A | 1514 |
| classifier class B | 10078 |
| classifier class C | 320 |
| classifier class D | 25 |
| classifier class E | 25 |
| with a behavioural test (macro-depth honest) | 5618 |
| invoked by a substrate oracle case | 10 |
| with an input hint | 169 |
| registered in both LENS_ACTIONS and MACROS | 374 |

Classes (runtime/macro-capability-classifier.js, name heuristics): A deterministic calculator or read-only, B structured mutation, C external I/O or LLM, D stateful-domain mutation, E destructive or skipped domain.

## Promotion candidates (where phase 4 starts)

1188 macros have a behavioural test or an oracle case and are either named like a deterministic calculator by the classifier (96) or parsed as pure compute by the macro-depth grader: no state, I/O, emits or writes in the handler (1092). 2525 macros are pure compute in total, tested or not. A candidate is not a promotion: each still needs units, limits, a cited benchmark within tolerance and invalid-input tests. The classifier works from names only, so it undercounts calculators with camelCase names; the pure-compute signal is read from the code.

**Measured precision of the pure-compute signal:** 12 of 19 sampled candidates (63.2 %) are real deterministic computations when their handlers are read (1 could not be located). Sample and per-item reasons: `server/lib/silver/precision-sample.json` (2026-10-15). The misses are writes the grader's state check does not see (`ctx.db`, module-level stores), an external fetch it missed, catalogues and status summaries. So read the 1092 as roughly 690 real computations, most of them business or analysis calculations rather than physics. Phase 4 reads every handler before promoting it.

| domain | candidates |
|---|---:|
| plumbing | 37 |
| chem | 21 |
| bio | 20 |
| telecommunications | 18 |
| accounting | 17 |
| engineering | 17 |
| government | 15 |
| society | 15 |
| agriculture | 14 |
| commonsense | 13 |
| hypothesis | 13 |
| intel | 13 |
| atlas | 12 |
| aviation | 12 |
| legal | 12 |
| math | 12 |
| neuro | 12 |
| physics | 12 |
| astronomy | 10 |
| food | 10 |
| mesh | 10 |
| quantum | 10 |
| realestate | 10 |
| sim | 10 |
| code | 9 |
| experience | 9 |
| fitness | 9 |
| inheritance | 9 |
| integrations | 9 |
| sports | 9 |
| (212 more domains) | |

Oracle-invoked macros (each already has an exact-value check through the real dispatch):

- `accounting.budgetVariance`: accounting-budget-variance
- `accounting.trialBalance`: accounting-trial-balance
- `chem.balanceReaction`: chem-balance-reaction
- `chem.calc-molarity`: chem-molarity
- `engineering.circuitSolve`: engineering-circuit-solve
- `engineering.runFEA`: engineering-runFEA
- `math.symbolicCompute`: math-cas-simplify, math-cas-derivative, math-cas-definite-integral
- `math.unitConvert`: math-unit-convert
- `physics.kinematics-1d`: physics-kinematics-1d
- `physics.projectile`: physics-projectile

## ConKay solvers

57 registered; 3 name a test file in their reference that exists. Missing fields per solver:

| solver | fidelity | missing | referenced tests |
|---|---:|---|---|
| `drawing.ga` 1.0.0 | L1 | units, frame, limits | none |
| `mass.part` 1.3.0 | L1 | units, frame, limits | none |
| `mass.assembly` 1.1.0 | L0 | units, frame, limits | none |
| `cost.part` 1.1.0 | L0 | units, frame, limits | none |
| `cost.assembly` 1.0.0 | L0 | units, frame, limits | none |
| `joint.bolt-shear` 1.0.0 | L1 | units, frame, limits | none |
| `joint.bolt-bearing` 1.0.0 | L1 | units, frame, limits | none |
| `joint.bolt-tearout` 1.0.0 | L1 | units, frame, limits | none |
| `joint.bolt-tension` 1.0.0 | L1 | units, frame, limits | none |
| `joint.bolt-combined` 1.0.0 | L1 | units, frame, limits | none |
| `joint.gross-section` 1.0.0 | L1 | units, frame, limits | none |
| `joint.net-section` 1.0.0 | L1 | units, frame, limits | none |
| `joint.block-shear` 1.0.0 | L1 | units, frame, limits | none |
| `joint.bolt-group-distribution` 1.0.0 | L1 | units, frame, limits | none |
| `joint.slip-critical` 1.0.0 | L1 | units, frame, limits | none |
| `joint.prying-action` 1.0.0 | L1 | units, frame, limits | none |
| `joint.governing-check` 1.0.0 | L0 | units, frame, limits | none |
| `requirement.check` 1.0.0 | L0 | units, frame, limits | none |
| `beam.fea` 1.0.0 | L2 | units, frame, limits | none |
| `beam.euler-buckling` 1.0.0 | L1 | units, frame, limits | none |
| `vehicle.chassis-screen` 1.0.0 | L2 | units, frame, limits | none |
| `structure.frame` 1.0.0 | L2 | frame | tests/conkay-frame-fe.test.js |
| `structure.crush-paths` 1.0.0 | L1 | frame | none |
| `structure.hardpoints` 1.0.0 | L1 | frame | none |
| `thermal.brake-stop` 1.0.0 | L2 | frame | tests/conkay-heat-transfer.test.js |
| `fluid.coolant-loop` 1.0.0 | L1 | frame | tests/conkay-pipe-flow.test.js |
| `fluid.cooling-opening` 1.0.0 | L1 | frame | none |
| `vehicle.top-speed` 1.4.0 | L1 | units, frame, limits | none |
| `vehicle.required-power` 1.1.0 | L1 | units, frame, limits | none |
| `mass.cg` 1.1.0 | L1 | units, frame, limits | none |
| `vehicle.axle-loads` 1.0.0 | L0 | units, frame, limits | none |
| `mass.budget` 1.1.0 | L1 | frame | none |
| `geometry.clearance` 1.0.0 | L0 | frame | none |
| `stability.static` 1.1.0 | L0 | frame | none |
| `structural.tube-bending` 1.1.0 | L1 | frame | none |
| `actuation.static-torque` 1.0.0 | L0 | frame | none |
| `electrical.budget` 1.0.0 | L0 | frame | none |
| `energy.solar-yield` 1.0.0 | L0 | frame | none |
| `conservation.energy` 1.0.0 | L0 | frame | none |
| `vehicle.gearing` 1.1.0 | L0 | units, frame, limits | none |
| `tire.speed-rating` 2.1.0 | L0 | units, frame, limits | none |
| `tire.load-index` 1.0.0 | L0 | units, frame, limits | none |
| `package.seat-count` 1.0.0 | L0 | units, frame, limits | none |
| `cad.body` 1.2.0 | L2 | units, frame, limits | none |
| `cad.design-surface` 1.0.0 | L1 | units, frame, limits | none |
| `package.tub-fit` 1.1.0 | L2 | units, frame, limits | none |
| `aero.drag-buildup` 1.1.0 | L1 | units, frame | none |
| `aero.shape` 1.0.0 | L1 | units, frame, limits | none |
| `assembly.vehicle` 1.0.0 | L1 | units, frame, limits | none |
| `drawing.ga-assembly` 1.0.0 | L0 | frame | none |
| `package.occupant-fit` 1.1.0 | L1 | units, frame, limits | none |
| `package.interference` 1.1.0 | L1 | units, frame, limits | none |
| `mass.breakdown` 1.0.0 | L0 | units, frame, limits | none |
| `vehicle.acceptance` 1.4.0 | L0 | units, frame, limits | none |
| `safety.single-failure` 1.0.0 | L1 | frame | none |
| `safety.cross-function` 1.0.0 | L1 | frame | none |
| `bracket.plate` 1.0.0 | L2 | units, frame, limits | none |

## Runtime capabilities outside the macro maps

27 capabilities have no LENS_ACTIONS / MACROS entry: 23 implemented as mcp, 4 implemented as mcp_builtin. 0 declare a macro implementation that is not registered (orphans).

- `browser.check_coins` (owner browser_organ, mcp tool `browser_check_coins`)
- `browser.check_rate_limits` (owner browser_organ, mcp tool `browser_check_rate_limits`)
- `browser.check_incidents` (owner browser_organ, mcp tool `browser_check_incidents`)
- `trace.lookup` (owner trace_fabric_organ, mcp tool `trace_lookup`)
- `trace.recent` (owner trace_fabric_organ, mcp tool `trace_recent`)
- `trace.tool_history` (owner trace_fabric_organ, mcp tool `trace_tool_history`)
- `trace.root_cause` (owner trace_fabric_organ, mcp tool `trace_root_cause`)
- `trace.record` (owner trace_fabric_organ, mcp tool `trace_record`)
- `trace.backfill` (owner trace_fabric_organ, mcp tool `trace_backfill`)
- `run.lens_action` (owner mcp_execution_bridge, mcp_builtin tool `run_lens_action`)
- `list.lens_actions` (owner mcp_execution_bridge, mcp_builtin tool `list_lens_actions`)
- `conkay.solve` (owner mcp_execution_bridge, mcp_builtin tool `conkay_solve`)
- `conkay.solver_list` (owner mcp_execution_bridge, mcp_builtin tool `conkay_solver_list`)
- `incident.watch` (owner incident_engine, mcp tool `incident_watch`)
- `incident.active` (owner incident_engine, mcp tool `incident_active`)
- `incident.history` (owner incident_engine, mcp tool `incident_history`)
- `incident.classify` (owner incident_engine, mcp tool `incident_classify`)
- `incident.recover` (owner incident_engine, mcp tool `incident_recover`)
- `research.filter` (owner research_frontier, mcp tool `research_filter`)
- `research.invoke` (owner research_frontier, mcp tool `research_invoke`)
- `research.findings` (owner research_frontier, mcp tool `research_findings`)
- `research.pending` (owner research_frontier, mcp tool `research_pending`)
- `opportunity.scan` (owner opportunity_engine, mcp tool `opportunity_scan`)
- `opportunity.list` (owner opportunity_engine, mcp tool `opportunity_list`)
- `opportunity.get` (owner opportunity_engine, mcp tool `opportunity_get`)
- `opportunity.approve` (owner opportunity_engine, mcp tool `opportunity_approve`)
- `opportunity.reject` (owner opportunity_engine, mcp tool `opportunity_reject`)

## What the gaps mean (phase 2 onwards)

- **frame** is missing everywhere: there is no coordinate-frame object yet (phase 2).
- **units, limits, outputs** are missing for almost every macro: declaring them is the bulk of phase 4, starting with the candidates above.
- **provenance** exists only for ConKay solvers (the receipt envelope); macros return raw results.
- **risk** for macros is a name heuristic, not an owner's declaration.

