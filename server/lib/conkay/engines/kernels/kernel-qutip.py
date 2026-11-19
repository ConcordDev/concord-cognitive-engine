#!/usr/bin/env python3
"""QuTiP kernel — SXE-32.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): Rabi
oscillation period vs 2*pi/Omega. A two-level system with
H = (Omega/2) * sigmax, started in |0>, must be fully in |1> at
t = pi/Omega (half period) and back in |0> at t = 2*pi/Omega
(full period). The kernel integrates with QuTiP's mesolve and
serves both populations (bands: P1(half) > 0.999, P1(full) <
1e-3) — a period check with no curve fitting.

Ops:
  health / rabi — request {omega}; default Omega = 1
    -> period 2*pi.

No qutip in the driver env is a provisioning defect: exit 3
naming the import.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_rabi(omega):
    try:
        import numpy as np
        import qutip as qt
    except Exception as e:
        fail(3, "qutip import failed (%s) - the qutip driver env "
                "is not provisioned" % e)
    H = 0.5 * omega * qt.sigmax()
    psi0 = qt.basis(2, 0)
    period = 2.0 * math.pi / omega
    tlist = np.array([0.0, period / 2.0, period])
    out = qt.mesolve(H, psi0, tlist, [], [qt.sigmaz()])
    z = out.expect[0]
    p1_half = (1.0 - float(z[1])) / 2.0
    p1_full = (1.0 - float(z[2])) / 2.0
    return {"periodS": period, "pExcitedHalfPeriod": p1_half,
            "pExcitedFullPeriod": p1_full,
            "converged": p1_half > 0.999 and p1_full < 1e-3}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "rabi"):
        omega = request.get("omega", 1.0)
        if not isinstance(omega, (int, float)) or isinstance(omega, bool) \
                or omega <= 0:
            fail(2, "omega must be a positive number, got %r" % (omega,))
        result = run_rabi(float(omega))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
