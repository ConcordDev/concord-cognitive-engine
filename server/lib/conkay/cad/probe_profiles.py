#!/usr/bin/env python3
# server/lib/conkay/cad/probe_profiles.py
#
# Shape probes of a cad.body STEP file by ray casting (IntCurvesFace), the receipts
# behind kernel 2.2's two fixes. Optional tool (OCP, the kernel's venv); not used
# by the solver. Deterministic: same STEP + same arguments, same JSON.
#   probe_profiles.py BODY.step [--hood-x 0.6,0.8,1.0,1.2,1.4,1.6] [--door-z 0.65,0.75,0.85]
#                               [--door-x 1.8,3.6] [--bulge-x 2.2,2.9]
#   hood: top z(y) across the car at each station x; valleyMm = the deepest point below the
#         section's upper convex hull (mirrored about y = 0): the hood-to-fender valley
#   door: half width y(x) at each height z over door-x; dipMm = the bulge (max over bulge-x)
#         minus the lowest point after it, unless the side regains it before door-x ends;
#         maxD2 = the largest |second difference| of y(x) at 20 mm spacing (1/m)

import sys, json

from OCP.STEPControl import STEPControl_Reader
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.gp import gp_Lin, gp_Pnt, gp_Dir


def arg(name, default):
    a = sys.argv
    return [float(v) for v in a[a.index(name) + 1].split(",")] if name in a else default


def main():
    rd = STEPControl_Reader()
    if rd.ReadFile(sys.argv[1]) != 1:
        raise SystemExit(f"cannot read {sys.argv[1]}")
    rd.TransferRoots()
    it = IntCurvesFace_ShapeIntersector()
    it.Load(rd.OneShape(), 1e-7)

    def far(o, d):
        it.Perform(gp_Lin(gp_Pnt(*o), gp_Dir(*d)), 0, 10)
        ws = [it.WParameter(i) for i in range(1, it.NbPnt() + 1)]
        return max(ws) if ws else None

    def hull_depth(pts):
        pts = sorted(pts)
        H = []
        for p in pts:
            while len(H) >= 2 and (H[-1][0] - H[-2][0]) * (p[1] - H[-2][1]) - (H[-1][1] - H[-2][1]) * (p[0] - H[-2][0]) >= 0:
                H.pop()
            H.append(p)
        best = (0.0, None)
        for x, z in pts:
            for a, b in zip(H, H[1:]):
                if a[0] <= x <= b[0] and b[0] > a[0]:
                    h = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
                    if h - z > best[0]:
                        best = (h - z, x)
                    break
        return best

    out = {"hood": {}, "door": {}}
    for x in arg("--hood-x", [0.6, 0.8, 1.0, 1.2, 1.4, 1.6]):
        prof = []
        for j in range(96):
            y = 0.01 * j
            t = far((x, y, -0.5), (0, 0, 1))
            if t is not None:
                prof.append((y, t - 0.5))
        d, at = hull_depth([(-y, z) for y, z in prof[1:]] + prof)
        out["hood"][str(x)] = {"valleyMm": round(d * 1000, 2), "atAbsY": round(abs(at), 3) if at is not None else None}
    x0, x1 = arg("--door-x", [1.8, 3.6])
    b0, b1 = arg("--bulge-x", [2.2, 2.9])
    for z in arg("--door-z", [0.65, 0.75, 0.85]):
        n = int(round((x1 - x0) / 0.02)) + 1
        xs = [x0 + 0.02 * i for i in range(n)]
        ys = [far((x, 0, z), (0, 1, 0)) for x in xs]
        ib = max((i for i, x in enumerate(xs) if b0 <= x <= b1), key=lambda i: ys[i])
        j = min(range(ib, n), key=lambda i: ys[i])
        d2 = [abs(ys[i - 1] - 2 * ys[i] + ys[i + 1]) / 0.02 ** 2 for i in range(1, n - 1)]
        out["door"][str(z)] = {"bulgeX": round(xs[ib], 2), "bulgeY": round(ys[ib], 4), "dipX": round(xs[j], 2),
                               "dipMm": round((ys[ib] - ys[j]) * 1000, 1) if j < n - 1 else 0.0, "maxD2": round(max(d2), 2)}
    print(json.dumps(out, sort_keys=True))


if __name__ == "__main__":
    main()
