# Solver status — buyer-facing, regenerated (SXC-20)

Generated at branch head `c08eef511` by
`server/scripts/conkay-solver-status.mjs` from the live solver
registry. Do not edit the pinned block by hand — regenerate it.
The CI pin (server/tests/conkay-solver-status.test.js) fails if
this block drifts from the registry.

What the columns mean, and where each comes from — no column is
hand-written:

- **tier** — the solver's declared fidelity in the registry.
  Solvers declared as screening fast paths are labelled
  SCREENING beside their tier; a fast path is never dressed as
  top tier.
- **engines** — the solver's engine dependencies, read from its
  registry descriptor. "—" means the solver computes in JS
  alone. An engine-dependent solver whose engine is unavailable
  returns NOT_COMPUTED for that tier rather than a quiet
  downgrade.
- **tested** — a ConKay suite file (server/tests/conkay-*.test.js,
  155 files at generation) references the solver id.
  Suites outside that glob are not counted; the boundary is
  stated, not implied.
- **signed** — an independent checker agent has re-pulled the
  solver's cited reference and recomputed it (the catalogue's
  signing rule; self-review never counts). Sign-offs are
  recorded in docs/conkay/signoffs.json. UNSIGNED is printed
  where no sign-off is on file — this page never implies a
  signature it does not hold.

<!-- STATUS:BEGIN -->
Solvers registered: 142 · by tier: L0 30 · L1 83 · L2 16 · L3 12 · L4 1
Engine-dependent: 8 · tested (ConKay suite corpus): 132 · signed (independent): 0 · screening fast paths: 58

| solver | domain | tier | engines | tested | signed |
|---|---|---|---|---|---|
| actuation.joint-torque | robotics | L1 | — | yes | UNSIGNED |
| actuation.static-torque | actuation.torque | L0 SCREENING | — | NO | UNSIGNED |
| actuation.thermal-budget | robotics | L1 | — | yes | UNSIGNED |
| actuator.fatigue-screening | fatigue | L1 SCREENING | — | yes | UNSIGNED |
| aero.cfd | aero.drag | L4 | — | yes | UNSIGNED |
| aero.drag-buildup | aero.drag | L1 SCREENING | — | yes | UNSIGNED |
| aero.shape | aero.drag | L1 SCREENING | — | yes | UNSIGNED |
| assembly.vehicle | assembly.vehicle | L1 | — | yes | UNSIGNED |
| beam.euler-buckling | structural.buckling | L1 | — | yes | UNSIGNED |
| beam.fea | structural.bending | L2 | — | yes | UNSIGNED |
| cad.assembly-constraints | cad | L3 | sxe-01 | yes | UNSIGNED |
| cad.body | cad.body | L2 | — | yes | UNSIGNED |
| cad.bom-structure | cad | L2 | — | yes | UNSIGNED |
| cad.design-surface | cad.design-surface | L1 | — | yes | UNSIGNED |
| cad.drawings-detail | cad | L2 | sxe-06 | yes | UNSIGNED |
| cad.mass-properties-brep | cad | L2 | — | yes | UNSIGNED |
| cad.parametric-features | cad | L2 | sxe-21 | yes | UNSIGNED |
| cad.part-geometry | cad | L3 | sxe-06 | yes | UNSIGNED |
| cad.show-solid | cad.show-solid | L1 | — | yes | UNSIGNED |
| chem.equilibrium | chem.combustion | L3 SCREENING | — | yes | UNSIGNED |
| chem.flameSpeed | chem.combustion | L3 SCREENING | — | yes | UNSIGNED |
| chem.ignition | chem.combustion | L3 SCREENING | — | yes | UNSIGNED |
| conservation.energy | conservation.energy | L0 SCREENING | — | yes | UNSIGNED |
| cost.assembly | cost | L0 | — | yes | UNSIGNED |
| cost.part | cost | L0 | — | yes | UNSIGNED |
| drawing.ga | drawing.ga | L1 | — | yes | UNSIGNED |
| drawing.ga-assembly | drawing.ga | L0 SCREENING | — | yes | UNSIGNED |
| dynamics.forward | robotics | L1 | — | yes | UNSIGNED |
| dynamics.full-body-rnea | robotics | L2 | — | yes | UNSIGNED |
| dynamics.inverse | dynamics | L1 | — | yes | UNSIGNED |
| dynamics.parameter-id | robotics | L1 | — | yes | UNSIGNED |
| electrical.battery-budget | electrical | L1 | — | yes | UNSIGNED |
| electrical.budget | electrical.power | L0 SCREENING | — | yes | UNSIGNED |
| electrical.motor-thermal | electrical | L1 | — | yes | UNSIGNED |
| em.fdtd | electromagnetics | L3 | — | yes | UNSIGNED |
| em.magnetostatic | electromagnetics | L3 | — | yes | UNSIGNED |
| energy.solar-yield | energy.solar | L0 SCREENING | — | NO | UNSIGNED |
| fea.bone-stance-stress | structural | L2 | — | yes | UNSIGNED |
| fea.solid3d | structure.fea | L3 | — | yes | UNSIGNED |
| fluid.coolant-loop | fluid.internal | L1 SCREENING | — | yes | UNSIGNED |
| fluid.cooling-opening | thermal.cooling | L1 SCREENING | — | yes | UNSIGNED |
| gait.capture-point-reachability | robotics | L1 | — | yes | UNSIGNED |
| gait.footstep-plan | robotics | L1 | — | yes | UNSIGNED |
| gait.footstep-sequence-plan | robotics | L1 | — | yes | UNSIGNED |
| gait.preview-control | robotics | L2 | — | yes | UNSIGNED |
| gait.slope-walking | robotics | L1 | — | yes | UNSIGNED |
| gait.swing-collision-check | robotics | L1 | — | yes | UNSIGNED |
| geometry.clearance | geometry.clearance | L0 SCREENING | — | yes | UNSIGNED |
| humanoid.step-pipeline | robotics | L3 | — | NO | UNSIGNED |
| joint.block-shear | structural.block-shear | L1 | — | NO | UNSIGNED |
| joint.bolt-bearing | structural.bearing | L1 | — | yes | UNSIGNED |
| joint.bolt-combined | structural.combined | L1 | — | yes | UNSIGNED |
| joint.bolt-group-distribution | structural.bolt-group | L1 | — | yes | UNSIGNED |
| joint.bolt-screening | structural | L2 | — | yes | UNSIGNED |
| joint.bolt-shear | structural.shear | L1 | — | yes | UNSIGNED |
| joint.bolt-tearout | structural.tearout | L1 | — | yes | UNSIGNED |
| joint.bolt-tension | structural.tension | L1 | — | yes | UNSIGNED |
| joint.fatigue | fatigue | L1 | — | yes | UNSIGNED |
| joint.galvanic-corrosion | corrosion.galvanic | L1 SCREENING | — | yes | UNSIGNED |
| joint.governing-check | verification.governing | L0 | — | NO | UNSIGNED |
| joint.gross-section | structural.gross-section | L1 | — | NO | UNSIGNED |
| joint.net-section | structural.net-section | L1 | — | NO | UNSIGNED |
| joint.prying-action | structural.prying | L1 | — | NO | UNSIGNED |
| joint.slip-critical | structural.slip-critical | L1 | — | NO | UNSIGNED |
| kinematics.inverse-leg | robotics | L1 | — | yes | UNSIGNED |
| kinematics.range-check | robotics | L1 | — | yes | UNSIGNED |
| kinematics.self-collision-2d | robotics | L1 | — | yes | UNSIGNED |
| mass.assembly | mass | L0 | — | yes | UNSIGNED |
| mass.breakdown | mass.states | L0 | — | yes | UNSIGNED |
| mass.budget | mass.budget | L1 | — | yes | UNSIGNED |
| mass.cg | mass.cg | L1 | — | yes | UNSIGNED |
| mass.inertia-moment | mass | L1 | — | yes | UNSIGNED |
| mass.part | mass | L1 | — | yes | UNSIGNED |
| material.basis-discriminator | material.composition | L1 SCREENING | — | yes | UNSIGNED |
| material.chemical-compatibility | material.compatibility | L0 SCREENING | — | yes | UNSIGNED |
| material.composition-check | material.composition | L0 | — | yes | UNSIGNED |
| material.crystal-aggregate | material.stiffness | L1 SCREENING | — | yes | UNSIGNED |
| material.cte-multiphase | material.cte | L1 SCREENING | — | yes | UNSIGNED |
| material.cte-schapery | material.cte | L1 SCREENING | — | yes | UNSIGNED |
| material.cte-turner | material.cte | L1 SCREENING | — | yes | UNSIGNED |
| material.density-rom | material.density | L1 SCREENING | — | yes | UNSIGNED |
| material.heat-dissipation-screen | material.thermal-conductivity | L0 SCREENING | — | yes | UNSIGNED |
| material.impact-recovery-screen | material.viscoelastic | L0 SCREENING | — | yes | UNSIGNED |
| material.k-lewis-nielsen | material.thermal-conductivity | L1 SCREENING | — | yes | UNSIGNED |
| material.k-maxwell-garnett | material.thermal-conductivity | L1 SCREENING | — | yes | UNSIGNED |
| material.k-multiphase | material.thermal-conductivity | L1 SCREENING | — | yes | UNSIGNED |
| material.mass-to-volume | material.composition | L0 | — | yes | UNSIGNED |
| material.modulus-bounds | material.stiffness | L1 SCREENING | — | yes | UNSIGNED |
| material.modulus-halpin-tsai | material.stiffness | L1 SCREENING | — | yes | UNSIGNED |
| material.modulus-hashin-shtrikman | material.stiffness | L1 SCREENING | — | yes | UNSIGNED |
| material.modulus-mori-tanaka | material.stiffness | L1 SCREENING | — | yes | UNSIGNED |
| material.modulus-mori-tanaka-random | material.stiffness | L1 SCREENING | — | yes | UNSIGNED |
| material.tensile-bounds | material.strength | L1 SCREENING | — | yes | UNSIGNED |
| material.thermal-transitions | material.thermal-transitions | L0 SCREENING | — | yes | UNSIGNED |
| material.viscoelastic-composite | material.viscoelastic | L1 SCREENING | — | yes | UNSIGNED |
| material.viscoelastic-prony | material.viscoelastic | L1 SCREENING | — | yes | UNSIGNED |
| mesh.generate | cad | L3 | sxe-06, sxe-11 | yes | UNSIGNED |
| orc.edit-commands | orchestration | L0 SCREENING | — | yes | UNSIGNED |
| orc.feasibility | orchestration | L1 SCREENING | — | yes | UNSIGNED |
| orc.integration-checks | orchestration | L3 | — | yes | UNSIGNED |
| orc.intent-parse | orchestration | L1 SCREENING | — | yes | UNSIGNED |
| orc.iterate | orchestration | L3 | sxe-21 | yes | UNSIGNED |
| orc.mass-bom | orchestration | L2 | — | yes | UNSIGNED |
| orc.requirements | orchestration | L1 SCREENING | — | yes | UNSIGNED |
| orc.research-gaps | orchestration | L1 | sxe-41 | yes | UNSIGNED |
| orc.solver-map | orchestration | L1 SCREENING | — | yes | UNSIGNED |
| orc.system-architecture | orchestration | L2 SCREENING | sxe-21 | yes | UNSIGNED |
| orc.system-report | orchestration | L1 | — | yes | UNSIGNED |
| package.interference | package.interference | L1 | — | yes | UNSIGNED |
| package.occupant-fit | package.ergonomics | L1 | — | yes | UNSIGNED |
| package.seat-count | package.seating | L0 | — | yes | UNSIGNED |
| package.tub-fit | packaging.structure | L2 | — | yes | UNSIGNED |
| part.uniform-corrosion | corrosion | L1 SCREENING | — | yes | UNSIGNED |
| process.window | process.window | L0 SCREENING | — | yes | UNSIGNED |
| requirement.check | requirements | L0 | — | yes | UNSIGNED |
| robotics.impedance-controller | robotics | L1 | — | yes | UNSIGNED |
| robotics.limb-torque | robotics.torque | L0 SCREENING | — | yes | UNSIGNED |
| robotics.walk-balance | robotics.walk | L0 SCREENING | — | yes | UNSIGNED |
| safety.cross-function | safety.cross-function | L1 SCREENING | — | yes | UNSIGNED |
| safety.single-failure | safety.single-failure | L1 SCREENING | — | NO | UNSIGNED |
| stability.dynamic | robotics | L1 | — | yes | UNSIGNED |
| stability.pressure-distribution | robotics | L1 | — | yes | UNSIGNED |
| stability.push-recovery | robotics | L1 | — | yes | UNSIGNED |
| stability.static | stability.static | L0 SCREENING | — | yes | UNSIGNED |
| structural.tube-bending | structural.bending | L1 SCREENING | — | yes | UNSIGNED |
| structure.crush-paths | structural.crash | L1 SCREENING | — | yes | UNSIGNED |
| structure.frame | structural.frame | L2 SCREENING | — | yes | UNSIGNED |
| structure.hardpoints | structural.frame | L1 SCREENING | — | yes | UNSIGNED |
| thermal.brake-stop | thermal.conduction | L2 SCREENING | — | yes | UNSIGNED |
| tire.load-index | safety.tire-load | L0 | — | yes | UNSIGNED |
| tire.speed-rating | safety.tire-speed | L0 | — | yes | UNSIGNED |
| vehicle.acceptance | verification.acceptance | L0 | — | yes | UNSIGNED |
| vehicle.axle-loads | performance.weight-distribution | L0 | — | yes | UNSIGNED |
| vehicle.chassis-screen | structural.chassis | L2 | — | yes | UNSIGNED |
| vehicle.gearing | performance.gearing | L0 | — | yes | UNSIGNED |
| vehicle.required-power | performance.power-sizing | L1 | — | yes | UNSIGNED |
| vehicle.top-speed | performance.top-speed | L1 | — | yes | UNSIGNED |
| vehicle.traction-battery | electrical.traction | L1 | — | yes | UNSIGNED |
| vessel.burst-margin | vessel.structure | L1 SCREENING | — | yes | UNSIGNED |
| vessel.crash-seal-screen | vessel.structure | L0 SCREENING | — | yes | UNSIGNED |
| vessel.h2-permeation | vessel.h2-permeation | L1 SCREENING | — | yes | UNSIGNED |
| vessel.hoop-stress | vessel.structure | L1 SCREENING | — | yes | UNSIGNED |
<!-- STATUS:END -->
