# math.pde-fem — PDE by finite elements (SX-NUM-10)

P1 (linear) finite elements for the Poisson class −Δu = f at
the JS tier, in 1D (`poisson1d`) and on structured 2D
rectangles (`poisson2d`, right triangles, Dirichlet data as an
expression). Code: `server/lib/conkay/physics/solvers/pde-fem.js`
(registry solver, L4).

## The MMS discipline is the answer contract

The catalogue's reference method is the method of
manufactured solutions, and it is built in rather than left to
the caller:

- Every solve runs at mesh N and 2N. The nodal difference at
  shared nodes is the reported `meshErrorEstimate`; if it
  exceeds the declared tol (default 1e-4), the call is
  NOT_COMPUTED — the coarse answer is not served.
- When the caller declares the manufactured solution
  (`exact`, an expression), the solver computes the **L2 (RMS)
  error** at both meshes and the **observed order**
  log2(e_N / e_2N). P1 must sit in [1.7, 2.3]; outside the band
  the answer is NOT_COMPUTED `observed_order_outside_band` —
  a discretization not converging at its element's rate is a
  defect, not a result. (The error is measured in L2, not at
  nodes: 1D nodal errors are superconvergent at order ~4 by
  the Green's-function argument, which the CI history of this
  ticket demonstrates — the band belongs to the L2 measure.)

## Envelope

Node caps: 1,025 (1D) / 1,600 (2D) — beyond them,
`mesh_too_large` names the FEniCSx engine tier. General weak
forms (UFL), adaptivity, and MPI are that tier too, refused by
name rather than approximated.

## Reference + locator

MMS convergence discipline (the same standard SX-XC-05
verify.mms applies fleet-wide). CI reference cases: −u″ =
π² sin(πx) with exact sin(πx) (observed order in band, fine L2
error < 5e-4); −Δu = 2π² sin(πx) sin(πy) on the unit square
(center value 1 within 5e-3, order in band); the P1 exactness
pin −u″ = 0 → u = 1 + 2x reproduced at the nodes to 1e-9; and
the sabotage pin — declaring sin(2πx) as the "exact" solution
of the π problem trips `observed_order_outside_band`.

## Replay

Walker: `conkay_solve` math.pde-fem `{f:
"9.869604401089358*sin(3.141592653589793*x)", exact:
"sin(3.141592653589793*x)", a: 0, b: 1, mesh: 32, tol: 1e-3}`,
target `poisson1d` → PASS with observedOrder in [1.7, 2.3];
the same call with exact `sin(6.283185307179586*x)` →
NOT_COMPUTED `observed_order_outside_band`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain
paths reach the registry entry as registered.
