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
- [ ] `[M]` Interactive chart rendering — actually plot the visualization types from a dataset
- [ ] `[M]` Richer stats — ANOVA, regression, non-parametric tests, confidence intervals
- [ ] `[S]` Experiment notebook entries with rich text + embedded data/images
- [ ] `[M]` Spreadsheet-style data entry grid for datasets
- [ ] `[S]` Protocol step execution + run log — track an experiment against its protocol
- [ ] `[S]` Reagent/inventory management beyond sample tracking
- [ ] `[S]` Publication export — figures + methods bundle

## Parity
~55% of LabArchives+Prism's feature surface. The lab-management substrate (samples, custody, calibration, protocols) plus a real stats core (t-test, correlation, clustering) is genuinely strong. Gaps are rendered interactive charts, a data-entry grid, and a deeper statistical test suite.
