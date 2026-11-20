#!/usr/bin/env python3
"""ConKay engine kernel: rayoptics (SXE-33).

Thin adapter over the rayoptics sequential ray-trace library
(BSD-3). The kernel builds a symmetric biconvex singlet through
rayoptics' paraxial model and serves its effective focal length;
acceptance is the thick-lens lensmaker equation computed
in-kernel from the same curvatures, thickness, and refractive
index (the index value 1.5168 is the N-BK7 d-line index as
tabulated by refractiveindex.info, the plan's data source for
this row).

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = the request itself is
out of envelope (the wrapper never sees those; validation here is
defence in depth), 3 = provisioning defect (engine absent or
unusable on this host), 6 = the engine ran but failed.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def lensmaker_mm(n, radius_mm, thickness_mm):
    """Thick-lens lensmaker power for a symmetric biconvex lens
    with R1 = +R, R2 = -R: Phi = (n-1)[1/R1 - 1/R2 +
    (n-1)d / (n R1 R2)], focal length 1/Phi in mm."""
    r1 = radius_mm
    r2 = -radius_mm
    power = (n - 1.0) * (1.0 / r1 - 1.0 / r2
                         + (n - 1.0) * thickness_mm / (n * r1 * r2))
    return 1.0 / power


def rayoptics_efl_mm(n, radius_mm, thickness_mm):
    """Build the singlet in rayoptics and read the paraxial EFL."""
    from rayoptics.environment import OpticalPath

    op = OpticalPath()
    sm = op.seq_model
    # Object surface, then the two lens surfaces, then image.
    sm.add_surface([0.0, 0.0])
    sm.add_surface([radius_mm, thickness_mm, ("Glass", n)])
    sm.add_surface([-radius_mm, 0.0])
    sm.add_surface([0.0, 0.0])
    op.update_model()
    pm = sm.paraxial_model
    efl = None
    fod = getattr(pm, "fod", None)
    if fod is not None:
        efl = getattr(fod, "efl", None)
    if efl is None:
        # Fall back to the paraxial system matrix: for a system in
        # air, EFL = -1 / C.
        mtx = getattr(pm, "sys_matrix", None)
        if mtx is not None:
            c = float(mtx[1][0])
            if c != 0.0:
                efl = -1.0 / c
    if efl is None:
        fail(6, "rayoptics paraxial model exposed no focal length")
    return abs(float(efl))


def focal_length(request):
    n = float(request.get("indexN", 1.5168))
    radius = float(request.get("radiusMm", 100.0))
    thickness = 5.0
    if not (1.4 <= n <= 2.0):
        fail(2, "indexN out of envelope [1.4, 2.0]")
    if not (20.0 <= radius <= 500.0):
        fail(2, "radiusMm out of envelope [20, 500]")
    try:
        efl = rayoptics_efl_mm(n, radius, thickness)
    except ImportError as exc:
        fail(3, "rayoptics import failed: %s" % exc)
    except SystemExit:
        raise
    except Exception as exc:  # engine ran but failed
        fail(6, "rayoptics build failed: %s" % exc)
    expected = lensmaker_mm(n, radius, thickness)
    rel = abs(efl - expected) / expected
    return {
        "focalLengthMm": efl,
        "expectedFocalLengthMm": expected,
        "relError": rel,
        "converged": bool(rel <= 0.01),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = focal_length({})
    elif op == "focal-length":
        result = focal_length(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
