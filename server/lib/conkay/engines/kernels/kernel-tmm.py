#!/usr/bin/env python3
"""ConKay engine kernel: tmm (SXE-33).

Thin adapter over the tmm transfer-matrix optics library (MIT).
The kernel evaluates the reflectance of a single dielectric film
on a substrate with tmm's coherent solver; acceptance is the
closed-form Airy (characteristic-matrix) result for the same
stack computed in-kernel — a different code path to the same
published mathematics, so agreement validates the adapter.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect, 6 = engine failure.
"""
import cmath
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def airy_reflectance(wavelength_nm, film_nm, n_film, n_sub):
    """Closed-form power reflectance of one film (normal
    incidence, s-polarisation), semi-infinite substrate."""
    r01 = (1.0 - n_film) / (1.0 + n_film)
    r12 = (n_film - n_sub) / (n_film + n_sub)
    beta = 2.0 * math.pi * n_film * film_nm / wavelength_nm
    r = (r01 + r12 * cmath.exp(2j * beta)) / (1.0 + r01 * r12
                                              * cmath.exp(2j * beta))
    return abs(r) ** 2


def reflectance(request):
    wavelength = float(request.get("wavelengthNm", 550.0))
    film = float(request.get("filmNm", 100.0))
    if not (300.0 <= wavelength <= 1200.0):
        fail(2, "wavelengthNm out of envelope [300, 1200]")
    if not (10.0 <= film <= 500.0):
        fail(2, "filmNm out of envelope [10, 500]")
    n_film = 1.46
    n_sub = 1.52
    try:
        from tmm import coh_tmm
    except ImportError as exc:
        fail(3, "tmm import failed: %s" % exc)
    try:
        out = coh_tmm("s", [1.0, n_film, n_sub],
                      [float("inf"), film, float("inf")],
                      0.0, wavelength)
        r_val = float(out["R"])
    except Exception as exc:
        fail(6, "tmm evaluation failed: %s" % exc)
    expected = airy_reflectance(wavelength, film, n_film, n_sub)
    err = abs(r_val - expected)
    return {
        "reflectance": r_val,
        "expectedReflectance": expected,
        "absError": err,
        "converged": bool(err <= 1e-6),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = reflectance({})
    elif op == "reflectance":
        result = reflectance(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
