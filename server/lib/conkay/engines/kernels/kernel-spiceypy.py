#!/usr/bin/env python3
"""ConKay engine kernel: spiceypy (SXE-36).

Thin adapter over SpiceyPy (MIT), the Python wrapper for
NAIF's SPICE toolkit. The NAIF kernels are provisioned data:
the lane downloads the leapseconds, planetary-constants, and
DE440s ephemeris kernels into CONKAY_SPICE_KERNEL_DIR; the
kernel furnishes only from that directory and never downloads.
`health` applies the physical envelope on the Earth-Sun
distance at a fixed epoch ([0.98, 1.02] AU). `position`
additionally compares the heliocentric Earth position against
the JPL Horizons reference vector stored by the lane in
CONKAY_SPICE_REF_XYZ_KM ("x,y,z" km), band 1,000 km per
component (DE440s and Horizons' DE441 agree for Earth well
inside that band).

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (engine, kernel data, or the
stored reference absent), 6 = engine failure.
"""
import json
import os
import sys

AU_KM = 149597870.7
KERNEL_FILES = ("naif0012.tls", "pck00010.tpc", "de440s.bsp")


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def furnish(spice):
    data_dir = os.environ.get("CONKAY_SPICE_KERNEL_DIR", "")
    if not data_dir:
        # Standard lane provisioning location.
        data_dir = "/opt/concord-engines/spiceypy/kernels"
    if not os.path.isdir(data_dir):
        fail(3, "NAIF kernel data not provisioned "
                "(CONKAY_SPICE_KERNEL_DIR); the lane downloads "
                "the kernels at install")
    for name in KERNEL_FILES:
        path = os.path.join(data_dir, name)
        if not os.path.isfile(path):
            fail(3, "NAIF kernel file missing: %s" % name)
        spice.furnsh(path)


def run(request, with_ref):
    year = int(request.get("epochYear", 2026))
    if not (2000 <= year <= 2050):
        fail(2, "epochYear out of envelope [2000, 2050]")
    try:
        import spiceypy as spice
    except ImportError as exc:
        fail(3, "spiceypy import failed: %s" % exc)
    furnish(spice)
    try:
        et = spice.str2et("%04d JAN 01 00:00:00 TDB" % year)
        state, _lt = spice.spkezr("EARTH", et, "J2000", "NONE", "SUN")
        x, y, z = float(state[0]), float(state[1]), float(state[2])
    except Exception as exc:
        fail(6, "spice evaluation failed: %s" % exc)
    finally:
        try:
            spice.kclear()
        except Exception:
            pass
    distance_km = (x * x + y * y + z * z) ** 0.5
    result = {
        "xKm": x,
        "yKm": y,
        "zKm": z,
        "distanceKm": distance_km,
        "converged": bool(0.98 * AU_KM <= distance_km <= 1.02 * AU_KM),
    }
    if with_ref:
        raw = os.environ.get("CONKAY_SPICE_REF_XYZ_KM", "")
        parts = [p for p in raw.replace(";", ",").split(",") if p.strip()]
        if len(parts) != 3:
            fail(3, "JPL Horizons stored reference not recorded "
                    "(CONKAY_SPICE_REF_XYZ_KM); the lane records "
                    "it at first dispatch")
        try:
            ref = [float(p) for p in parts]
        except ValueError:
            fail(3, "stored reference is not numeric")
        err = max(abs(x - ref[0]), abs(y - ref[1]), abs(z - ref[2]))
        result["refErrorKm"] = err
        result["converged"] = bool(err <= 1000.0 and result["converged"])
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
