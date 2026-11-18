# cosim.fmi — co-simulation coupling (SX-XC-08)

The FMI co-simulation master algorithm at the JS tier
(catalogue engine: SXE-15 + JS). Two subsystems integrate
independently over each macro-step, exchanging coupling
values under **Jacobi** (parallel) or **Gauss–Seidel**
(sequential) scheduling, with optional fixed-point
coupling iteration and step-doubling step-size control.
Real FMU import and coupling (Modelica, Chrono, CFD/FEA
binaries) is SXE-15's tier and refuses as
`requires_engine_tier:sxe-15`.
Code: `server/lib/conkay/physics/solvers/cosim-fmi.js`
(registry solver).

## The coupled system and the hold discipline

The built-in reference system is the two-mass oscillator:
mass 1 grounded by k1, coupled to mass 2 by kc (optional
coupling damping cc, ground dampings c1/c2). Without
iteration, coupling inputs are held constant across a
macro-step (zero-order hold — the FMI co-simulation
default), and the coupling error is first order in H
(measured ~3.7·H on the reference case).

With `iterate` set, the coupling iterates to a fixed
point under **first-order hold**: each subsystem's input
is the linear interpolation between the start-of-step
value and the current iterate's end value. Measured on
the reference case, this cuts the deviation ~19× at
H = 0.05 and restores second-order scaling. (Iterating
the zero-order-hold map instead was measured during this
build and rejected: it is a dissipative implicit scheme
with a worse error constant than plain Gauss–Seidel.)

Every run ships its **split-vs-monolithic deviation**:
the max |split − monolithic| over all four states at
macro-step boundaries, the monolithic integrated at
stepSize/20 RK4 in the same run — the number a master
algorithm is judged by, reported, never hidden. Undamped
runs also report total-energy drift. Non-converged
coupling steps are counted and warned, never silent.

## Reference + locator

FMI standard (fmi-standard.org, free). Reference case:
m1 = m2 = 1, k1 = 4, kc = 6, x(0) = (1, 0), v(0) = 0 —
analytic normal modes ω = √(8 ∓ 2√10); the CI suite
checks the split and monolithic final states against the
mode superposition computed independently in the test,
pins the Jacobi > Gauss–Seidel deviation ordering, the
>5× iterated improvement, and the adaptive run's
deviation under its declared tolerance scale.

## Replay

Walker: `conkay_solve` cosim.fmi `{m1: 1, m2: 1, k1: 4,
kc: 6, initial: {x1: 1, v1: 0, x2: 0, v2: 0}, tEnd: 2,
method: "gauss-seidel", stepSize: 0.005, iterate:
{tolerance: 1e-10, maxIterations: 20}}`, target `cosim`
→ PASS, maxDeviation < 2e-3; target `fmu` →
NOT_COMPUTED `requires_engine_tier:sxe-15`.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
