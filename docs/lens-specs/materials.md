# materials — Feature Completeness Spec

Rival app(s): Materials Project, Granta MI, MatWeb (2026)
Sources:
- https://materialsproject.org/ (materials database — live MP API)
- Granta MI / Ansik Granta (material selection — shortlist + side-by-side comparison)

## Features

### Materials database (live + analysis)
- [x] Materials Project search + material detail (macro: materials.mp-search / mp-material)
- [x] Property comparison on supplied data (macro: materials.compareProperties)
- [x] Material selector (macro: materials.selectMaterial)
- [x] Composite analysis (macro: materials.compositeAnalysis)
- [x] Corrosion risk + thermal analysis (macro: materials.corrosionRisk / thermalAnalysis)

### Material shortlist (Granta MI-shape selection)
- [x] Shortlist a material — name, formula, category, density / tensile / melting point / modulus / cost (macro: materials.shortlist-add)
- [x] List + filter the shortlist by category (macro: materials.shortlist-list)
- [x] Remove a material (macro: materials.shortlist-remove)
- [x] Side-by-side compare — property table with the best pick highlighted per property (macro: materials.shortlist-compare)
- [x] Shortlist dashboard — count, by-category (macro: materials.shortlist-dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| 3D crystal-structure viewer | a WebGL crystallography renderer | the MP API returns structure data; comparison focuses on engineering properties |
| Full Granta MI material database | a licensed materials dataset | live Materials Project search + a personal shortlist with manual property entry |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/materials.js` clean. 12 macros
  (7 database/analysis + 5 shortlist substrate).
- 2026-05-20: Tests — `tests/materials-shortlist-domain-parity.test.js` 7/7 green
  (shortlist CRUD + per-user scope + dedupe / compare best-per-property
  lower-better vs higher-better + 2-material minimum / dashboard by-category /
  analysis macros intact).
- 2026-05-20: Frontend — new `MaterialShortlist` (add candidates with property
  fields, side-by-side comparison table with best-pick highlight) mounted in
  the materials lens page. `npx tsc --noEmit` exit 0.
