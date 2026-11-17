# verify.mesh-convergence — mesh/time-step convergence, GCI (SX-XC-04)

Richardson extrapolation and the Grid Convergence Index on three
systematically refined meshes. Code:
`server/lib/conkay/physics/solvers/mesh-convergence.js`
(registry solver, L3).

## Equations (Roache; Celik et al. 2008 procedure)

Given f1 (fine), f2, f3 (coarse) and uniform refinement ratio r:

- e21 = (f2 − f1)/f1, e32 = (f3 − f2)/f2
- R = e21/e32 (convergence ratio)
- p = ln(e32/e21) / ln(r) (observed order)
- f_ext = f1 + (f1 − f2)/(r^p − 1) (Richardson extrapolated value)
- GCI_fine = 1.25·|e21|/(r^p − 1); GCI_coarse = 1.25·|e32|/(r^p − 1)
  (safety factor Fs = 1.25 for a three-mesh study)
- asymptotic ratio = GCI_coarse / (r^p · GCI_fine) ≈ 1 in the
  asymptotic range

## Inputs / units

`{solutions: [f1, f2, f3], refinementRatio: r}` — solutions in the
quantity's own unit, fine to coarse; r dimensionless, > 1. Optional
`tolerance`: when supplied, GCI_fine becomes an envelope margin and
a study missing its tolerance FAILs. Optional `r21`/`r32` may be
echoed for provenance; unequal values are refused (below).

## Envelope (validity)

≥ 3 systematically refined meshes, uniform ratio, monotonic
convergence. Refusals, all NOT_COMPUTED and named:

- fewer than 3 solutions → `insufficient_meshes` (the envelope);
- oscillatory sequence (R < 0) → `oscillatory_convergence`, with
  the sequence spread in the outputs beside the refusal — no GCI
  is served for a sequence whose order does not exist;
- divergent sequence (R > 1) → `divergent_convergence`, with the
  negative observed order beside it;
- r21 ≠ r32 → `nonuniform_refinement` (the iterative-p form is
  outside this solver's declared envelope);
- f1 = 0 → `invalid_input` (relative measures undefined);
  r ≤ 1 or non-finite inputs → `invalid_input` naming the field.

Special case: an exactly identical fine pair (e21 = 0) is a result,
not a refusal — GCI_fine = 0, extrapolated value = f1, observed
order null, with the note in the assumptions.

## Reference + locator

Roache, *Verification and Validation in Computational Science and
Engineering*; Celik et al., "Procedure for Estimation of
Discretization Error in CFD Simulations", J. Fluids Eng. 130(7),
2008; NASA NPARC GCI tutorial (grc.nasa.gov). CI reference case: a
manufactured sequence f(h) = 2 + 0.5h² at h = 0.1/0.2/0.4 —
expected p = 1.9893, f_ext = 1.99995 (exact 2.0), GCI_fine =
0.003149, asymptotic ratio exactly 1, all computed by hand from
the procedure, never from the solver's output.

## Replay

Walker: `conkay_solve` verify.mesh-convergence with the
manufactured inputs → PASS with the values above; with
`{solutions: [1.0, 1.1, 1.05], refinementRatio: 2}` →
NOT_COMPUTED `oscillatory_convergence` with the spread beside it.
Reachability via solve.direct rides SC-00 (named foundation); the
MCP/chain paths reach the registry entry as registered.
