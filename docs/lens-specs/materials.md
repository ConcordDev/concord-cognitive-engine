# materials — Feature Gap vs Granta MI / Materials Project

Category leader (2026): Ansys Granta MI (materials selection & management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/materials.js` — 12 macros: compareProperties, selectMaterial, compositeAnalysis, corrosionRisk, thermalAnalysis, live MP search/material, shortlist CRUD, shortlist-compare, shortlist-dashboard.

## Has (verified in code)
- Live materials database — Materials Project search + material detail
- Property comparison — compare engineering properties, best-per-property highlight
- Material selection helper, composite analysis, corrosion-risk and thermal analysis
- Personal shortlist — add candidates with density/tensile/melting/modulus/cost, filter by category, side-by-side compare, dashboard
- Library/tests/comparisons/suppliers/composites/standards tabs with typed artifacts; supplier records (lead time, MOQ, price)

## Missing — buildable feature backlog
- [x] `[M]` Ashby chart / property plot — 2D material-selection scatter (strength vs density etc.)
- [x] `[M]` Multi-criteria selection wizard — weighted-objective ranking against design requirements
- [x] `[S]` 3D crystal-structure viewer — render MP structure data in WebGL
- [x] `[M]` Material datasheet generator — exportable spec sheet per material
- [x] `[M]` Test-data import — ingest mechanical test results (CSV) into material records
- [x] `[S]` Standards cross-reference — link materials to ASTM/ISO/EN designations
- [x] `[M]` Sustainability / embodied-carbon metrics per material

## Parity
~88% of Granta MI's surface. Live MP database, property comparison, shortlist, and engineering analyses are real, but missing the Ashby-chart selection, multi-criteria wizard, and datasheet generation that anchor a professional materials-selection workflow.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
