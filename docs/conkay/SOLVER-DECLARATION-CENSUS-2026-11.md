# ConKay solver declaration census — regenerated 2026-11

**Ticket:** CK-AUD-02 (parent MST-W3-16, ConKay M0) · **Seat:** B3
**Branch / base:** v1/conkay @ main `8d54173acbe7b3460bc88f7263338df3b6948c2f`
**Premise census:** 2026-11-17, read against f4f1f77ff (literal keys over
brace-matched `registerSolver({...})` blocks under `server/lib/conkay`).
**Method — two enumerations, reconciled.** (1) STATIC: the premise method
re-run at this base, for comparability. (2) RUNTIME: import every
`registerSolver`-bearing module under `server/lib/conkay` (82 files, zero
import failures) and read the registry's frozen descriptors via
`listSolvers()` in `server/lib/conkay/physics/registry.js`. The runtime
enumeration **governs**: it counts spread/shared declarations and
factory-generated registrations exactly as the runtime registered them.
A field counts as declared when the descriptor carries it (not undefined/null).

## Headline

| Enumeration | Solvers/sites | regime | units | tolerance | screening | reference | method | fidelity | ALL of R+U+T+S | NONE of R+U+T+S |
|---|---|---|---|---|---|---|---|---|---|---|
| Premise static @ f4f1f77ff | 127 sites | 55 | 43 | 50 | 46 | 68 | 125 | 123 | 37 | 68 |
| Static @ 8d54173acb | 104 sites | 49 | 41 | 44 | 42 | 53 | 100 | 99 | 34 | 51 |
| **Runtime @ 8d54173acb (governs)** | **125 solvers** | **57** | **55** | **52** | **60** | **75** | **125** | **125** | **52** | **64** |

Reading the table honestly:

- **Site counts are not comparable across bases.** Registration style shifted
  toward shared objects and factories: 69 of today's 104 static sites use
  spread (`...`), and **26 of the 125 runtime solvers have no static literal
  site at all** (factory/loop registrations — most of the bolted-joint and
  materials-modulus families among them). The premise's literal-key method
  undercounts today's registry by 21 registrations net.
- **The registry holds 125 solvers.** Every one declares `method` and
  `fidelity` (the registry's own validation requires them — CK-CR-03's
  premise). The completeness gap is in the five voluntary fields.
- **52 of 125 (41.6%) declare all four** of regime+units+tolerance+screening;
  **64 of 125 (51.2%) declare none of the four.** Missing per field:
  regime 68 · units 70 · tolerance 73 · screening 65 · reference 50.

## Where the gap lives (runtime, by family)

The gap is not uniform — it clusters in three families, and the materials
families show the completed pattern exists in-tree:

- **Bolted-joint family — 13 solvers, none of the four fields:**
  joint.bolt-shear, joint.bolt-bearing, joint.bolt-tearout, joint.bolt-tension,
  joint.bolt-combined, joint.gross-section, joint.net-section,
  joint.block-shear, joint.bolt-group-distribution, joint.slip-critical,
  joint.prying-action, joint.governing-check, joint.bolt-screening
  (joint.fatigue declares some, not all four). The premise counted 11 at
  f4f1f77ff; the family has grown to 13 undeclared.
- **Robotics / gait / dynamics — the 19 robotics-domain solvers, all 19 with
  none of the four:** actuation.joint-torque, actuation.thermal-budget,
  dynamics.forward, dynamics.full-body-rnea, dynamics.parameter-id,
  gait.capture-point-reachability, gait.footstep-plan,
  gait.footstep-sequence-plan, gait.preview-control, gait.slope-walking,
  gait.swing-collision-check, kinematics.inverse-leg, kinematics.range-check,
  kinematics.self-collision-2d, humanoid.step-pipeline,
  robotics.impedance-controller, stability.dynamic,
  stability.pressure-distribution, stability.push-recovery — plus the adjacent
  fea.bone-stance-stress, beam.fea and beam.euler-buckling.
- **Vehicle / package / mass / cost — 15 solvers, none of the four:**
  mass.part, mass.assembly, mass.cg, mass.breakdown, mass.inertia-moment,
  cost.part, cost.assembly, package.seat-count, package.occupant-fit,
  package.interference, package.tub-fit, vehicle.axle-loads,
  vehicle.top-speed, vehicle.required-power, vehicle.gearing,
  vehicle.chassis-screen, vehicle.acceptance, assembly.vehicle,
  tire.speed-rating, tire.load-index.
- **Singles:** cad.body, cad.design-surface, cad.show-solid, drawing.ga,
  bracket.plate, electrical.battery-budget, electrical.motor-thermal,
  requirement.check.
- **The completed pattern:** the materials families declare in full —
  material.stiffness (6/6), material.composition (3/3), material.cte (3/3),
  material.thermal-conductivity (4/4), material.viscoelastic (3/3),
  material.strength, material.compatibility, material.density — as do
  chem.combustion (3/3), vessel.structure (3/3), electromagnetics (2/2) and
  the safety.* solvers. Declaration completeness is a per-family discipline
  that some families already keep.

## Per-solver table (runtime enumeration, governs)

● = declared · ○ = absent. Columns: Regime, Units, Tolerance, Screening,
Reference.

| Solver | Domain | Fidelity | R U T S Ref |
|---|---|---|---|
| actuation.joint-torque | robotics | 1 | ○ ○ ○ ○ ○ |
| actuation.static-torque | actuation.torque | 0 | ● ● ● ● ○ |
| actuation.thermal-budget | robotics | 1 | ○ ○ ○ ○ ○ |
| actuator.fatigue-screening | fatigue | 1 | ○ ○ ○ ● ● |
| aero.cfd | aero.drag | 4 | ● ● ● ● ● |
| aero.drag-buildup | aero.drag | 1 | ● ○ ○ ● ● |
| aero.shape | aero.drag | 1 | ○ ○ ○ ● ● |
| assembly.vehicle | assembly.vehicle | 1 | ○ ○ ○ ○ ● |
| beam.euler-buckling | structural.buckling | 1 | ○ ○ ○ ○ ● |
| beam.fea | structural.bending | 2 | ○ ○ ○ ○ ○ |
| bracket.plate | structural.bending | 2 | ○ ○ ○ ○ ○ |
| cad.body | cad.body | 2 | ○ ○ ○ ○ ● |
| cad.design-surface | cad.design-surface | 1 | ○ ○ ○ ○ ● |
| cad.show-solid | cad.show-solid | 1 | ○ ○ ○ ○ ● |
| chem.equilibrium | chem.combustion | 3 | ● ● ● ● ● |
| chem.flameSpeed | chem.combustion | 3 | ● ● ● ● ● |
| chem.ignition | chem.combustion | 3 | ● ● ● ● ● |
| conservation.energy | conservation.energy | 0 | ● ● ● ● ○ |
| cost.assembly | cost | 0 | ○ ○ ○ ○ ○ |
| cost.part | cost | 0 | ○ ○ ○ ○ ○ |
| drawing.ga | drawing.ga | 1 | ○ ○ ○ ○ ● |
| drawing.ga-assembly | drawing.ga | 0 | ● ● ● ● ● |
| dynamics.forward | robotics | 1 | ○ ○ ○ ○ ○ |
| dynamics.full-body-rnea | robotics | 2 | ○ ○ ○ ○ ○ |
| dynamics.inverse | dynamics | 1 | ● ● ● ● ● |
| dynamics.parameter-id | robotics | 1 | ○ ○ ○ ○ ○ |
| electrical.battery-budget | electrical | 1 | ○ ○ ○ ○ ○ |
| electrical.budget | electrical.power | 0 | ● ● ● ● ○ |
| electrical.motor-thermal | electrical | 1 | ○ ○ ○ ○ ○ |
| em.fdtd | electromagnetics | 3 | ● ● ● ● ● |
| em.magnetostatic | electromagnetics | 3 | ● ● ● ● ● |
| energy.solar-yield | energy.solar | 0 | ● ● ● ● ● |
| fea.bone-stance-stress | structural | 2 | ○ ○ ○ ○ ○ |
| fea.solid3d | structure.fea | 3 | ● ● ● ● ● |
| fluid.coolant-loop | fluid.internal | 1 | ● ● ● ● ● |
| fluid.cooling-opening | thermal.cooling | 1 | ● ● ○ ● ● |
| gait.capture-point-reachability | robotics | 1 | ○ ○ ○ ○ ○ |
| gait.footstep-plan | robotics | 1 | ○ ○ ○ ○ ○ |
| gait.footstep-sequence-plan | robotics | 1 | ○ ○ ○ ○ ○ |
| gait.preview-control | robotics | 2 | ○ ○ ○ ○ ○ |
| gait.slope-walking | robotics | 1 | ○ ○ ○ ○ ○ |
| gait.swing-collision-check | robotics | 1 | ○ ○ ○ ○ ○ |
| geometry.clearance | geometry.clearance | 0 | ● ● ● ● ○ |
| humanoid.step-pipeline | robotics | 3 | ○ ○ ○ ○ ○ |
| joint.block-shear | structural.block-shear | 1 | ○ ○ ○ ○ ● |
| joint.bolt-bearing | structural.bearing | 1 | ○ ○ ○ ○ ○ |
| joint.bolt-combined | structural.combined | 1 | ○ ○ ○ ○ ● |
| joint.bolt-group-distribution | structural.bolt-group | 1 | ○ ○ ○ ○ ● |
| joint.bolt-screening | structural | 2 | ○ ○ ○ ○ ○ |
| joint.bolt-shear | structural.shear | 1 | ○ ○ ○ ○ ● |
| joint.bolt-tearout | structural.tearout | 1 | ○ ○ ○ ○ ● |
| joint.bolt-tension | structural.tension | 1 | ○ ○ ○ ○ ● |
| joint.fatigue | fatigue | 1 | ○ ○ ○ ○ ● |
| joint.galvanic-corrosion | corrosion.galvanic | 1 | ○ ○ ○ ● ● |
| joint.governing-check | verification.governing | 0 | ○ ○ ○ ○ ● |
| joint.gross-section | structural.gross-section | 1 | ○ ○ ○ ○ ● |
| joint.net-section | structural.net-section | 1 | ○ ○ ○ ○ ● |
| joint.prying-action | structural.prying | 1 | ○ ○ ○ ○ ● |
| joint.slip-critical | structural.slip-critical | 1 | ○ ○ ○ ○ ● |
| kinematics.inverse-leg | robotics | 1 | ○ ○ ○ ○ ○ |
| kinematics.range-check | robotics | 1 | ○ ○ ○ ○ ○ |
| kinematics.self-collision-2d | robotics | 1 | ○ ○ ○ ○ ○ |
| mass.assembly | mass | 0 | ○ ○ ○ ○ ○ |
| mass.breakdown | mass.states | 0 | ○ ○ ○ ○ ○ |
| mass.budget | mass.budget | 1 | ● ● ● ● ○ |
| mass.cg | mass.cg | 1 | ○ ○ ○ ○ ○ |
| mass.inertia-moment | mass | 1 | ○ ○ ○ ○ ○ |
| mass.part | mass | 1 | ○ ○ ○ ○ ○ |
| material.basis-discriminator | material.composition | 1 | ● ● ● ● ● |
| material.chemical-compatibility | material.compatibility | 0 | ● ● ● ● ● |
| material.composition-check | material.composition | 0 | ● ● ● ● ● |
| material.crystal-aggregate | material.stiffness | 1 | ● ● ● ● ● |
| material.cte-multiphase | material.cte | 1 | ● ● ● ● ● |
| material.cte-schapery | material.cte | 1 | ● ● ● ● ● |
| material.cte-turner | material.cte | 1 | ● ● ● ● ● |
| material.density-rom | material.density | 1 | ● ● ● ● ● |
| material.heat-dissipation-screen | material.thermal-conductivity | 0 | ● ● ● ● ● |
| material.impact-recovery-screen | material.viscoelastic | 0 | ● ● ● ● ● |
| material.k-lewis-nielsen | material.thermal-conductivity | 1 | ● ● ● ● ● |
| material.k-maxwell-garnett | material.thermal-conductivity | 1 | ● ● ● ● ● |
| material.k-multiphase | material.thermal-conductivity | 1 | ● ● ● ● ● |
| material.mass-to-volume | material.composition | 0 | ● ● ● ● ● |
| material.modulus-bounds | material.stiffness | 1 | ● ● ● ● ● |
| material.modulus-halpin-tsai | material.stiffness | 1 | ● ● ● ● ● |
| material.modulus-hashin-shtrikman | material.stiffness | 1 | ● ● ● ● ● |
| material.modulus-mori-tanaka | material.stiffness | 1 | ● ● ● ● ● |
| material.modulus-mori-tanaka-random | material.stiffness | 1 | ● ● ● ● ● |
| material.tensile-bounds | material.strength | 1 | ● ● ● ● ● |
| material.thermal-transitions | material.thermal-transitions | 0 | ● ● ● ● ● |
| material.viscoelastic-composite | material.viscoelastic | 1 | ● ● ● ● ● |
| material.viscoelastic-prony | material.viscoelastic | 1 | ● ● ● ● ● |
| package.interference | package.interference | 1 | ○ ○ ○ ○ ○ |
| package.occupant-fit | package.ergonomics | 1 | ○ ○ ○ ○ ● |
| package.seat-count | package.seating | 0 | ○ ○ ○ ○ ○ |
| package.tub-fit | packaging.structure | 2 | ○ ○ ○ ○ ● |
| part.uniform-corrosion | corrosion | 1 | ○ ○ ○ ● ● |
| process.window | process.window | 0 | ● ● ● ● ● |
| requirement.check | requirements | 0 | ○ ○ ○ ○ ○ |
| robotics.impedance-controller | robotics | 1 | ○ ○ ○ ○ ○ |
| robotics.limb-torque | robotics.torque | 0 | ● ● ● ● ○ |
| robotics.walk-balance | robotics.walk | 0 | ● ● ● ● ○ |
| safety.cross-function | safety.cross-function | 1 | ● ● ● ● ● |
| safety.single-failure | safety.single-failure | 1 | ● ● ● ● ● |
| stability.dynamic | robotics | 1 | ○ ○ ○ ○ ○ |
| stability.pressure-distribution | robotics | 1 | ○ ○ ○ ○ ○ |
| stability.push-recovery | robotics | 1 | ○ ○ ○ ○ ○ |
| stability.static | stability.static | 0 | ● ● ● ● ○ |
| structural.tube-bending | structural.bending | 1 | ● ● ● ● ● |
| structure.crush-paths | structural.crash | 1 | ● ● ○ ● ● |
| structure.frame | structural.frame | 2 | ● ● ● ● ● |
| structure.hardpoints | structural.frame | 1 | ● ● ○ ● ● |
| thermal.brake-stop | thermal.conduction | 2 | ● ● ● ● ● |
| tire.load-index | safety.tire-load | 0 | ○ ○ ○ ○ ● |
| tire.speed-rating | safety.tire-speed | 0 | ○ ○ ○ ○ ● |
| vehicle.acceptance | verification.acceptance | 0 | ○ ○ ○ ○ ○ |
| vehicle.axle-loads | performance.weight-distribution | 0 | ○ ○ ○ ○ ○ |
| vehicle.chassis-screen | structural.chassis | 2 | ○ ○ ○ ○ ○ |
| vehicle.gearing | performance.gearing | 0 | ○ ○ ○ ○ ○ |
| vehicle.required-power | performance.power-sizing | 1 | ○ ○ ○ ○ ○ |
| vehicle.top-speed | performance.top-speed | 1 | ○ ○ ○ ○ ○ |
| vehicle.traction-battery | electrical.traction | 1 | ● ○ ○ ○ ● |
| vessel.burst-margin | vessel.structure | 1 | ● ● ● ● ● |
| vessel.crash-seal-screen | vessel.structure | 0 | ● ● ● ● ● |
| vessel.h2-permeation | vessel.h2-permeation | 1 | ● ● ● ● ● |
| vessel.hoop-stress | vessel.structure | 1 | ● ● ● ● ● |

## What this census closes, and what it does not

CK-AUD-02's charge was the census itself: the premise left the declaration gap
measured by a method known to undercount, at a stale base. That gap is now
closed **as a measurement** — every one of the 125 registered solvers has a
named declaration state at the current base, reproducible by the method below.

The declaration gaps themselves (64 solvers with none of the four fields,
73 missing tolerance, 70 missing units) are **not** closed by this report —
they are build work, and this table is their worklist:

- **CK-CR-03** (registry input-validity gate) designs against this census:
  a registry-level validity layer can key on declared units/ranges only where
  declarations exist — today that is 55 of 125 for units. The gate's design
  must treat a missing declaration as its own case, not as an absence of
  constraint.
- **The Phase A solver register** (Ultimate Plan Phase A; CB-1447 mapping)
  takes this table as its raw material: a register entry per solver with its
  benchmarks and error band starts from exactly these declaration fields.
- **Per-family declaration builds** (the joint, robotics and vehicle families
  first, by size) are seatable items the office can draw from this table
  solver by solver; the materials families are the in-tree pattern to copy.

## Reproduction

At base `8d54173acbe7b3460bc88f7263338df3b6948c2f`, from `server/`:

1. Runtime (governs): import `lib/conkay/physics/registry.js`, then import
   every `.js` module under `lib/conkay/` whose source contains
   `registerSolver(` (82 files at this base); read `listSolvers()` and tally,
   per descriptor, the presence of `regime`, `units`, `tolerance`,
   `screening`, `reference`, `method`, `fidelity`. Expected: 125 descriptors,
   zero import failures, tallies as in the headline table.
2. Static (comparability): brace-match each `registerSolver({...})` object
   literal in the same file set, extract its literal top-level keys, tally
   identically. Expected: 104 sites, tallies as tabled. The static count is
   a lower bound by construction (spread and factory registrations) and is
   reported only to keep the premise series honest.

The census JSON (both enumerations, per-solver) is retained in the fixer's
working record (`aud02-census/census-8d54173acb.json`).
