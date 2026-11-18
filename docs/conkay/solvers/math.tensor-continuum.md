# math.tensor-continuum — tensor algebra / continuum kinematics (SX-NUM-24)

Second-order 3×3 tensor operations and the strain measures
of continuum mechanics at the JS tier (L1). Every served
result passes an in-code verification gate at 1e-9 relative:
principal pairs are residual-checked (|T·v − λ·v| plus
orthonormality of the direction set), the second invariant
is cross-checked by principal minors against traces, a
rotation is applied only after R is verified orthonormal
with det +1 and the rotated invariants are re-checked, and
the polar decomposition is served only after F = R·U
reconstructs. A violated gate refuses by name — never a
quietly served answer. The symbolic-exactness tier is
SXE-02's (SymPy), named not claimed: target `symbolic`
returns NOT_COMPUTED `requires_engine_tier:sxe-02`.
Code: `server/lib/conkay/physics/solvers/tensor-continuum.js`
(registry solver, L1).

## Operations

- **invariants** — of a symmetric tensor: I1 = tr T,
  I2 = sum of principal minors, I3 = det T, plus the
  Frobenius norm.
- **principal** — principal values (descending) and
  directions (deterministic sign convention: the
  largest-|component| entry of each direction is positive)
  by cyclic Jacobi.
- **von-mises** — of a Cauchy stress (Pa): principal
  stresses, von Mises stress √[½((σ1−σ2)² + (σ2−σ3)² +
  (σ3−σ1)²)], hydrostatic stress (mean), the deviatoric
  tensor and its invariants J2, J3, and max shear
  (σ1 − σ3)/2. The identity vonMises² = 3·J2 is verified
  in code.
- **transform** — T′ = R·T·Rᵀ for a verified rotation R.
- **strain** — of a deformation gradient F (J = det F
  must be > 0; J ≤ 0 is interpenetration, refused by
  name): right/left Cauchy–Green C = FᵀF and B = FFᵀ,
  Green–Lagrange E = ½(C − I), Almansi e = ½(I − B⁻¹),
  principal stretches and log strains, and the polar
  decomposition F = R·U.

## Envelope

3×3 inputs only. Symmetric inputs (invariants / principal
/ stress) are gated on asymmetry ≤ 1e-9 relative — a
non-symmetric Cauchy stress violates angular-momentum
balance and is refused naming the asymmetry. Entries are
capped at 1e150, beyond which products overflow double
precision; non-finite entries refuse as `invalid_input`
with the field and position named; a missing input refuses
as `missing_input` naming the field (SC-03 shape — no
assumed values).

## Reference + locator

Holzapfel, *Nonlinear Solid Mechanics* (Wiley, 2000) —
the strain-measure definitions of ch. 2 and the stress
invariants of ch. 6. CI reference case, from the
catalogue: pure shear τ has principal stresses
{τ, 0, −τ}, hydrostatic 0, J2 = τ², and von Mises stress
√3·τ (asserted at τ = 100 Pa). Hand-computed strain
references: uniaxial stretch λ = 1.5 (E11 = ½(λ² − 1) =
0.625, J = 1.5) and simple shear γ = 0.5 (C12 = γ,
C22 = 1 + γ², E12 = γ/2, J = 1).

## Replay

Walker: `conkay_solve` math.tensor-continuum `{stress:
[[0,100,0],[100,0,0],[0,0,0]]}`, target `von-mises` →
PASS, vonMises = 173.20508075688772 within tolerance,
principalStresses {100, 0, −100}; the same registry entry
at target `symbolic` → NOT_COMPUTED
`requires_engine_tier:sxe-02`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain
paths reach the registry entry as registered.
