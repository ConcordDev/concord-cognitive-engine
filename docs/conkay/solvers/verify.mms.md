# verify.mms — method of manufactured solutions (SX-XC-05)

The verification protocol for PDE discretizations: pick an
exact (manufactured) solution, derive the source term that
manufactures it, run the discretization on a mesh sequence,
and measure the observed order of accuracy against theory.
Built at the JS tier under the CB-0820 engine-only interim
ruling (XC-05 is one of the five engine-flag rows): the
built-in library's source terms are hand-derived and
pinned; the general tier — arbitrary manufactured
solutions, whose source terms need symbolic derivation
(SXE-02), and per-engine MMS — refuses by name as
`requires_engine_tier:sxe-02` (targets `symbolic-source`
and `engine`).
Code: `server/lib/conkay/physics/solvers/verify-mms.js`
(registry solver, L3).

## Library (hand-derived sources)

- **poisson-1d** — −u″ = f on (0,1), central FD (Thomas
  solve), theoretical L2 order 2. Solutions: `sin`
  (u = sin πx, f = π² sin πx) and `poly`
  (u = x²(1−x)², f = −2 + 12x − 12x²). Default meshes
  40/80/160, cap 640.
- **poisson-2d** — −Δu = f on the unit square, P1 FEM
  (Jacobi-preconditioned CG), theoretical L2 order 2 and
  H1 order 1. Solutions: `sin-product`
  (u = sin πx sin πy, f = 2π²u) and `poly`
  (u = x(1−x)y(1−y), f = 2[y(1−y) + x(1−x)]). Default
  meshes 8/16/32, cap 48.

## Verdict discipline

The measurement is the product. Per-mesh errors and the
least-squares observed orders are served as measured. A
verdict of `order_confirmed` requires every observed
order within ±0.35 of theory and monotone-decreasing
errors; anything else serves the same numbers with
`verdict: order_not_confirmed` and a warning naming the
deviation (envelope WARN) — a failing order is a finding
about the code under test, reported, never massaged. A
mesh sequence needs at least three strictly increasing
levels; a CG non-convergence refuses by name.

## Reference + locator

Roache, *Fundamentals of Verification and Validation*;
Salari & Knupp, "Code Verification by the Method of
Manufactured Solutions," SAND2000-1444 (Sandia, free via
OSTI). CI reference case, from the catalogue: Poisson MMS
observed order 2 — measured at build: poisson-2d
sin-product L2 order 1.986, H1 order 0.993; poisson-1d
sin L2 order 2.000 (errors quartering per halving).

## Replay

Walker: `conkay_solve` verify.mms `{problem:
"poisson-2d"}`, target `mms` → PASS, verdict
order_confirmed, observedOrder.l2 within ±0.35 of 2; the
same entry at target `symbolic-source` → NOT_COMPUTED
`requires_engine_tier:sxe-02`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain
paths reach the registry entry as registered.
