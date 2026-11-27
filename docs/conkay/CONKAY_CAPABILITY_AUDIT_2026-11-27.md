# ConKay capability audit — 2026-11-27

Owner's bar: ConKay builds **anything** (a car, a lamp, a plane, a coffee cup),
in 3D, inspectable and editable by the person, and puts every aspect in its
correct place with verifiable math — "not 1:1 yet, but 1:1 in every aspect
that matters for development", so its work can be taken to a real lab.

This audit measures what runs today against that bar. Method: the live solver
registry (`listSolvers()` after importing `lib/conkay/index.js`), test-file
references per solver id, the engine drivers on disk, the CI workflows, the
container's installed kernels, the 3D viewer's code, and keyword probes for
the physics each test object needs. Reproduce the solver inventory with
`node -e 'import("./server/lib/conkay/index.js").then(async()=>{const {listSolvers}=await import("./server/lib/conkay/physics/registry.js");console.log(listSolvers().length)})'`.

## 1. Solvers: 128 registered

| Family (domain prefix) | Count | General or object-specific |
|---|---:|---|
| material (composites, CTE, stiffness, viscoelastic, conductivity) | 23 | general |
| robotics (gait, torque, balance, impedance) | 21 | robot-specific |
| structural (frame FE, buckling, bolted joints ×12, tube bending) | 20 | mostly general |
| mass / cost / cg / inertia | 8 | general |
| electrical (DC budget, battery, motor thermal, traction) | 5 | DC budget general, rest vehicle/robot |
| vessel (hoop, burst, H₂ permeation) | 4 | general |
| performance (gearing, power, top speed, axle loads) | 4 | vehicle-specific |
| safety, package, tire | 4 + 4 + 2 | vehicle-specific |
| aero (drag build-up, 2-D panel shape, CFD) | 3 | **targets `props.vehicle` only** |
| thermal (1-D conduction, brake stop, cooling opening) | 3 | conduction general |
| chem (Cantera equilibrium/ignition/flame speed, solution) | 4 | general |
| electromagnetics (FDTD, magnetostatic) | 2 | general |
| cad (body, design surface, show solid) | 3 | car body |
| fatigue, corrosion | 2 + 2 | joints/actuators only |
| fluid (pipe network, coolant loop) | 2 | general |
| other (drawing, requirements, clearance, stability, process…) | ~12 | mixed |

- **9 solvers have no test referencing them:** `actuation.static-torque`,
  `energy.solar-yield`, `safety.single-failure`, `joint.block-shear`,
  `joint.gross-section`, `joint.net-section`, `joint.prying-action`,
  `joint.slip-critical`, `joint.governing-check`.
- About **35 of 128 are tied to a vehicle or robot** by their target (they
  fire only on `props.vehicle`, `props.walk`, robot kinds…). The aero
  family in particular has a real 2-D panel method and an OpenFOAM CFD lane
  with a mesh study and Grid Convergence Index, but only a car can reach them.
- The build planner (`lib/conkay/build/catalogue.js`) currently exposes 8
  families (parts, frame, pressure, flow, heat, electrical, mixture,
  combustion). Everything else is unreachable from a general build.

## 2. External engines

| Engine | Driver code | Runs here | Notes |
|---|---|---|---|
| OpenCascade (CadQuery/OCP) — real solids | yes (`cad/*_occ.py`, `occ-bridge.js`) | **no** (`OCP` not installed) | car body, drawings, show-solid, tub fit; STEP import/export |
| CalculiX — solid FEA | yes (`fea/calculix.js`) | **no** (`ccx` missing) | `fea.solid3d` |
| OpenFOAM — CFD | yes (`cfd/`, mesh study, GCI, Ahmed-body validation) | **no** | vehicle drag only |
| Meep — FDTD EM | yes (`em-fdtd.js`) | no | |
| FEniCSx — magnetostatics | yes (`em-magnetostatic.js`) | no | |
| Cantera — combustion | yes (`reacting-chemistry.js`) | no | |
| 21 others (OpenRadioss crash, PyBaMM batteries, SU2, ngspice circuits, Chrono multibody, Elmer, code_aster, OpenModelica, CuraEngine/PrusaSlicer, pycalphad, phreeqc, …) | **none** | — | `.github/workflows/conkay-engine-*.yml` (27, commit `e61650676`) each run `server/tests/conkay/engines/<engine>.test.js` and cite `docs/conkay/engines/<engine>.md`; **none of those 27 test files or docs exist**, so all 27 lanes are dead scaffolding (they would fail on dispatch). |

Without the OCC kernel, every "real solid" check in a deployed box without it is
NOT_COMPUTED (the pre-existing `conkay-envelope-refusal` failure is this).

## 3. Geometry

- IR shapes: box, plate, cylinder/rod/bolt, round-tube, rect-tube, i-beam,
  shell, ellipsoid-shell, and `cad-body` (the car body only). No revolve,
  sweep, loft, shell-with-thickness, fillet, hole, or boolean — so a coffee
  cup (revolved shell + handle sweep), a lamp shade (revolved cone) or a wing
  (lofted airfoil sections) cannot be represented except as rough primitives.
- Build parts are tessellated primitives (`cad-glb.js`); positions are centres;
  there is no assembly constraint solve for builds (`assembly-mates.js` exists,
  used only by the separate assembly lens).

## 4. The 3D view (`components/chat/MeshArtifactView.tsx`)

Has: orbit, standard views, measure, section plane, per-part hide/isolate,
STL/GLB/STEP export. Lacks: picking a part in the scene, pass/fail colour per
part, editing anything, re-checking. A build is shown, not worked on.

## 5. Physics each test object needs (aspects that decide whether it works)

| Object | Aspect | Today |
|---|---|---|
| Coffee cup | heat loss of the drink over time (transient, natural convection, radiation) | 1-D conduction (steady); **no natural convection, no radiation in a general solver** |
| | outer surface temperature at the hand | conduction BCs only |
| | tip-over stability (full vs empty) | `stability.static` exists but targets `props.stability` contacts — usable, not in catalogue |
| | drop / impact on a ceramic | **none** |
| | thermal shock (boiling water into a cold cup) | **none** |
| Lamp | tipping with the arm extended | as above |
| | LED junction temperature / heat-sink sizing | **none** (no junction model) |
| | light output on the work surface (photometry) | **none** |
| | arm joints hold position (friction/spring torque) | robot torque solvers only; **no general linkage/friction** |
| | mains/low-voltage electrical | DC budget only |
| Plane | lift and drag of the wing (3-D, viscous) | 2-D panel method + CFD, **car-only targets**; no vortex lattice / lifting line |
| | stability and control (static margin, neutral point) | **none** |
| | wing bending, torsion, flutter | frame FE for bending; **no flutter, no modal** |
| | weight and balance, performance (range, climb) | mass/CG yes; **no flight performance** |
| | propulsion | motor thermal / battery budget only |
| Car | everything above plus crash, NVH, suspension kinematics, ride/handling | vehicle concept solvers + chassis screen + crush paths; **no suspension kinematics, no multibody, no crash FE, no NVH** |
| All | vibration / natural frequencies (modal) | **none in ConKay** (frame FE has no modal mode) |
| All | fatigue on a real load history | joint/actuator screens only |
| All | tolerances and fits, manufacturability (draft, wall thickness, process limits) | GD&T data in the assembly lens; **no tolerance stack, no DFM checks** |

## 6. Verification depth

- Real benchmark pinning exists in places (2-D panel: cylinder + Joukowski
  exact; CFD: Ahmed body + GCI; frame FE; pipe network). Many solvers are
  screens (fidelity 0–1) with no stated uncertainty.
- No general uncertainty propagation: a margin is a single number, not a
  number with a confidence.
- No loop from a lab measurement back into a model.

## 7. What "1:1 in every aspect that matters" needs, ranked

1. **Inspectable, editable 3D builds** — pick a part, see its checks,
   change a dimension or material in any unit, re-check deterministically,
   parts coloured by their worst check. (Step 1; started 2026-11-27.)
2. **Real geometry**: revolve / sweep / loft / shell / fillet / hole in the
   IR, built by OpenCascade where installed and tessellated faithfully where
   not; the OCC kernel, CalculiX and Cantera provisioned in the deploy image.
   (Shipped 2026-11-27: extrude with holes and fillets, revolve with capacity,
   loft with NACA sections, the OCC kernel with a volume cross-check and STEP
   export, provisioned in the Docker image and the gating CI job. Still open:
   sweeps, shells, booleans, threads; CalculiX provisioning. Cantera is now provisioned beside OpenCascade.)
3. **Generalise the object-specific solvers**: aero (lift/drag on any
   surface), stability (any object), fatigue, thermal (transient + natural
   convection + radiation), modal; add them to the build catalogue.
4. **Fill the missing physics** that decide common objects: impact/drop,
   thermal shock, photometry, junction thermal, linkages and friction,
   flight stability and performance, tolerance stacks, DFM rules.
5. **Real engines for the remaining lanes** (crash, batteries, multibody,
   circuits) — or delete the 27 dead workflows until their drivers exist.
6. **Uncertainty on every margin, benchmark per solver, lab test plans and
   measured-result calibration.**
