#!/usr/bin/env python3
"""ConKay engine kernel: poppy (SXE-33).

Thin adapter over POPPY (BSD-3), the physical-optics
propagation library. The kernel propagates a 650 nm wavefront
through a 1 m circular aperture with POPPY's Fraunhofer model
and measures the radius of the first Airy null on the
detector; acceptance is the closed form 1.22 * lambda / D in
angle.

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


def airy(request):
    wavelength_nm = float(request.get("wavelengthNm", 650.0))
    if not (400.0 <= wavelength_nm <= 1000.0):
        fail(2, "wavelengthNm out of envelope [400, 1000]")
    diameter = 1.0
    try:
        import numpy as np
        import poppy
    except ImportError as exc:
        fail(3, "poppy import failed: %s" % exc)
    try:
        osys = poppy.OpticalSystem()
        osys.add_pupil(poppy.CircularAperture(radius=diameter / 2.0))
        # Detector sampling: 0.02 arcsec/pixel puts the 650 nm
        # null (~0.164 arcsec) at ~8 pixels.
        osys.add_detector(pixelscale=0.02, fov_pixels=512)
        psf = osys.calc_psf(wavelength=wavelength_nm * 1e-9)
        data = np.asarray(psf[0].data, dtype=float)
        n = data.shape[0]
        centre = n // 2
        profile = data[centre, centre:]
        expected_rad = 1.22 * (wavelength_nm * 1e-9) / diameter
        expected_arcsec = expected_rad * 206264.806
        px_arcsec = 0.02
        null_px = None
        for i in range(2, len(profile) - 1):
            r_arcsec = i * px_arcsec
            if r_arcsec < 0.5 * expected_arcsec:
                continue
            if r_arcsec > 2.0 * expected_arcsec:
                break
            if profile[i] <= profile[i - 1] and profile[i] <= profile[i + 1]:
                null_px = i
                break
        if null_px is None:
            fail(6, "no Airy null found in the POPPY PSF profile")
        null_arcsec = null_px * px_arcsec
    except SystemExit:
        raise
    except Exception as exc:
        fail(6, "poppy propagation failed: %s" % exc)
    rel = abs(null_arcsec - expected_arcsec) / expected_arcsec
    return {
        "nullArcsec": null_arcsec,
        "expectedNullArcsec": expected_arcsec,
        "relError": rel,
        "converged": bool(rel <= 0.15),
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
