# physics — Feature Gap vs PhET / Algodoo

Category leader (2026): PhET Interactive Simulations + Algodoo (interactive physics sandbox). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/physics.js` — 8 macros (kinematicsSim, orbitalMechanics, waveInterference, thermodynamics, kinematics-1d, projectile, convert-units, constants); page persists simulations to the generic store.

## Has (verified in code)
- Real-time canvas 2D physics simulation — rigid bodies, gravity, collisions, energy tracking (KE/PE)
- Bouncing-balls preset auto-loads and runs on mount; play/pause; canvas interaction handlers
- Save/load/delete simulations as artifacts
- Physics solvers: 1D kinematics, projectile motion, orbital mechanics, wave interference, thermodynamics
- Unit conversion, physical constants lookup

## Missing — buildable feature backlog
- [ ] `[M]` Simulation editor — drag-place bodies, set mass/velocity/restitution interactively
- [ ] `[M]` More body types — springs, joints, ramps, pendulums, fluids (Algodoo's range)
- [ ] `[S]` Graphs over time — plot position/velocity/energy of a simulated body
- [ ] `[M]` Curriculum simulations — guided PhET-style modules (circuits, optics, gas laws)
- [ ] `[S]` Adjustable physics parameters panel — gravity, air resistance, time scale live controls
- [ ] `[S]` Simulation share/embed — export a scene others can load
- [ ] `[S]` Measurement tools — ruler, protractor, force vectors overlay

## Parity
~50% of PhET/Algodoo's feature surface. A working real-time canvas physics engine plus a solid solver library (kinematics, orbital, waves, thermo) is a genuine base, but it lacks an interactive scene editor, varied body types (springs/joints/fluids), and per-body time-series graphs.
