#!/usr/bin/env python3
"""ConKay engine kernel: sgp4 (SXE-36).

Thin adapter over the python-sgp4 propagator (MIT). The kernel
propagates the documented Vanguard 1 test TLE (the worked
example in the sgp4 package documentation) and checks the
physics SGP4 must respect over a short arc: the orbital radius
stays inside the envelope the TLE's own elements imply, and
the specific orbital energy and angular momentum — conserved
by the two-body part of the model — drift by less than 0.5%
over 600 s (the residual is SGP4's secular/drag modelling,
named in the engine doc).

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect, 6 = engine failure.
"""
import json
import math
import sys

MU = 398600.8  # km^3/s^2, WGS72 — the constant set the TLE rides

L1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753"
L2 = "2 00005  34.2682 348.7242 1859667 -35.0422 130.0511 10.82419157413667"


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def state_at(sat, minutes):
    jd, fr = sat.jdsatepoch, sat.jdsatepochF
    # Advance the epoch Julian date by the requested minutes.
    total = jd + fr + minutes / 1440.0
    jd_i = math.floor(total)
    return sat.sgp4(jd_i, total - jd_i)


def invariants(r, v):
    rn = math.sqrt(sum(c * c for c in r))
    vn2 = sum(c * c for c in v)
    energy = vn2 / 2.0 - MU / rn
    hx = r[1] * v[2] - r[2] * v[1]
    hy = r[2] * v[0] - r[0] * v[2]
    hz = r[0] * v[1] - r[1] * v[0]
    return rn, energy, math.sqrt(hx * hx + hy * hy + hz * hz)


def propagate(request):
    minutes = float(request.get("minutes", 0.0))
    if not (0.0 <= minutes <= 600.0):
        fail(2, "minutes out of envelope [0, 600]")
    try:
        from sgp4.api import SGP4_ERRORS, Satrec, WGS72
    except ImportError as exc:
        fail(3, "sgp4 import failed: %s" % exc)
    try:
        sat = Satrec.twoline2rv(L1, L2, WGS72)
        e0, r0, v0 = state_at(sat, 0.0)
        if e0 != 0:
            fail(6, "sgp4 epoch propagation error: %s"
                 % SGP4_ERRORS.get(e0, e0))
        e1, r1, v1 = state_at(sat, minutes)
        if e1 != 0:
            fail(6, "sgp4 propagation error: %s"
                 % SGP4_ERRORS.get(e1, e1))
        e2, r2, v2 = state_at(sat, 600.0)
        if e2 != 0:
            fail(6, "sgp4 propagation error: %s"
                 % SGP4_ERRORS.get(e2, e2))
    except SystemExit:
        raise
    except Exception as exc:
        fail(6, "sgp4 failed: %s" % exc)
    rn0, en0, h0 = invariants(r0, v0)
    rn1, _en1, _h1 = invariants(r1, v1)
    rn2, en2, h2 = invariants(r2, v2)
    speed1 = math.sqrt(sum(c * c for c in v1))
    energy_drift = abs(en2 - en0) / abs(en0)
    angmom_drift = abs(h2 - h0) / h0
    return {
        "radiusKm": rn1,
        "speedKmS": speed1,
        "energyDrift": energy_drift,
        "angMomDrift": angmom_drift,
        "converged": bool(6000.0 <= rn1 <= 45000.0
                          and energy_drift <= 0.005
                          and angmom_drift <= 0.005),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = propagate({})
    elif op == "propagate":
        result = propagate(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
