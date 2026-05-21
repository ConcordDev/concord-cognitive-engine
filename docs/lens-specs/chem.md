# chem — Feature Gap vs ChemDraw / PubChem

Category leader (2026): ChemDraw (structure + reaction tooling) / PubChem. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/chem.js` — macros `molecularAnalysis`, `balanceReaction`, `solutionChemistry`, `generate-safety`, `check-interactions`, `explore-element`, `periodic-table`, `molecular-weight`, `calc-molarity`, `calc-dilution`, `calc-ph`, `calc-gas-law`.

## Has (verified in code)
- Interactive periodic table; element explorer
- Reaction balancer; molecular analysis; molecular-weight calculator
- Solution chemistry: molarity, dilution, pH, gas-law calculators
- Safety-data generation; chemical-interaction checker
- PubChem panel (live compound database); ArxivPanel; ChemWorkbench
- Compound + reaction tracking (catalyst/reagent/product, stability)

## Missing — buildable feature backlog
- [x] `[L]` 2D structure drawing editor (draw molecules, not just look them up)
- [x] `[M]` 3D molecule viewer (PubChem provides free conformer data)
- [x] `[M]` SMILES/InChI parsing + structure rendering
- [x] `[S]` Reaction mechanism / electron-pushing diagrams
- [x] `[M]` Stoichiometry calculator (limiting reagent, yield from a balanced eq)
- [x] `[S]` Spectroscopy reference (NMR/IR/MS peak tables)
- [x] `[S]` Lab notebook for reaction logs

## Parity
Backlog fully shipped. `ChemStructureLab` (7-tab surface in `components/chem/`) wires
the structure-layout / parse-smiles / save-structure / list-structures /
delete-structure / resolve-structure / conformer-3d / stoichiometry /
spectroscopy-reference / reaction-mechanism / notebook-* macros into a real UI:
SVG skeletal renderer with double/triple/aromatic bonds, auto-rotating PubChem
3D conformer viewer, SMILES/InChI resolver, limiting-reagent + percent-yield
stoichiometry, IR/¹H/¹³C-NMR/MS peak tables, curved-arrow mechanism outlines,
and a persistent per-user lab notebook.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
