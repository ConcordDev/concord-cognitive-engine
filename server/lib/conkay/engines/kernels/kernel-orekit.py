#!/usr/bin/env python3
"""ConKay engine kernel: orekit (SXE-36).

Thin adapter over Orekit (Apache-2.0) via its Python wrapper.
The kernel builds a Keplerian orbit, reads its period from
Orekit, and propagates exactly one period with Orekit's
analytic Keplerian propagator, requiring the state to close
on itself. Acceptance: the period matches Kepler's third law
computed in-kernel, 2*pi*sqrt(a^3/mu), and the one-period
closure error is under a metre (the analytic propagator
closes to numerical precision). The Orekit data set
(OREKIT_DATA, the standard orekit-data directory) is
provisioned by the lane; the kernel never downloads.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (wrapper or data absent),
6 = engine failure.
"""
import json
import math
import os
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def orbit(request):
    a_km = float(request.get("semiMajorKm", 7000.0))
    if not (6600.0 <= a_km <= 42000.0):
        fail(2, "semiMajorKm out of envelope [6600, 42000]")
    try:
        import orekit
        orekit.initVM()
        from orekit.pyhelpers import setup_orekit_curdir
    except ImportError as exc:
        fail(3, "orekit import failed: %s" % exc)
    data = os.environ.get("OREKIT_DATA", "")
    if not data:
        # Standard lane provisioning location.
        data = "/opt/concord-engines/orekit-data"
    if not os.path.isdir(data):
        fail(3, "orekit data not provisioned (OREKIT_DATA); the "
                "lane downloads orekit-data at install")
    try:
        setup_orekit_curdir(data)
        from org.orekit.frames import FramesFactory
        from org.orekit.orbits import KeplerianOrbit, PositionAngleType
        from org.orekit.propagation.analytical import KeplerianPropagator
        from org.orekit.time import AbsoluteDate, TimeScalesFactory
        from org.orekit.utils import Constants

        utc = TimeScalesFactory.getUTC()
        date = AbsoluteDate(2026, 1, 1, 0, 0, 0.0, utc)
        mu = Constants.EGM96_EARTH_MU
        a = a_km * 1000.0
        orbit0 = KeplerianOrbit(a, 0.001, math.radians(28.5),
                                0.0, 0.0, 0.0,
                                PositionAngleType.TRUE,
                                FramesFactory.getEME2000(), date, mu)
        period = float(orbit0.getKeplerianPeriod())
        propagator = KeplerianPropagator(orbit0)
        final = propagator.propagate(date.shiftedBy(period))
        p0 = orbit0.getPVCoordinates().getPosition()
        p1 = final.getPVCoordinates().getPosition()
        dx = float(p1.getX()) - float(p0.getX())
        dy = float(p1.getY()) - float(p0.getY())
        dz = float(p1.getZ()) - float(p0.getZ())
        closure = math.sqrt(dx * dx + dy * dy + dz * dz)
    except SystemExit:
        raise
    except Exception as exc:
        fail(6, "orekit propagation failed: %s" % exc)
    expected = 2.0 * math.pi * math.sqrt((a_km * 1000.0) ** 3
                                         / 3.986004415e14)
    rel = abs(period - expected) / expected
    return {
        "periodS": period,
        "expectedPeriodS": expected,
        "relError": rel,
        "closureErrorM": closure,
        "converged": bool(rel <= 1e-6 and closure <= 1.0),
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
