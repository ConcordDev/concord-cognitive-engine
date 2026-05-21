# engineering — Feature Gap vs Fusion 360 / SimScale

Category leader (2026): Autodesk Fusion 360 + SimScale (CAD + simulation). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `engineering` domain macros (toleranceAnalysis, stressAnalysis, bom, unitConvert); generic `/api/lens` artifact store; HnEngineeringFeed + FEAResultViewer components.

## Has (verified in code)
- 5-tab workspace: Model, Loads, Materials, Analysis, Results
- AI/compute actions: tolerance analysis, stress analysis, BOM generation, unit conversion
- FEA result viewer component; HN engineering feed
- EngineeringActionPanel

## Missing — buildable feature backlog
- [ ] `[L]` 3D model viewer / parametric geometry editor
- [ ] `[M]` Load case definition UI — apply forces/constraints to model nodes
- [ ] `[M]` Material library with mechanical properties (yield, modulus, density)
- [ ] `[M]` FEA mesh generation + solver run (viewer exists; needs the solve step)
- [ ] `[S]` Stress/deflection result overlay with color-mapped contours
- [ ] `[S]` BOM with cost rollup and supplier links
- [ ] `[S]` Tolerance stack-up visual chain

## Parity
~35% of a Fusion 360+SimScale composite. The 5-tab structure plus stress/tolerance/BOM compute and an FEA viewer is a real scaffold, but the defining features — 3D geometry editing, load definition, mesh+solve — are not present.
