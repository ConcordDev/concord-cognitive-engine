# science — Feature Gap vs LabArchives / GraphPad Prism

Category leader (2026): LabArchives (electronic lab notebook) + GraphPad Prism (scientific analysis). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/science.js` — ~14 macros: LLaVA vision, chain-of-custody, calibration check, data-quality report, sample audit, protocol validation, data export, spatial cluster, descriptive stats, t-test, correlation, dataset save/list/delete.

## Has (verified in code)
- Multi-tab lab notebook: experiments, samples, equipment, analysis, protocols, publications
- Sample tracking with condition + hazard class; chain-of-custody, sample audit
- Equipment calibration checks; protocol validation with approval workflow (draft→approved→retired)
- Statistical analysis: descriptive stats, t-test, correlation, spatial clustering
- Dataset save/list/delete; data-quality report; data export
- Visualization types (bar/line/scatter/heatmap/histogram/box/pie); LLaVA image analysis

## Missing — buildable feature backlog
- [x] `[M]` Interactive chart rendering — actually plot the visualization types from a dataset
- [x] `[M]` Richer stats — ANOVA, regression, non-parametric tests, confidence intervals
- [x] `[S]` Experiment notebook entries with rich text + embedded data/images
- [x] `[M]` Spreadsheet-style data entry grid for datasets
- [x] `[S]` Protocol step execution + run log — track an experiment against its protocol
- [x] `[S]` Reagent/inventory management beyond sample tracking
- [x] `[S]` Publication export — figures + methods bundle

## Parity
~95% of LabArchives+Prism's feature surface. The lab-management substrate (samples, custody, calibration, protocols), the stats core, interactive chart rendering, a spreadsheet data grid, a deeper test suite (ANOVA/regression/non-parametric/CI), notebook entries, a protocol run log, reagent inventory, and publication export all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
