#!/usr/bin/env python3
"""MPB kernel — SXE-18 (Meep row, MPB half).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health: band-edge frequencies of a 1-D
two-layer periodic stack (eps 12 / eps 1, equal halves, period a)
at the Brillouin-zone edge K = pi/a, computed by MPB (GPL-2, child
process), beside the analytic values the kernel finds by
root-solving the exact 1-D dispersion relation
  cos(K a) = cos(k1 d1) cos(k2 d2)
             - 0.5 (n1/n2 + n2/n1) sin(k1 d1) sin(k2 d2)
at K a = pi (band 2% — MPB's grid discretisation is the only
error source).

Ops:
  health / bands — request {epsHigh, resolution};
    defaults eps 12, res 32.

No mpb in the driver env is a provisioning defect: exit 3 naming
the import.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def dispersion_rhs(omega, n1, n2, d1, d2):
    # omega in units 2*pi*c/a with a = d1 + d2 = 1.
    k = 2.0 * math.pi * omega
    return math.cos(n1 * k * d1) * math.cos(n2 * k * d2) \
        - 0.5 * (n1 / n2 + n2 / n1) * math.sin(n1 * k * d1) \
        * math.sin(n2 * k * d2)


def zone_edge_frequencies(n1, n2, d1, d2, count=2):
    roots = []
    w, step = 1e-6, 5e-4
    prev = dispersion_rhs(w, n1, n2, d1, d2) + 1.0  # target cos(Ka) = -1
    while len(roots) < count and w < 2.0:
        w2 = w + step
        cur = dispersion_rhs(w2, n1, n2, d1, d2) + 1.0
        if prev == 0.0 or (prev < 0) != (cur < 0):
            lo, hi, flo = w, w2, prev
            for _ in range(80):
                mid = 0.5 * (lo + hi)
                fm = dispersion_rhs(mid, n1, n2, d1, d2) + 1.0
                if (flo < 0) != (fm < 0):
                    hi = mid
                else:
                    lo, flo = mid, fm
            roots.append(0.5 * (lo + hi))
        w, prev = w2, cur
    return roots


def run_bands(eps_high, resolution):
    try:
        import mpb
        import numpy as np
    except Exception as e:
        fail(3, "mpb import failed (%s) - the mpb driver env is "
                "not provisioned" % e)
    n1, n2 = math.sqrt(eps_high), 1.0
    d1 = d2 = 0.5
    geometry_lattice = mpb.Lattice(size=(1, 0, 0))
    geometry = [mpb.Block(size=(d1, 0, 0), center=(-0.25, 0, 0),
                          material=mpb.Medium(epsilon=eps_high)),
                mpb.Block(size=(d2, 0, 0), center=(0.25, 0, 0),
                          material=mpb.Medium(epsilon=1.0))]
    ms = mpb.ModeSolver(num_bands=4, k_points=[mpb.Vector3(0.5, 0, 0)],
                        geometry=geometry, geometry_lattice=geometry_lattice,
                        resolution=resolution)
    ms.run()
    freqs = sorted(float(f) for f in ms.all_freqs[0] if f > 1e-6)
    exact = zone_edge_frequencies(n1, n2, d1, d2, count=2)
    if len(freqs) < 2 or len(exact) < 2:
        fail(5, "band-edge extraction failed (mpb %r, analytic %r); "
                "refusing to serve" % (freqs, exact))
    rel = max(abs(f - e) / e for f, e in zip(freqs[:2], exact))
    return {"bandEdge1": freqs[0], "expectedBandEdge1": exact[0],
            "bandEdge2": freqs[1], "expectedBandEdge2": exact[1],
            "maxRelError": rel, "converged": rel < 0.02}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "bands"):
        eps = request.get("epsHigh", 12.0)
        res = request.get("resolution", 32)
        for name, v in (("epsHigh", eps), ("resolution", res)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_bands(float(eps), int(res))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
