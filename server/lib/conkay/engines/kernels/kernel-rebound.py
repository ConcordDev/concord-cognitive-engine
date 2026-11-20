#!/usr/bin/env python3
"""ConKay engine kernel: rebound (SXE-36).

Thin adapter over REBOUND (GPL-3; the kernel is the separate
child process and links nothing into the server). A test
particle on a circular orbit around a unit mass in REBOUND's
G = 1 units: the kernel reads the orbital period from
REBOUND's own orbital elements and integrates exactly one
period, requiring the particle to return to its starting
point. Acceptance is Kepler's third law, T = 2*pi*sqrt(a^3 /
(GM)), computed in-kernel.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect, 6 = engine failure.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def orbit(request):
    a = float(request.get("semiMajor", 1.0))
    if not (0.5 <= a <= 5.0):
        fail(2, "semiMajor out of envelope [0.5, 5]")
    try:
        import rebound
    except ImportError as exc:
        fail(3, "rebound import failed: %s" % exc)
    try:
        sim = rebound.Simulation()
        sim.add(m=1.0)
        sim.add(m=0.0, a=a, e=0.0)
        sim.move_to_com()
        p = sim.particles[1]
        period = float(p.calculate_orbit().P)
        x0, y0, z0 = p.x, p.y, p.z
        sim.integrate(period)
        dx = p.x - x0
        dy = p.y - y0
        dz = p.z - z0
        closure = math.sqrt(dx * dx + dy * dy + dz * dz)
    except Exception as exc:
        fail(6, "rebound integration failed: %s" % exc)
    expected = 2.0 * math.pi * math.sqrt(a ** 3)
    rel = abs(period - expected) / expected
    return {
        "period": period,
        "expectedPeriod": expected,
        "relError": rel,
        "closureError": closure,
        "converged": bool(rel <= 1e-6 and closure <= 1e-3),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = orbit({})
    elif op == "orbit":
        result = orbit(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
