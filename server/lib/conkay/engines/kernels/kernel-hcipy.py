#!/usr/bin/env python3
"""ConKay engine kernel: hcipy (SXE-33).

Thin adapter over HCIPy (BSD-3), the high-contrast imaging
library. The kernel propagates a circular-aperture wavefront
through HCIPy's Fraunhofer propagator and measures the radius
of the first Airy null in the focal plane; acceptance is the
closed form 1.22 * lambda * f / D.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect, 6 = engine failure.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def airy(request):
    focal_m = float(request.get("focalM", 50.0))
    if not (5.0 <= focal_m <= 100.0):
        fail(2, "focalM out of envelope [5, 100]")
    wavelength = 650e-9
    diameter = 1.0
    try:
        import numpy as np
        from hcipy import (FraunhoferPropagator, Wavefront,
                           circular_aperture, make_pupil_grid)
    except ImportError as exc:
        fail(3, "hcipy import failed: %s" % exc)
    try:
        pupil_grid = make_pupil_grid(512, 4.0)
        aperture = circular_aperture(diameter)(pupil_grid)
        wf = Wavefront(aperture, wavelength)
        prop = FraunhoferPropagator(pupil_grid, focal_m)
        focal = prop(wf)
        intensity = np.asarray(focal.intensity, dtype=float)
        n = int(round(intensity.size ** 0.5))
        img = intensity.reshape(n, n)
        xs = np.asarray(focal.grid.x, dtype=float).reshape(n, n)
        centre = n // 2
        profile = img[centre, centre:]
        xrow = xs[centre, centre:]
        expected = 1.22 * wavelength * focal_m / diameter
        # First local minimum of the centre-row profile inside
        # [0.5, 2.0] x the closed-form null radius.
        null_r = None
        for i in range(2, len(profile) - 1):
            if xrow[i] < 0.5 * expected:
                continue
            if xrow[i] > 2.0 * expected:
                break
            if profile[i] <= profile[i - 1] and profile[i] <= profile[i + 1]:
                null_r = float(xrow[i])
                break
        if null_r is None:
            fail(6, "no Airy null found in the focal-plane profile")
    except SystemExit:
        raise
    except Exception as exc:
        fail(6, "hcipy propagation failed: %s" % exc)
    rel = abs(null_r - expected) / expected
    return {
        "nullRadiusM": null_r,
        "expectedNullRadiusM": expected,
        "relError": rel,
        "converged": bool(rel <= 0.10),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = airy({})
    elif op == "airy":
        result = airy(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
