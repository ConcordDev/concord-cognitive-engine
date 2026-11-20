#!/usr/bin/env python3
"""ConKay engine kernel: skyfield (SXE-36).

Thin adapter over Skyfield (MIT) with the JPL DE421 ephemeris
(the lane pre-downloads de421.bsp into CONKAY_SKYFIELD_DATA;
the kernel never downloads). `health` applies the physical
envelope on the Earth-Sun distance at a fixed epoch (within
[0.98, 1.02] AU — early January sits near perihelion,
~0.983 AU). `position` additionally compares Skyfield's
barycentric Earth position against the JPL Horizons reference
vector stored by the lane in CONKAY_SKYFIELD_REF_XYZ_KM
("x,y,z" km), band 5,000 km per component.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (engine, ephemeris data, or
the stored reference absent), 6 = engine failure.
"""
import json
import os
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def load_ephemeris():
    from skyfield.api import Loader

    data_dir = os.environ.get("CONKAY_SKYFIELD_DATA",
                              os.path.expanduser("~/.skyfield"))
    load = Loader(data_dir, verbose=False)
    try:
        return load("de421.bsp"), load.timescale()
    except Exception as exc:
        fail(3, "skyfield ephemeris data not provisioned "
                "(de421.bsp): %s" % exc)


def run(request, with_ref):
    year = int(request.get("epochYear", 2026))
    if not (2000 <= year <= 2050):
        fail(2, "epochYear out of envelope [2000, 2050]")
    try:
        eph, ts = load_ephemeris()
    except ImportError as exc:
        fail(3, "skyfield import failed: %s" % exc)
    try:
        t = ts.tt(year, 1, 1)
        earth = eph["earth"]
        sun = eph["sun"]
        distance_au = float(earth.at(t).observe(sun).distance().au)
        bx, by, bz = earth.at(t).position.km
    except SystemExit:
        raise
    except Exception as exc:
        fail(6, "skyfield evaluation failed: %s" % exc)
    result = {
        "xKm": float(bx),
        "yKm": float(by),
        "zKm": float(bz),
        "distanceAu": distance_au,
        "converged": bool(0.98 <= distance_au <= 1.02),
    }
    if with_ref:
        raw = os.environ.get("CONKAY_SKYFIELD_REF_XYZ_KM", "")
        parts = [p for p in raw.replace(";", ",").split(",") if p.strip()]
        if len(parts) != 3:
            fail(3, "JPL Horizons stored reference not recorded "
                    "(CONKAY_SKYFIELD_REF_XYZ_KM); the lane records "
                    "it at first dispatch")
        try:
            ref = [float(p) for p in parts]
        except ValueError:
            fail(3, "stored reference is not numeric")
        err = max(abs(result["xKm"] - ref[0]),
                  abs(result["yKm"] - ref[1]),
                  abs(result["zKm"] - ref[2]))
        result["refErrorKm"] = err
        result["converged"] = bool(err <= 5000.0 and result["converged"])
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
