#!/usr/bin/env python3
"""CasADi kernel — SXE-20 (controls set, CasADi leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a projection NLP with an
exact closed form — minimise (x-cx)^2 + (y-cy)^2 subject to
x + y = s. The solution is the orthogonal projection of (cx, cy)
onto the line: with d = (cx + cy - s)/2, x* = cx - d, y* = cy - d,
f* = 2*d^2. The kernel solves with CasADi's Opti + the bundled
IPOPT (CasADi LGPL-3, separate process) and compares against the
closed form computed independently in the kernel (band 1e-6).

Ops:
  health / nlp — request {cx, cy, s}; defaults (2, 0, 0)
    -> (x, y) = (1, -1), f = 2 exactly.

No casadi in the driver env is a provisioning defect: exit 3
naming the import. A solver failure raises (exit 6) rather than
serving an unconverged point.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_nlp(cx, cy, s):
    try:
        import casadi as ca
    except Exception as e:
        fail(3, "casadi import failed (%s) - the casadi driver env "
                "is not provisioned" % e)
    opti = ca.Opti()
    x = opti.variable()
    y = opti.variable()
    opti.minimize((x - cx) ** 2 + (y - cy) ** 2)
    opti.subject_to(x + y == s)
    opti.solver("ipopt", {"print_time": False},
                {"print_level": 0})
    try:
        sol = opti.solve()
    except Exception as e:
        fail(6, "CasADi/IPOPT failed to solve the projection NLP: %s" % e)
    gx, gy = float(sol.value(x)), float(sol.value(y))
    gf = float(sol.value((x - cx) ** 2 + (y - cy) ** 2))
    d = (cx + cy - s) / 2.0
    ex, ey, ef = cx - d, cy - d, 2.0 * d * d
    err = max(abs(gx - ex), abs(gy - ey), abs(gf - ef))
    scale = max(1.0, abs(ef))
    rel = err / scale
    return {"x": gx, "y": gy, "objective": gf,
            "expectedX": ex, "expectedY": ey, "expectedObjective": ef,
            "maxRelError": rel, "converged": rel < 1e-6}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "nlp"):
        cx = request.get("cx", 2.0)
        cy = request.get("cy", 0.0)
        s = request.get("s", 0.0)
        for name, v in (("cx", cx), ("cy", cy), ("s", s)):
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                fail(2, "%s must be a number, got %r" % (name, v))
        result = run_nlp(float(cx), float(cy), float(s))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
