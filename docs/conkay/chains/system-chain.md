# The system chain (SXC-26)

Runner: `orc.chain-run` · Chain id: `system-chain` · Receipt: SX-CHAIN-RECEIPT
Definition source: `server/lib/conkay/orc/chain-run.js` (the step table is code, this doc is its reading copy — the runner's suite pins the behaviour).

## Steps, mappings, engines

| # | step | solver | tier | consumes → produces | engine |
|---|---|---|---|---|---|
| 1 | intent | orc.intent-parse | L1 | brief text → parsed quantities | JS |
| 2 | requirements | orc.requirements | L1 | brief text → system requirements | JS |
| 3 | architecture | orc.system-architecture | L2 | brief text → architecture + subsystems | JS (SXE-21 tier NOT_COMPUTED inside the link) |
| 4 | parts-cad | cad.mass-properties-brep | L2 | declared parts (geometry + material/density) → per-part mass/volume | JS |
| 5 | mass-bom | orc.mass-bom | L2 | declared parts → totals, CG, budget verdict. **Named mapping: its `budgetKg` input is the requirements link's mass bound** | JS |
| 6 | bom | cad.bom-structure | L2 | declared items tree → line roll-up, totals | JS |
| 7 | integration | orc.integration-checks | L3 | declared closures/interfaces → per-check verdicts | JS |
| 8 | gaps | orc.research-gaps | L1 | declared needs → research queue | JS (SXE-41 tier NOT_COMPUTED inside the link) |
| 9 | iterate | orc.iterate | L3 | declared design + bounded variables → repaired design | JS (SXE-21 tier NOT_COMPUTED inside the link) |
| 10 | fallback | orc.realistic-fallback (SX-ORC-09) | L3 (JS; SXE-21 tier NOT_COMPUTED inside the link) | declared fallback inputs (requirements + envelope constraints) → the closest realistic version within the stated envelope, shipped with its envelope (CB-0835 rule 2). Optional: runs only when the chain is infeasible — a stopped link or a violated seam — and **never signs the original request**; undeclared, or declared on a feasible chain, it records SKIPPED with the reason | JS (SXE-21 OPT tier declared) |
| 11 | report | orc.system-report | L1 | links 3, 5, 6, 7, 8 outputs → the receipted system report | JS |

Steps 8 and 9 are optional: absent from the chain input, they
are recorded SKIPPED with the reason. Declared and failing,
they stop the chain like any other link. Step 10 is optional
in a different way: it is the chain's infeasibility answer,
evaluated where its trigger is known (in place on a stopped
link, after the seams on a violated seam) and recorded in its
documented position; a fallback that itself returns
NOT_COMPUTED records SKIPPED with that reason and changes
nothing else in the receipt.

## Seams (inside the signed receipt)

| seam | from → to | quantity | rule |
|---|---|---|---|
| mass-budget | requirements → mass-bom | totalMassKg (kg) | rolled-up mass ≤ the brief's mass bound; NOT_APPLICABLE when the brief declares none |
| part-mass-agreement | parts-cad → mass-bom | per-part massKg (kg) | equal within 1e-9 per part |
| mass-total-agreement | mass-bom ↔ bom | totalMassKg (kg) | equal within 1e-9; INCOMPLETE when the BOM total is null (unmassed lines) |
| integration-verdict-carried | integration → report | verdict | the report's claim equals the checks' verdict, by equality |

## Stop and signing rules

A link returning NOT_COMPUTED stops the chain; the receipt
stands INCOMPLETE naming step + reason, and later links never
run. The receipt signs (SIGNED) only when every link computed
and every seam holds — a seam violation with every link green
is the standing counterexample (see the runner's suite: the BOM
counting a cube twice produces SEAM_VIOLATION with no stopped
link).

## Exists vs missing

Exists: all eleven step slots are defined and runnable; the
report link runs, the receipt signs on the golden robot
chain, and the fallback link (SX-ORC-09, seated 2026-11-18
after the founder's F10 ruling) computes the closest
realistic version on infeasible chains. Missing: any chain
beyond this one — burner and beam proof chains and the car
flagship chain are future chain definitions over the same
runner pattern, not yet seated as chain inputs here.
