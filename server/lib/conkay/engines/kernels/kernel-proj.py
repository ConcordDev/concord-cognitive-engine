#!/usr/bin/env python3
"""PROJ kernel — SXE-35 (the plan §4 folded leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: pyproj's EPSG:4326 ->
EPSG:3857 transform of a fixed point (Poughkeepsie, NY) vs the
Web Mercator closed form computed independently in the kernel
(x = R * lambda, y = R * ln(tan(pi/4 + phi/2)), R = 6378137 —
the exact spherical formulas EPSG:3857 is defined by; band 1e-9
relative). The general op transforms any lon/lat by the same
route.

Ops:
  health / web-mercator — request {lon, lat}
    -> {xM, yM, expectedXM, expectedYM, maxRelError, converged}.

No pyproj in the driver env is a provisioning defect: exit 3.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


R = 6378137.0


def closed_form(lon, lat):
    lam = math.radians(lon)
    phi = math.radians(lat)
    return R * lam, R * math.log(math.tan(math.pi / 4.0 + phi / 2.0))


def run_transform(lon, lat):
    try:
        from pyproj import Transformer
    except Exception as e:
        fail(3, "pyproj import failed (%s) - the proj driver env "
                "is not provisioned" % e)
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857",
                                       always_xy=True)
    x, y = transformer.transform(lon, lat)
    ex, ey = closed_form(lon, lat)
    rel_x = abs(x - ex) / max(abs(ex), 1.0)
    rel_y = abs(y - ey) / max(abs(ey), 1.0)
    rel = max(rel_x, rel_y)
    return {"xM": float(x), "yM": float(y),
            "expectedXM": ex, "expectedYM": ey,
            "maxRelError": rel, "converged": rel <= 1e-9}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "web-mercator"):
        lon = request.get("lon", -73.9301)
        lat = request.get("lat", 41.7000)
        for name, val, lo, hi in (("lon", lon, -180.0, 180.0),
                                  ("lat", lat, -85.0, 85.0)):
            if not isinstance(val, (int, float)) \
                    or isinstance(val, bool) or not (lo <= val <= hi):
                fail(2, "%s must be a number in [%s, %s], got %r"
                        % (name, lo, hi, val))
        result = run_transform(float(lon), float(lat))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
