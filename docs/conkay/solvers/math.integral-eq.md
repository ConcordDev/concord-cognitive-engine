# math.integral-eq — integral equations / BEM (SX-NUM-12)

Integral equations of the second kind at the JS tier, after
Atkinson. Code: `server/lib/conkay/physics/solvers/integral-eq.js`
(registry solver, L3).

## Targets

- **fredholm** — u(x) = f(x) + λ∫ₐᵇ K(x,t)u(t) dt by
  Nyström's method on composite Gauss–Legendre nodes (nodes
  computed by Newton on the Legendre polynomials). The
  discrete solution is **verified by substitution at points
  that are not quadrature nodes**; a residual outside the
  declared band refuses the answer. When λ sits on a kernel
  eigenvalue the system is singular and refused — and when
  the quadrature's discrete eigenvalue is not exactly the
  operator's, the substitution check is the second catch
  layer (the λ = 3 reference case is caught there, residual
  2). Resonance is never solved through.
- **volterra** — u(x) = f(x) + ∫ₐˣ K(x,t)u(t) dt by marching
  trapezoid Nyström, the diagonal term solved implicitly at
  each step (a vanishing diagonal refuses by name).
- **sphere-capacitance** — the catalogue's BEM reference
  case: the single-layer equation ∫σ(y)/(4πε₀|x−y|) dS = 1
  on a sphere, by collocation on a latitude–longitude grid
  with the singular diagonal treated by the equal-area disk
  integral (∫_disk dS/r = 2√(πA)). Outputs: the capacitance
  ratio C/(4πε₀R), the total charge, and the solved density's
  spread — reported as-is (0.27 on the default grid, dominated
  by polar patch clustering; an equal-area grid is the named
  refinement). The capacitance itself measures 1.004.

## Reference + locator

Atkinson, *The Numerical Solution of Integral Equations of
the Second Kind*. CI reference cases: K = xt, f = 1, λ = 1 →
u = 1 + 3x/4 to 1e-8 at the nodes; λ = 3 refused (the
rank-one kernel's eigenvalue is 1/3); Volterra K = 1 → eˣ and
K = t → e^{x²/2}, both to 2e-5 at mesh 400; sphere
capacitance ratio within 3% of 1.

## Envelope

Fredholm unknowns cap 400, Volterra steps cap 4,000, sphere
grid cap 1,200 patches. Galerkin BEM for general geometries
is follow-on scope, named rather than approximated.

## Replay

Walker: `conkay_solve` math.integral-eq `{kernel: "x*t", f:
"1", lambda: 1, a: 0, b: 1}`, target `fredholm` → PASS with
u = 1 + 0.75x at the nodes; the same call at lambda 3 →
NOT_COMPUTED. `{radius: 2}`, target `sphere-capacitance` →
PASS, capacitanceRatio ≈ 1.004. Reachability via solve.direct
rides SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
