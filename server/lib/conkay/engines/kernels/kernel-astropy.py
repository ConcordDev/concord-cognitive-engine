#!/usr/bin/env python3
"""ConKay engine kernel: astropy (SXE-36).

Thin adapter over Astropy (BSD-3). The kernel reads the
Earth's barycentric position at a fixed epoch from Astropy's
solar-system ephemeris machinery. `health` applies the
physical envelope: at any epoch the barycentric distance sits
within [0.98, 1.02] AU. `position` additionally compares
against the JPL Horizons reference vector for the epoch,
fetched once by the CI lane and stored (with provenance) in
CONKAY_ASTROPY_REF_XYZ_KM as "x,y,z" kilometres — the plan's
health case for this row. The comparison band depends on the
active ephemeris: 5,000 km per component with de440s (the
Horizons family), 300,000 km with Astropy's low-precision
built-in ephemeris, both named in the engine doc.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (engine or the stored
reference absent), 6 = engine failure.
"""
import json
import os
import sys

AU_KM = 149597870.7


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def earth_position(year):
    """Return (x, y, z) km barycentric and the ephemeris name."""
    from astropy.coordinates import (get_body_barycentric_posvel,
                                     solar_system_ephemeris)
    from astropy.time import Time

    ephemeris = "builtin"
    try:
        solar_system_ephemeris.set("de440s")
        ephemeris = "de440s"
    except Exception:
        solar_system_ephemeris.set("builtin")
        ephemeris = "builtin"
    t = Time("%04d-01-01 00:00:00" % year, scale="tt")
    pos, _vel = get_body_barycentric_posvel("earth", t)
    return (float(pos.x.to_value("km")), float(pos.y.to_value("km")),
            float(pos.z.to_value("km")), ephemeris)


def run(request, with_ref):
    year = int(request.get("epochYear", 2026))
    if not (2000 <= year <= 2050):
        fail(2, "epochYear out of envelope [2000, 2050]")
    try:
        x, y, z, ephemeris = earth_position(year)
    except ImportError as exc:
        fail(3, "astropy import failed: %s" % exc)
    except Exception as exc:
        fail(6, "astropy ephemeris failed: %s" % exc)
    distance_km = (x * x + y * y + z * z) ** 0.5
    result = {
        "xKm": x,
        "yKm": y,
        "zKm": z,
        "distanceKm": distance_km,
        "converged": bool(0.98 * AU_KM <= distance_km <= 1.02 * AU_KM),
    }
    if with_ref:
        raw = os.environ.get("CONKAY_ASTROPY_REF_XYZ_KM", "")
        parts = [p for p in raw.replace(";", ",").split(",") if p.strip()]
        if len(parts) != 3:
            fail(3, "JPL Horizons stored reference not recorded "
                    "(CONKAY_ASTROPY_REF_XYZ_KM); the lane records "
                    "it at first dispatch")
        try:
            ref = [float(p) for p in parts]
        except ValueError:
            fail(3, "stored reference is not numeric")
        band = 5000.0 if ephemeris == "de440s" else 300000.0
        err = max(abs(x - ref[0]), abs(y - ref[1]), abs(z - ref[2]))
        result["refErrorKm"] = err
        result["bandKm"] = band
        result["converged"] = bool(err <= band
                                   and result["converged"])
    return result


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = run({}, with_ref=False)
    elif op == "position":
        result = run(request, with_ref=True)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
