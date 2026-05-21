# diy — Feature Gap vs Instructables / Sortly

Category leader (2026): Instructables (project guides) + Sortly (tools/materials inventory). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `diy` domain macros (estimateProject, cutList, toolCheck, safetyCheck, buildTimeEstimate); generic `/api/lens` artifact store for 6 types; DiyShowcase component.

## Has (verified in code)
- 6-tab workspace: Projects, Tools, Materials, Instructions, Ideas, Gallery
- Project CRUD with status workflow
- AI actions: project cost estimate, cut list, tool check, safety check, build-time estimate
- Tool + material inventory artifacts; instruction + idea + gallery artifacts; DiyShowcase

## Missing — buildable feature backlog
- [x] `[M]` Step-by-step illustrated guide builder — ordered steps with photo per step
- [x] `[M]` Bill of materials with cost rollup and shopping links per project
- [x] `[S]` Tool-availability check against inventory before starting a project
- [x] `[M]` Project progress tracking — mark steps complete, photo the result
- [x] `[S]` Difficulty/time/cost tags with browse-by-filter on the gallery
- [x] `[S]` Cut-list optimizer view (macro computes it; needs a board-layout diagram)
- [x] `[S]` Project forking / remix — start from someone else's published build

## Parity
~85% of an Instructables+Sortly composite. Has the 6-category scaffold plus useful AI compute (cut list, cost, safety), but missing the illustrated step-builder, BOM with cost rollup, and progress tracking that make DIY guides usable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
