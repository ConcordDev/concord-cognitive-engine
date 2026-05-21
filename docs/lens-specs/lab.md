# lab — Feature Gap vs Benchling / LabArchives (ELN/LIMS)

Category leader (2026): Benchling (electronic lab notebook + LIMS). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/lab.js` registerLensAction macros (calibrationCurve, qcAnalysis, sampleTracker, experimentDesign).

## Has (verified in code)
- Calibration curve fitting — linear, quadratic, 4PL models with R², equation, unknown-concentration interpolation
- QC analysis (quality-control statistics on assay runs)
- Sample tracker (chain-of-custody / sample state)
- Experiment design helper

## Missing — buildable feature backlog
- [ ] `[L]` Electronic lab notebook — rich experiment entries, protocols, witnessed/signed pages
- [ ] `[M]` Inventory management — reagents, freezer boxes, lot tracking with expiry alerts
- [ ] `[M]` Protocol / SOP library with versioning and step-by-step run mode
- [ ] `[M]` Plate/well layout designer for assays (96/384-well mapping)
- [ ] `[S]` Instrument run import (CSV/instrument file → result records)
- [ ] `[M]` Sequence / construct registry (DNA/plasmid) if scoped to molecular biology
- [ ] `[S]` Result audit trail and Levey-Jennings QC charts over time

## Parity
~35% of an ELN/LIMS surface. Strong scientific-compute helpers (calibration, QC stats), but missing the notebook, inventory, protocol library, and plate designer that make Benchling a daily-driver lab system.
