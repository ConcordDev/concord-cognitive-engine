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
- [ ] `[L]` 2D structure drawing editor (draw molecules, not just look them up)
- [ ] `[M]` 3D molecule viewer (PubChem provides free conformer data)
- [ ] `[M]` SMILES/InChI parsing + structure rendering
- [ ] `[S]` Reaction mechanism / electron-pushing diagrams
- [ ] `[M]` Stoichiometry calculator (limiting reagent, yield from a balanced eq)
- [ ] `[S]` Spectroscopy reference (NMR/IR/MS peak tables)
- [ ] `[S]` Lab notebook for reaction logs

## Parity
~50% of ChemDraw's surface. The calculator suite (molarity/pH/dilution/gas-law) and live PubChem lookup are real and useful, but the defining feature — drawing and rendering chemical structures — is absent.
