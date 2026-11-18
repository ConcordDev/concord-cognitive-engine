# math.dde — delay differential equations (SX-NUM-18)

Delay equations y′(t) = f(t, y(t), y(t − τ)) by the method
of steps. Code: `server/lib/conkay/physics/solvers/dde.js`
(registry solver, L2). Reference: Bellen & Zennaro,
*Numerical Methods for Delay Differential Equations*.

## Method

RK4 on a uniform grid; delayed values come from the cubic
Hermite dense output over the stored grid (values + slopes),
with the caller's history function supplying everything
before t0. Every answer is gated by a **step-doubling
estimate**: the problem is solved at m and 2m steps per
delay, and the two solutions must agree at the output points
within the declared tolerance or the call refuses with the
estimate named.

The history is a required declared input — a DDE without
its history is a different problem for every reader, so
there is no default (SC-03).

## Reference case

The catalogue's named problem: y′ = −y(t−1), y = 1 on
[−1, 0], with the known solution 1 − t on [0, 1] and
t²/2 − 2t + 3/2 on [1, 2] — CI reproduces y(1) = 0,
y(1.5) = −0.375, y(2) = −0.5 to 1e-5 with the estimate
inside tolerance. (The problem's pieces are polynomials, so
it is integrated essentially exactly at any grid; the
step-doubling refusal pin therefore uses a transcendental
history, where a coarse grid carries a real estimate.)

## Envelope

Constant delays. State-dependent delays are follow-on
scope, named in the refusal rather than silently treated
as constant.

## Replay

Walker: `conkay_solve` math.dde `{f: "-d0", tau: 1,
history: "1", t1: 2, points: [1, 2]}`, target `solve` →
PASS with y = 0 and −0.5; `{f: "-d0", tau: 1, t1: 1,
points: [1]}` → NOT_COMPUTED `missing_input:history`.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
