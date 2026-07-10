# Chemistry Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 4)

> Derived, not asserted. This unit's sub-agent completed the code changes
> but was interrupted by a container restart before writing this artifact.
> Written by the orchestrator post-restart from direct review of the actual
> committed diff (`git diff` on `app/lenses/chem/page.tsx`,
> `components/chem/ChemActionPanel.tsx`, new `components/chem/ChemSafetyPanel.tsx`).
>
> Reproduce the macro list: `grep -c 'registerLensAction("chem"' server/domains/chem.js` → 25

## Reference app

A real chemistry tool: PubChem-style compound lookup (already present via
`PubChemPanel`) + a working reaction/stoichiometry calculator + a full
periodic-table explorer — "the only difference should be catalog depth,
nothing else."

## What this rebuild fixed (real bugs, not just scaffold)

1. **Reaction Chamber was decorative.** `runReaction` archived whatever
   string the user typed as a DTU with no chemistry behind it, and never
   set a `success` flag — every logged reaction rendered "Failed"
   regardless of validity. Now calls the real `chem.balanceReaction`
   Gaussian-elimination solver; the balanced equation and the solver's
   real `balanced` flag are what gets stored, and each product is minted
   into the Compound Library with its real molecular weight from
   `chem.molecular-weight` (never a fabricated value).
2. **Compound "Stability" was a fabricated bar.** Every compound card
   rendered a `stability` percentage with no backing computation. Replaced
   with the real `molecularWeight` (g/mol) from the balance-reaction
   product mint — displayed only when present, no fallback fake number.
3. **Hardcoded 18-element periodic table + 4 hardcoded "common reactions"
   list** in the Elements tab — replaced with the real, already-existing
   118-element `PeriodicTable` component (click-to-detail + Save-as-DTU).
4. **Generic `UniversalActions` + a bespoke "Computational Actions" button
   grid** (molecularAnalysis / balanceReaction / solutionChemistry) that
   dumped results into a giant conditional-JSX blob keyed on which fields
   happened to be present — replaced by wiring those same three macros
   into the existing bespoke `ChemActionPanel` (which already had proper
   per-action forms and result displays for MW/molarity/pH/dilution) as
   three more first-class actions with their own inputs and typed results,
   removing the duplicate ad-hoc button grid and its generic-JSON fallback
   branch entirely.
5. **`chem.generate-safety` / `chem.check-interactions` /
   `chem.explore-element` had zero UI** — new `ChemSafetyPanel.tsx`: a
   compound safety data sheet (GHS hazard classes, pictograms, first-aid)
   + a pairwise interaction checker (acid+base, oxidizer+organic, etc.) +
   a bundled element quick-reference (the full 118-element table remains
   `PeriodicTable`'s job).
6. Removed the collapsible "Lens Features & Capabilities" panel
   (`LensFeaturePanel`) — read-only spec browser, not a designed feature.

## Coverage

All 25 `chem.*` macros now have a real, non-generic home across
`ChemWorkbench`, `ChemStructureLab`, `PeriodicTable`, `PubChemPanel`,
`ChemActionPanel` (now 7 actions: MW, molarity, pH, dilution, molecular
analysis, reaction balancing, solution chemistry), and `ChemSafetyPanel`
(safety sheet, interactions, element lookup).

## Verification

- `npx eslint app/lenses/chem/page.tsx components/chem/ChemActionPanel.tsx components/chem/ChemSafetyPanel.tsx` — pending (run in the next verify pass alongside astronomy/space/lab/materials).
- `npx tsc --noEmit -p .` — pending, same pass.
- `node scripts/verify-lens-backends.mjs` — pending.
- `node scripts/grade-ux-polish.mjs --honest` — pending.
- No existing chem-lens test file (confirmed by grep) — nothing to update.
