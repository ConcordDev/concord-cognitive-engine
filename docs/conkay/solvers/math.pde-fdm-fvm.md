# math.pde-fdm-fvm — PDE by finite differences / volumes (SX-NUM-11)

Structured-grid finite volumes / differences at the JS tier,
after LeVeque. Code:
`server/lib/conkay/physics/solvers/pde-fdm-fvm.js` (registry
solver, L3).

## Targets

- **sod** — the 1D Euler equations by Godunov's method: the
  intercell flux is the **exact Riemann solution** (Toro's
  pressure iteration), piecewise constant, explicit in time.
  Outputs carry the plateaus sampled at x = 0.3 / 0.55 / 0.75 /
  0.9 and the L1 density error against the exact solution,
  computed independently of the march.
- **advection** — u_t + c·u_x = 0 by upwind finite volumes on
  a periodic domain; the exact solution is the translated
  profile, and the L1 error against it is reported.
- **heat-cn** — u_t = α·u_xx by Crank–Nicolson. CN is
  unconditionally stable; that fact is declared in the regime
  rather than gated.

## Stability honesty (the validity envelope)

The time step is derived from the declared CFL number and the
mesh. Asking for CFL outside (0, 1] is refused by name
(`invalid_input:cfl …`) on every hyperbolic target — an
unstable march is never served. The run reports `steps` and
`maxCflUsed` so the discipline is auditable from the result.
Every target runs at mesh N and 2N under the same
mesh-doubling estimate contract as math.pde-fem; an
unattainable tolerance refuses (`not_converged`) rather than
serving the coarse march.

## Reference + locator

LeVeque, *Finite Volume Methods for Hyperbolic Problems*.
CI reference case: the Sod shock tube at t = 0.2 — star
pressure 0.30313, star velocity 0.92745, star densities
0.42632 / 0.26557 asserted at the plateau sample points
(contact at 0.6855, shock at 0.8504), undisturbed right state
at x = 0.9, L1 error vs the exact Riemann solution < 0.02.
Advection: sine over a full period, L1 < 0.015. Heat-CN: the
sin mode's center decays to exp(−απ²t) within 2e-3.

## Named follow-on scope

TVD limiters / higher-order reconstruction and unstructured
grids are follow-on scope, unlisted rather than approximated.

## Replay

Walker: `conkay_solve` math.pde-fdm-fvm `{mesh: 100, t: 0.2,
tol: 5e-3}`, target `sod` → PASS with the plateau values
above; `{cfl: 1.5}`, target `sod` → NOT_COMPUTED
`invalid_input:cfl`. Reachability via solve.direct rides
SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
