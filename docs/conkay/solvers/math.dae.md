# math.dae — differential-algebraic equations (SX-NUM-08)

Semi-explicit **index-1** DAEs at the JS tier:

    y' = f(t, y, z),   0 = g(t, y, z)

with f and g as **data** — expression lists over the
math.symbolic grammar (variables `t`, `y0..`, `z0..`).
Integration is SDIRK2 (Alexander 1977: singly diagonally
implicit, L-stable, order 2) with modified-Newton stage solves
over a finite-difference Jacobian and adaptive step control.
Code: `server/lib/conkay/physics/solvers/dae.js`
(registry solver, L3).

## Consistency is solved, never assumed

The algebraic state at t0 is solved from g(t0, y0, z) = 0 and
**reported** in the inputs echo. A caller-supplied z0 that
disagrees is replaced by the solved value and the correction is
named in the record. A constraint whose Jacobian in z is
singular cannot be solved — NOT_COMPUTED
`not_index_1_or_inconsistent`. General index reduction
(Pantelides) and IDA are the SUNDIALS engine tier, refused by
name.

## The pendulum target (the reference problem)

The Hairer & Wanner Cartesian pendulum is index-3 as posed. The
`pendulum` target decides it through its twice-differentiated
constraint — the standard analytic reduction — which is an
index-1 system in (x, y, vx, vy; λ). The solver reports the
**original constraint drift** and the **energy drift** over the
run. The drift behaviour is the known property of the reduced
formulation (Hairer & Wanner II): energy stays tight (measured
relative drift 9.3e-7 over 10 s at tol 1e-7) while the original
constraint drifts slowly (measured 1.5e-6 over the same run) —
both numbers ship in the output, so a caller sees the drift
rather than trusting a bound.

## Grammar note

Indexed variable names (y0, z12) required the math.symbolic
tokenizer to accept digits after the first letter of an
identifier — a one-line grammar fix landed with this ticket in
`math-symbolic.js`; the SX-NUM-01 and SX-NUM-07 suites pass
unchanged against it.

## Reference + locator

Hairer & Wanner, *Solving Ordinary Differential Equations II*
— the Cartesian pendulum test problem and the Robertson
chemistry DAE. CI reference cases: a manufactured index-1 DAE
with the exact solution y = sin t, z = cos t (including the
inconsistent-z0 correction path); Robertson at t = 0.4 against
the literature state (y ≈ 0.985172, 3.3862e-5, 0.014794) with
mass conservation asserted to 1e-9; the pendulum's energy and
constraint drift bounds.

## Replay

Walker: `conkay_solve` math.dae `{f: ["z0"], g: ["z0 - cos(t)"],
y0: [0], t0: 0, t1: 1.5707963267948966, tol: 1e-10}`, target
`dae` → PASS, y = 1 within 1e-8, inputs echo carries the solved
z0 = 1; `{theta0: 0.5, omega0: 0, t1: 10, tol: 1e-7}`, target
`pendulum` → PASS with both drift figures in the output.
Reachability via solve.direct rides SC-00 (named foundation);
the MCP/chain paths reach the registry entry as registered.
