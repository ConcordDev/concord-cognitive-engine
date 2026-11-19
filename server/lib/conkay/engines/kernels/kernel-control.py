#!/usr/bin/env python3
"""python-control kernel — SXE-20 (controls set, python-control leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): LQR on a
double integrator against the analytic Riccati solution. For
A = [[0,1],[0,0]], B = [[0],[1]], Q = diag(q1, q2), R = r, the
continuous algebraic Riccati equation has the closed form
  p12 = sqrt(q1*r),  p22 = sqrt(r*(q2 + 2*p12)),  K = [p12/r, p22/r]
which the kernel computes independently of python-control's
solver and compares (band 1e-6); closed-loop eigenvalues must
also be strictly stable. python-control is BSD-3; its slycot
dependency (GPL-2) runs only inside this child process.

Ops:
  health / lqr — request {q1, q2, r}; defaults Q=I, R=1
    -> K = [1, sqrt(3)].

No python-control in the driver env is a provisioning defect:
exit 3 naming the import.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_lqr(q1, q2, r):
    try:
        import control
        import numpy as np
    except Exception as e:
        fail(3, "python-control import failed (%s) - the control "
                "driver env is not provisioned" % e)
    A = np.array([[0.0, 1.0], [0.0, 0.0]])
    B = np.array([[0.0], [1.0]])
    Q = np.diag([q1, q2])
    R = np.array([[r]])
    K, _S, _E = control.lqr(A, B, Q, R)
    k_got = [float(K[0, 0]), float(K[0, 1])]
    p12 = math.sqrt(q1 * r)
    p22 = math.sqrt(r * (q2 + 2.0 * p12))
    k_exact = [p12 / r, p22 / r]
    rel = max(abs(g - e) / abs(e) for g, e in zip(k_got, k_exact))
    eig = np.linalg.eigvals(A - B @ K)
    stable = bool(np.all(np.real(eig) < 0))
    return {"k": k_got, "kAnalytic": k_exact, "maxRelError": rel,
            "closedLoopStable": stable,
            "converged": rel < 1e-6 and stable}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "lqr"):
        q1 = request.get("q1", 1.0)
        q2 = request.get("q2", 1.0)
        r = request.get("r", 1.0)
        for name, v in (("q1", q1), ("q2", q2), ("r", r)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_lqr(float(q1), float(q2), float(r))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
