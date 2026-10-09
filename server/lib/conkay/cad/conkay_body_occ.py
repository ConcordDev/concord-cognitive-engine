#!/usr/bin/env python3
# server/lib/conkay/cad/conkay_body_occ.py
#
# ConKay parametric body kernel on OpenCascade (OCP, the same kernel family
# as the ConKay OCC bridge, lib/conkay/occ-bridge.js). Reads one JSON request
# on stdin, writes one JSON result on stdout. Standard library + OCP only.
#
# command "body": solve cross-sections around the envelopes, loft a closed
# B-spline solid through them, cut the wheel wells, check the solid, measure
# it (volume, surface area, projected frontal area), measure every envelope's
# clearance to the outer surface, cast the requested rays and export
# STEP / STL / GLB.
# command "ellipsoid": the same measurements on an ellipsoid (a check of the
# frontal-area and area code against closed forms).
#
# Coordinates: x rearward, y right, z up, metres.
#
# Section profile at station x (symmetric about y = 0): two superellipses
# joined at the belt height zs with the same half width W:
#   upper  (|y|/W)^nu + ((z - zs)/(zt - zs))^nu = 1,  z >= zs
#   lower  (|y|/W)^nl + ((zs - z)/(zs - zb))^nl = 1,  z <= zs
# For n >= 1 both halves are convex and meet with vertical tangents, so the
# section is convex: it contains a point set iff it contains its convex hull.

import sys, json, math, os, struct, hashlib, time

from OCP.BRepTools import BRepTools
from OCP.gp import gp_Pnt, gp_Vec, gp_Ax2, gp_Ax1, gp_Dir, gp_Trsf, gp_Lin, gp_GTrsf, gp_Pln
try:
    from OCP.TColgp import TColgp_HArray1OfPnt as HArrPnt
    from OCP.TColStd import TColStd_HArray1OfReal as HArrReal
    from OCP.TColgp import TColgp_Array2OfPnt as Arr2Pnt
    from OCP.TColStd import TColStd_Array1OfReal as Arr1Real, TColStd_Array1OfInteger as Arr1Int
except ImportError:  # OCP 7.8+
    from OCP.collections import HArray1_gp_Pnt as HArrPnt
    from OCP.collections import HArray1_double as HArrReal
    from OCP.collections import Array2_gp_Pnt as Arr2Pnt, Array1_double as Arr1Real, Array1_int as Arr1Int
from OCP.Geom import Geom_BSplineSurface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
from OCP.ShapeFix import ShapeFix_Solid
from OCP.GeomAPI import GeomAPI_Interpolate
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_Transform, BRepBuilderAPI_GTransform, BRepBuilderAPI_MakeVertex
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_SHELL, TopAbs_FACE, TopAbs_EDGE, TopAbs_SOLID, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.TopoDS import TopoDS_Compound
from OCP.BRep import BRep_Builder

KERNEL_VERSION = "2.1.0"


def _st(cls, name):
    """Static method across OCP versions (7.7 suffixes statics with _s, 8.x does not)."""
    return getattr(cls, name + "_s", None) or getattr(cls, name)


def occt_version():
    try:
        from OCP.Standard import Standard_Version
        return _st(Standard_Version, 'String')()
    except Exception:
        pass
    try:
        import OCP
        return getattr(OCP, "__version__", None)
    except Exception:
        return None


def r6(v):
    return round(float(v), 6)


def explore(shape, kind):
    ex = TopExp_Explorer(shape, kind)
    while ex.More():
        yield ex.Current()
        ex.Next()


# ----------------------------------------------------------------- geometry

def box_corners(b):
    c, h, a = b["center"], b["half"], b["axes"]
    out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                out.append([c[i] + sx * h[0] * a[0][i] + sy * h[1] * a[1][i] + sz * h[2] * a[2][i] for i in range(3)])
    return out


BOX_EDGES = [(i, j) for i in range(8) for j in range(i + 1, 8) if bin(i ^ j).count("1") == 1]


def slab_vertices(corners, x0, x1):
    """Vertices of (box ∩ {x0 <= x <= x1}) as (y, z) pairs."""
    pts = [(p[1], p[2]) for p in corners if x0 - 1e-12 <= p[0] <= x1 + 1e-12]
    for i, j in BOX_EDGES:
        p, q = corners[i], corners[j]
        dx = q[0] - p[0]
        if abs(dx) < 1e-15:
            continue
        for xp in (x0, x1):
            t = (xp - p[0]) / dx
            if 0.0 < t < 1.0:
                pts.append((p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])))
    return pts


def hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts
    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def quarter_area(n):
    return math.gamma(1 + 1 / n) ** 2 / math.gamma(1 + 2 / n)


def closing(xs, f, R, above=True):
    """Morphological closing of samples f(x) by a disc of radius R (from above if above, else from below).
    The disc may roll off either end (the line is padded with empty samples), so a peak near an end does
    not hold the line up all the way to it."""
    s = 1 if above else -1
    g = [s * v for v in f]
    n = len(xs)
    dx = (xs[-1] - xs[0]) / max(n - 1, 1) or R
    pad = int(math.ceil(R / dx)) + 1
    xe = [xs[0] - (pad - k) * dx for k in range(pad)] + list(xs) + [xs[-1] + (k + 1) * dx for k in range(pad)]
    dil = []
    for xi in xe:
        m = -1e9
        for xj, gj in zip(xs, g):
            d = abs(xi - xj)
            if d < R:
                m = max(m, gj + math.sqrt(R * R - d * d) - R)
        dil.append(m)
    out = []
    for i in range(n):
        m = 1e9
        for xj, dj in zip(xe, dil):
            d = abs(xs[i] - xj)
            if d < R:
                m = min(m, dj - math.sqrt(R * R - d * d) + R)
        out.append(max(m, g[i]))
    return [s * v for v in out]


def gauss(xs, v, sigma):
    """Gaussian smoothing of samples v(x) (sigma in metres; renormalised at the ends)."""
    if sigma <= 0:
        return list(v)
    out = []
    for xi in xs:
        num = den = 0.0
        for xj, vj in zip(xs, v):
            w = math.exp(-0.5 * ((xi - xj) / sigma) ** 2)
            num += w * vj; den += w
        out.append(num / den)
    return out


def smooth_env(xs, v, sigma, above=True, iters=200):
    """A smooth curve on one side of v (above if above): the Gaussian smoothing of v plus a correction
    c >= 0 grown only where the smoothed curve still falls short (so a local peak lifts only its own
    neighbourhood), then clamped to v so it bounds v everywhere."""
    sg = 1 if above else -1
    g = [sg * a for a in v]
    c = [0.0] * len(g)
    sm = gauss(xs, g, sigma)
    for _ in range(iters):
        short = [b - a for a, b in zip(sm, g)]
        if max(short) <= 1e-5:
            break
        c = [ci + max(si, 0.0) for ci, si in zip(c, short)]
        sm = gauss(xs, [gi + ci for gi, ci in zip(g, c)], sigma)
    return [sg * max(a, b) for a, b in zip(sm, g)]  # any residual shortfall (<= 1e-5 m once converged) clamped locally


def slope_limit(xs, v, back_slope):
    """Raise v so that it falls no faster than back_slope (rise over run) going rearwards: the fastback."""
    out = list(v)
    for i in range(1, len(out)):
        out[i] = max(out[i], out[i - 1] - back_slope * (xs[i] - xs[i - 1]))
    return out


def lipschitz_below(xs, v, slope):
    """The largest curve below v whose slope never exceeds slope (rise over run) either way."""
    return [min(vj + slope * abs(xi - xj) for xj, vj in zip(xs, v)) for xi in xs]


def width_for(pts, zc, hh, n, wmin=0.0):
    """Smallest half width of a superellipse centred (0, zc), half height hh, exponent n, holding pts."""
    W = wmin
    for u, z in pts:
        g = 1.0 - (abs(z - zc) / hh) ** n
        if g <= 1e-9:
            return None
        W = max(W, u / g ** (1.0 / n))
    return W


# ------------------------------------------------------------ the section model (v2)
#
# Each cross-section is the union of convex features, all symmetric about y = 0 except the pods:
#   L  lower body: a superellipse (exponent lowerExponent) from the floor zb to its top, half width W
#   G  greenhouse: the upper half of a superellipse (exponent upperExponent: the tumblehome) from its
#      base to the roof zt, half width Wg at the base
#   P  fender pods, one per wheel: flat-topped superellipse caps (exponent podExponent) from the
#      floor to the fender crown, whose outer face follows the tyre over the wheel stations only and
#      blends back into the body side over podBlend fore and aft
# The section curve is the radial hull of the union seen from a point inside L, sampled on the same
# fixed ray angles on every station (so every section has the same parameterisation), with a bounded
# smooth maximum (blendRadius) between features: it contains every feature, so every required point.

def smax(a, b, k):
    if k <= 0:
        return max(a, b)
    h = max(k - abs(a - b), 0.0) / k
    return max(a, b) + h * h * k / 4.0


def member(f, u, z):
    if f["kind"] == "se":
        if z < f.get("zmin", -1e9):
            return False
        return (abs(u - f["uc"]) / f["a"]) ** f["n"] + (abs(z - f["zc"]) / f["b"]) ** f["n"] <= 1.0
    tuck = 0.0  # pod: the side tucks under below the wheel centre (a quarter circle, podTuck in at the floor)
    if z < f["zw"]:
        q = min(1.0, (f["zw"] - z) / max(f["zw"] - f["zlo"], 1e-9))
        tuck = f["tuck"] * (1.0 - math.sqrt(1.0 - q * q))
    du = abs(u - f["uc"]) + tuck
    if du >= f["a"] or z < f["zlo"]:
        return False
    top = f["zlo"] + f["H"]
    e = du - (f["a"] - f["roll"])
    if e > 0:  # the rounded outer shoulder
        top -= f["drop"] * (1.0 - (1.0 - (e / f["roll"]) ** f["n"]) ** (1.0 / f["n"]))
    return z <= top


def ray_exit(f, zc0, th, rmax, steps=64):
    su, cu = math.sin(th), math.cos(th)
    hit = None
    for i in range(steps, -1, -1):
        r = rmax * i / steps
        if member(f, r * su, zc0 + r * cu):
            hit = r
            break
    if hit is None:
        return 0.0
    lo, hi = hit, min(rmax, hit + rmax / steps)
    if member(f, hi * su, zc0 + hi * cu):
        return hi
    for _ in range(34):
        m = 0.5 * (lo + hi)
        if member(f, m * su, zc0 + m * cu):
            lo = m
        else:
            hi = m
    return hi


DENSE = 6  # dense rays per section point before the arc-length resampling


def ray_angles(m):
    """m + 1 angles from straight up (0) to straight down (pi), denser towards the sides."""
    c = 0.4
    return [math.pi * (t - c * math.sin(2 * math.pi * t) / (2 * math.pi)) for t in (i / m for i in range(m + 1))]


def env_smooth_idx(v, sig, iters=40):
    """Upper smooth envelope of samples v (index space, truncated Gaussian of sig samples, ends mirrored):
    the smoothed curve plus a local correction where it falls short, finally clamped to >= v."""
    n = len(v)
    if sig <= 0 or n < 3:
        return list(v)
    h = int(3 * sig) + 1
    wts = [math.exp(-0.5 * (j / sig) ** 2) for j in range(-h, h + 1)]
    ws = sum(wts)

    def blur(a):
        out = []
        for i in range(n):
            acc = 0.0
            for j, w in zip(range(-h, h + 1), wts):
                q = i + j
                if q < 0:
                    q = -q
                elif q >= n:
                    q = 2 * (n - 1) - q
                q = min(max(q, 0), n - 1)
                acc += w * a[q]
            out.append(acc / ws)
        return out

    c = [0.0] * n
    sm = blur(v)
    for _ in range(iters):
        short = [b - a for a, b in zip(sm, v)]
        if max(short) <= 1e-5:
            break
        c = [ci + max(si, 0.0) for ci, si in zip(c, short)]
        sm = blur([a + b for a, b in zip(v, c)])
    return [max(a, b) for a, b in zip(sm, v)]


def profile(features, zc0, m, k, smooth=0.0):
    rmax = 0.05
    for f in features:
        if f["kind"] == "se":
            rmax = max(rmax, math.hypot(abs(f["uc"]) + f["a"], max(abs(f["zc"] + f["b"] - zc0), abs(f["zc"] - f["b"] - zc0))))
        else:
            rmax = max(rmax, math.hypot(f["uc"] + f["a"], max(abs(f["zlo"] - zc0), abs(f["zlo"] + f["H"] - zc0))))
    rmax *= 1.05
    ths = ray_angles(m * DENSE)
    rs = []
    for th in ths:
        r = 0.0
        for f in features:
            r = smax(r, ray_exit(f, zc0, th, rmax), k)
        rs.append(r)
    # fill the concave creases where features meet (an upper envelope of r(theta): never inside the union)
    ymax = max(r * math.sin(th) for r, th in zip(rs, ths))
    rs = env_smooth_idx(rs, smooth * DENSE)
    # (no wider than the union itself: the filling may not add overall width)
    dense = [(min(r * math.sin(th), ymax), zc0 + r * math.cos(th)) for r, th in zip(rs, ths)]
    dense[0] = (0.0, dense[0][1]); dense[-1] = (0.0, dense[-1][1])
    # resample the half outline at fixed fractions of its arc length (roof centre to floor centre):
    # unlike fixed ray angles, a point does not jump along the outline where a ray grazes a concave
    # junction between features, so neighbouring sections correspond smoothly
    half = resample_half(dense, m)
    half[0] = (0.0, dense[0][1]); half[-1] = (0.0, dense[-1][1])
    return half + [(-y, z) for (y, z) in reversed(half[1:-1])]


def half_hull(pts):
    """Hull vertices (u >= 0) of the points and their mirror images: the binding points for any convex
    feature symmetric about u = 0."""
    if not pts:
        return []
    mir = pts + [(-u, z) for u, z in pts]
    return [(u, z) for u, z in hull(mir) if u >= 0] or pts


def fit_lower(pts, zb, n):
    """Minimum-area superellipse (half width W, from zb to top) holding pts; None if none fits."""
    if not pts:
        return None
    zmax = max(z for _, z in pts)
    best = None
    for i in range(24):
        top = zmax + 0.002 + 0.25 * (i / 23) ** 2
        zm, hh = 0.5 * (zb + top), 0.5 * (top - zb)
        if hh <= 1e-6:
            continue
        W = 0.0
        ok = True
        for u, z in pts:
            g = 1.0 - (abs(z - zm) / hh) ** n
            if g <= 1e-9:
                ok = False
                break
            W = max(W, u / g ** (1.0 / n))
        if not ok:
            continue
        W = max(W, 0.05)
        a = W * hh
        if best is None or a < best[0] - 1e-12:
            best = (a, W, top)
    return None if best is None else {"W": best[1], "top": best[2]}


def fit_green(pts, base, n, wmin=0.0):
    """Minimum-area upper half superellipse from base (half width Wg) holding pts; None if no pts."""
    if not pts:
        return None
    umax = max(u for u, _ in pts)
    best = None
    for i in range(30):
        Wg = max(umax + 0.003, wmin) + 0.5 * (i / 29) ** 2
        zt = base + 0.01
        for u, z in pts:
            g = 1.0 - (u / Wg) ** n
            zt = max(zt, base + (z - base) / g ** (1.0 / n))
        a = Wg * (zt - base)
        if best is None or a < best[0] - 1e-12:
            best = (a, Wg, zt)
    return {"Wg": best[1], "zt": best[2]}


def clip_poly(q, zd, below):
    """The part of convex polygon q (a list of (y, z)) below (or above) z = zd."""
    if len(q) == 1:
        return q if ((q[0][1] <= zd) == below) else []
    out = []
    for i in range(len(q)):
        a, b = q[i], q[(i + 1) % len(q)]
        ina = (a[1] <= zd) if below else (a[1] >= zd)
        inb = (b[1] <= zd) if below else (b[1] >= zd)
        if ina:
            out.append(a)
        if ina != inb and abs(b[1] - a[1]) > 1e-15:
            t = (zd - a[1]) / (b[1] - a[1])
            out.append((a[0] + t * (b[0] - a[0]), zd))
    return out


def split_fit(polys, zb, zd, P):
    lo = [(abs(y), z) for q in polys for (y, z) in clip_poly(q, zd, True)]
    up = [(abs(y), z) for q in polys for (y, z) in clip_poly(q, zd, False) if z > zd - 1e-12]
    Lp = half_hull(lo)
    Gp = half_hull([p for p in up if p[1] > zd + 1e-9])
    L = fit_lower(Lp, zb, P["lowerExponent"]) if Lp else None
    base = min(zd, L["top"]) if L else zd
    G = fit_green(Gp, base, P["upperExponent"]) if Gp else None
    return L, G, base


def area_of(L, G, zb, base, P):
    a = 0.0
    if L:
        a += 4 * L["W"] * 0.5 * (L["top"] - zb) * quarter_area(P["lowerExponent"])
    if G:
        a += 2 * G["Wg"] * (G["zt"] - base) * quarter_area(P["upperExponent"])
    return a


def pod_lateral(dxw, R, blend):
    """1 over the wheel well, then a half-cosine to 0 over the blend length."""
    if dxw <= R:
        return 1.0
    if dxw >= R + blend:
        return 0.0
    return 0.5 * (1.0 + math.cos(math.pi * (dxw - R) / blend))


def wheel_geometry(w, clr):
    r, hw = w["radius"], w["halfWidth"]
    lock = math.radians(w.get("steerDeg") or 0.0)
    if lock > 0:
        swept = math.sqrt(r * r + hw * hw)  # max distance of any tyre point from the axle line over any steer angle
        crit = math.atan2(r, hw)
        lat = (r * math.sin(lock) + hw * math.cos(lock)) if lock <= crit else math.sqrt(r * r + hw * hw)
    else:
        swept, lat = r, hw
    return {"wellRadius": swept + clr, "innerHalf": lat + clr, "swept": swept, "lateral": lat}


def pod_feature(w, x, dx, zb, W_body, top_body, P):
    """The fender pod of wheel w at station x (None where it has blended into the body): a flat-topped
    block from the floor to the fender crown whose outer top edge is rounded over by an elliptic quadrant
    (podShoulder wide, podShoulderDrop high, exponent podExponent); fore and aft of the well its outer
    face and crown fade into the body side."""
    g = wheel_geometry(w, P["archClearance"])
    cx, cy, cz = w["center"]
    R = g["wellRadius"]
    t = pod_lateral(abs(x - cx), R, P["podBlend"])
    if t <= 0.0:
        return None
    u_in = abs(cy) - g["innerHalf"]
    u_out_full = abs(cy) + w["halfWidth"] + P["fenderCover"]
    crown = cz + R + P["fenderSkin"]  # flat fender crown over the whole well
    a = max(P["podMinHalfWidth"], 0.5 * (u_out_full - u_in) + 0.02)
    u_out = W_body + t * (u_out_full - W_body) if u_out_full > W_body else u_out_full
    low = min(top_body, zb + 0.45 * (crown - zb))
    top = low + t * (crown - low)
    roll = min(P["podShoulder"], 0.9 * a)
    drop = min(P["podShoulderDrop"], 0.9 * (top - zb))
    return {"kind": "pod", "uc": u_out - a, "a": a, "roll": roll, "drop": drop, "zlo": zb, "H": top - zb, "zw": cz,
            "tuck": P["podTuck"], "n": P["podExponent"], "wheel": w["id"], "t": t, "crown": top, "uOut": u_out}


def solve_sections(req, extra, adj=None):
    P = req["params"]
    o = P["skinOffset"]
    boxes = [e for e in req["envelopes"] if e.get("enclose", True)]
    allc = [box_corners(b) for b in boxes]
    xmin = min(p[0] for c in allc for p in c) - o
    xmax = max(p[0] for c in allc for p in c) + o
    n = int(P["stationCount"])
    dx = (xmax - xmin) / (n - 1)
    xs = [xmin + i * dx for i in range(n)]
    wheels = req.get("wheels", [])
    # body requirement points per station (u = |y|, z), each inflated by the skin offset (+ any local
    # extra); the wheels are not in them: the pods carry the tyres
    reqs = []
    for x in xs:
        polys = []  # convex (y, z) polygons: each box's slab, grown by its offset; points as 1-gons
        for b, c in zip(boxes, allc):
            oo = o + extra.get(b["id"], 0.0)
            v = slab_vertices(c, x - dx / 2 - oo, x + dx / 2 + oo)
            if v:
                polys.append(hull([(y + sy * oo, z + sz * oo) for (y, z) in v for sy in (-1, 1) for sz in (-1, 1)]))
        for p in req.get("points", []):
            if abs(p["p"][0] - x) <= dx:  # both stations either side of the point carry it
                polys.append([(p["p"][1], p["p"][2] + extra.get(p["id"], 0.0))])
        reqs.append(polys)
    for i in range(len(reqs)):  # a station with nothing in its window takes its neighbour's points
        if not reqs[i]:
            j = min((k for k in range(len(reqs)) if reqs[k]), key=lambda k: abs(k - i))
            reqs[i] = reqs[j]
    # 1. floor: the lowest point less the corner allowance, smoothed from below
    zb = closing(xs, [min(z for q in p for _, z in q) - P["floorCornerAllowance"] for p in reqs], P["floorClosingRadius"], above=False)
    # 2. deck (lower-body top / greenhouse base): per-station minimum-area split, smoothed
    #    over each wheel the belt drops toward the fender crown, so the hood and the rear deck sit in the
    #    greenhouse (rounded, with tumblehome) between the fender pods
    cap = []
    for x in xs:
        c = P["beltMax"]
        for w in wheels:
            g = wheel_geometry(w, P["archClearance"])
            t = pod_lateral(abs(x - w["center"][0]), g["wellRadius"], P["podBlend"])
            crown = w["center"][2] + g["wellRadius"] + P["fenderSkin"] + P["beltFenderDrop"]
            c = min(c, P["beltMax"] - t * max(0.0, P["beltMax"] - max(crown, P["beltMin"])))
        cap.append(c)
    zd0 = []
    for p, b, cp in zip(reqs, zb, cap):
        zs_ = sorted(z for q in p for _, z in q)
        lo, hi = max(zs_[0], P["beltMin"]), min(zs_[-1], cp)
        if lo >= hi:
            zd0.append(max(hi, P["beltMin"]))
            continue
        best = None
        for j in range(25):
            zd = lo + (hi - lo) * j / 24
            L, G, base = split_fit(p, b, zd, P)
            if L is None and G is None:
                continue
            a = area_of(L, G, b, base, P)
            if best is None or a < best[0] - 1e-12:
                best = (a, zd)
        zd0.append(best[1])
    sig = P["profileSigma"]
    zd = [min(max(v, P["beltMin"]), cp) for v, cp in zip(gauss(xs, zd0, P["beltSigma"]), cap)]
    zb = lipschitz_below(xs, zb, math.tan(math.radians(P["floorRiseDeg"])))  # (not Gaussian-smoothed: that would dip below the closed floor)
    # 3. greenhouse roof for that deck (closed and smoothed from above), then the widths that hold every
    #    point for the smoothed floor, deck and roof (smoothed in plan from outside)
    parts = []
    for p, d in zip(reqs, zd):
        lo = half_hull([(abs(y), z) for q in p for (y, z) in clip_poly(q, d, True)])
        up = half_hull([(abs(y), z) for q in p for (y, z) in clip_poly(q, d, False) if z > d + 1e-9])
        parts.append((lo, up))
    Gs = [fit_green(up, d, P["upperExponent"]) if up else None for (lo, up), d in zip(parts, zd)]
    zt_req = [G["zt"] if G else d for G, d in zip(Gs, zd)]
    zt = closing(xs, zt_req, P["roofClosingRadius"], above=True)
    zt = smooth_env(xs, slope_limit(xs, zt, math.tan(math.radians(P["fastbackDeg"]))), sig)
    nl, nu = P["lowerExponent"], P["upperExponent"]
    W_req, Wg_req = [], []
    for i in range(n):
        lo, up = parts[i]
        hh = 0.5 * (zd[i] + P["lowerOverlap"] - zb[i])  # L reaches lowerOverlap above the deck
        w = width_for(lo, zb[i] + hh, hh, nl, 0.05) if lo else 0.05
        if w is None:
            raise RuntimeError(f"station {xs[i]:.3f}: a point lies outside the floor/deck band")
        W_req.append(w)
        if zt[i] > zd[i] + 0.005:
            pts = [(u, z) for u, z in up if z > zd[i]]
            wg = width_for(pts, zd[i], zt[i] - zd[i], nu, 0.0) if pts else 0.0
            if wg is None:
                raise RuntimeError(f"station {xs[i]:.3f}: a point lies above the roof")
            Wg_req.append(wg)
        else:
            Wg_req.append(0.0)
    W = smooth_env(xs, closing(xs, W_req, P["planClosingRadius"], above=True), sig)
    # where the greenhouse holds nothing (windscreen and fastback slopes) it narrows from its neighbours
    # by at most greenhouseTaperDeg in plan (a boat tail behind the rear heads, a narrower screen base)
    tg = math.tan(math.radians(P["greenhouseTaperDeg"]))
    Wg_req = [max(Wg_req[j] - tg * abs(xs[i] - xs[j]) for j in range(n)) for i in range(n)]
    Wg_req = [max(v, P["podMinHalfWidth"]) for v in Wg_req]
    Wg = smooth_env(xs, closing(xs, Wg_req, P["planClosingRadius"], above=True), sig)
    topL, bases = [d + P["lowerOverlap"] for d in zd], zd
    secs = []
    m, k = int(P["sectionPoints"]), P["blendRadius"]
    for i, x in enumerate(xs):
        feats = [{"kind": "se", "uc": 0.0, "zc": 0.5 * (zb[i] + topL[i]), "a": W[i], "b": 0.5 * (topL[i] - zb[i]), "n": nl}]
        if zt[i] > bases[i] + 0.005:
            feats.append({"kind": "se", "uc": 0.0, "zc": bases[i], "a": Wg[i], "b": zt[i] - bases[i], "n": P["upperExponent"], "zmin": bases[i]})
        pods = []
        for w in wheels:
            f = pod_feature(w, x, dx, zb[i], W[i], topL[i], P)
            if f:
                feats.append(f); pods.append(f)
        zc0 = zb[i] + 0.4 * (topL[i] - zb[i])
        pts = [(y, max(z, zb[i])) for y, z in profile(feats, zc0, m, k, P["sectionSmoothing"])]  # every feature starts at zb: the blend may not dip below it
        secs.append({"x": x, "pts": pts,
                     "info": {"x": x, "zb": zb[i], "deck": bases[i], "W": W[i], "lowerTop": topL[i], "Wg": Wg[i], "zt": zt[i],
                              "pods": [{"wheel": f["wheel"], "t": f["t"], "crown": f["crown"], "uOut": f["uOut"]} for f in pods]}})
    floor_min = min(zb)
    if P["fairSigmaX"] > 0:
        fair_sections(secs, xs, zb, P, adj)
    else:
        smooth_rows(secs, xs, P["rowSigma"], [zb[i] for i in range(n)])
    return end_sections(secs, xs, P) , {"xmin": xmin, "xmax": xmax, "dx": dx, "floorMin": floor_min}


def smooth_rows(secs, xs, sigma, zb, iters=4, max_shift=0.015):
    """Fill dents along the car: each section point may move outward (along its section's outward
    normal, never inward, never below the floor or beyond the widest point) toward the Gaussian
    average of its row, so the loft does not drape between neighbouring bumps."""
    if sigma <= 0:
        return
    npt = len(secs[0]["pts"])
    ymax = max(abs(y) for s in secs for y, _ in s["pts"])
    max_step = max_shift / iters  # a dent is filled by at most max_shift in all
    for _ in range(iters):
        rows_y = [[s["pts"][k][0] for s in secs] for k in range(npt)]
        rows_z = [[s["pts"][k][1] for s in secs] for k in range(npt)]
        gy = [gauss(xs, r, sigma) for r in rows_y]
        gz = [gauss(xs, r, sigma) for r in rows_z]
        for i, s in enumerate(secs):
            if i < 2 or i > len(secs) - 3:
                continue  # the end sections (which shape the nose and the Kamm tail) are left as solved
            pts = s["pts"]
            new = []
            for k in range(npt):
                (ya, za), (yb, zb_) = pts[k - 1], pts[(k + 1) % npt]
                ty, tz = yb - ya, zb_ - za
                ln = math.hypot(ty, tz) or 1e-12
                ny, nz = -tz / ln, ty / ln  # outward: the points run clockwise (roof centre, down the +y side)
                y, z = pts[k]
                d = min((gy[k][i] - y) * ny + (gz[k][i] - z) * nz, max_step)
                if d > 0:
                    y2, z2 = y + d * ny, z + d * nz
                    y2 = math.copysign(min(abs(y2), ymax), y2) if abs(y) > 1e-12 else 0.0
                    z2 = max(z2, zb[i])
                    new.append((y2, z2))
                else:
                    new.append((y, z))
            s["pts"] = new


# ------------------------------------------------------------ fairing (v2.1)
#
# The solved sections hold every requirement but vary from station to station (pods fading in and out,
# per-station belt and width fits), and the loft interpolates them exactly, so the skin drapes between
# them: a C2 surface whose curvature still wobbles. fair_sections replaces every section by a faired one:
#   1. each section is written as a radius r(theta) about a centre (0, zc) on a smoothed centre line;
#      R_req = the farthest crossing of the section outline along each ray (its radial hull: it contains
#      the section, so every requirement point; the centre is inside every section);
#   2. an upper bound U: the flat floor (z >= zb, so the ground clearance is not given away) and the
#      widest half width of the solved sections (|y| <= ymax, so the overall width does not grow);
#   3. F = a smooth field with R_req <= F <= U: a separable Gaussian (fairSigmaX metres along the car,
#      fairSigmaTheta radians around the section) of R_req plus a correction grown only where the
#      smoothed field falls short of R_req, clamped to U after every pass (projection onto the band);
#   4. each faired section is resampled at equal arc-length fractions, like the solved ones.
# F >= R_req at every station, so the clearances at the stations can only grow; between stations the
# loft is checked by the exact clearance pass as before.

def _ray_hit_max(poly, cy, cz, sy, cz_dir):
    """Largest t >= 0 with (cy, cz) + t (sy, cz_dir) on the closed polygon (None if none)."""
    best = None
    n = len(poly)
    for i in range(n):
        (y0, z0), (y1, z1) = poly[i], poly[(i + 1) % n]
        ey, ez = y1 - y0, z1 - z0
        den = sy * ez - cz_dir * ey
        if abs(den) < 1e-15:
            continue
        qy, qz = y0 - cy, z0 - cz
        t = (qy * ez - qz * ey) / den
        u = (qy * cz_dir - qz * sy) / den
        if t >= 0 and -1e-12 <= u <= 1 + 1e-12 and (best is None or t > best):
            best = t
    return best


def _taps_x(xs, sigma):
    """Gaussian along the stations (sigma in metres, truncated at 3 sigma, renormalised at the ends), as
    per-output tap lists [(source index, weight)]."""
    n = len(xs)
    out = []
    for i in range(n):
        row = [(j, math.exp(-0.5 * ((xs[i] - xs[j]) / sigma) ** 2)) for j in range(n) if abs(xs[i] - xs[j]) <= 3 * sigma] if sigma > 0 else [(i, 1.0)]
        tot = sum(w for _, w in row)
        out.append([(j, w / tot) for j, w in row])
    return out


def _taps_theta(m, dth, sigma):
    """Gaussian around the half section (sigma in radians), mirrored at theta = 0 and pi (the section is
    symmetric), as per-output tap lists [(source index, weight)] (mirrored taps merged)."""
    if sigma <= 0:
        return [[(k, 1.0)] for k in range(m)]
    h = int(3 * sigma / dth) + 1
    w = [math.exp(-0.5 * (j * dth / sigma) ** 2) for j in range(-h, h + 1)]
    ws = sum(w)
    out = []
    for k in range(m):
        acc = {}
        for j, wj in zip(range(-h, h + 1), w):
            q = k + j
            while q < 0 or q > m - 1:
                q = -q if q < 0 else 2 * (m - 1) - q
            acc[q] = acc.get(q, 0.0) + wj / ws
        out.append(sorted(acc.items()))
    return out


def _transpose(taps, n_src):
    t = [[] for _ in range(n_src)]
    for o, row in enumerate(taps):
        for src, w in row:
            t[src].append((o, w))
    return t


def fair_sections(secs, xs, zb, P, adj=None, iters=2000, tol=1e-5):
    m = (len(secs[0]["pts"]) - 0) // 2  # points per half outline minus one (roof centre .. floor centre)
    na = int(P["fairAngles"]) * m  # rays per half section
    ths = [math.pi * k / na for k in range(na + 1)]  # 0 = straight up, pi = straight down (the +y half)
    dth = math.pi / na
    adj = adj or {}
    ymax = max(abs(y) for s in secs for y, _ in s["pts"])
    if P.get("maxWidth"):
        ymax = min(ymax, 0.5 * P["maxWidth"])
    ymax -= adj.get("widthTrim", 0.0)  # the loft overshoots the sections slightly: build() trims the cap
    zlo = [min(z for _, z in s["pts"]) for s in secs]
    zhi = [max(z for _, z in s["pts"]) for s in secs]
    zc = gauss(xs, [0.5 * (a + b) for a, b in zip(zlo, zhi)], max(P["fairSigmaX"], 0.3))
    zc = [min(max(c, a + 0.05), b - 0.05) for c, a, b in zip(zc, zlo, zhi)]  # well inside every section
    req, up = [], []
    for s, c, f in zip(secs, zc, zb):
        rr, uu = [], []
        for th in ths:
            sy, sz = math.sin(th), math.cos(th)
            t = _ray_hit_max(s["pts"], 0.0, c, sy, sz)
            if t is None:
                raise RuntimeError(f"fairing: the centre at x {s['x']:.3f} is outside its section")
            u = 1e9
            if sz < -1e-12:
                u = min(u, (c - f) / -sz)  # floor
            if sy > 1e-12:
                u = min(u, ymax / sy)  # width
            rr.append(t); uu.append(max(u, t))
        req.append(rr); up.append(uu)
    sx, st = P["fairSigmaX"], P["fairSigmaTheta"]
    tx, tt = _taps_x(xs, sx), _taps_theta(len(ths), dth, st)
    srcx, srct = _transpose(tx, len(xs)), _transpose(tt, len(ths))
    nx, nt = len(xs), len(ths)
    # G (R_req + c), G the separable Gaussian; c grows only where the clamped field min(G(.), U) is short of
    # R_req. G is linear, so after the first full pass the field is updated from the changed c only.
    tmp = [[sum(w * req[j][k] for j, w in tx[i]) for k in range(nt)] for i in range(nx)]
    Fu = [[sum(w * tmp[i][q] for q, w in tt[k]) for k in range(nt)] for i in range(nx)]
    corr = [[0.0] * nt for _ in xs]
    worst = 0.0
    for it in range(iters):
        worst = 0.0
        delta = []
        for i in range(nx):
            fi, ri, ui = Fu[i], req[i], up[i]
            for k in range(nt):
                d = ri[k] - min(fi[k], ui[k])
                if d > 0:
                    delta.append((i, k, d))
                    if d > worst:
                        worst = d
        if worst <= tol:
            break
        for j, q, d in delta:
            corr[j][q] += d
            for i, wi in srcx[j]:
                row = Fu[i]
                for k, wk in srct[q]:
                    row[k] += d * wi * wk
    F = [[min(v, u) for v, u in zip(fr, ur)] for fr, ur in zip(Fu, up)]
    _FAIR_STATS.update(iterations=it + 1, residualM=worst, sigmaXM=sx, sigmaThetaRad=st, rays=na + 1, widthCapM=2 * ymax,
                       widthTrimM=adj.get("widthTrim", 0.0), centreLine=[r6(v) for v in zc])
    for s, c, fr, rr, ur in zip(secs, zc, F, req, up):
        dense = [(max(v, q) if v < q else min(v, u)) for v, q, u in zip(fr, rr, ur)]  # residual (<= tol) clamped
        half = [(r_ * math.sin(th), c + r_ * math.cos(th)) for r_, th in zip(dense, ths)]
        half[0] = (0.0, half[0][1]); half[-1] = (0.0, half[-1][1])
        h = resample_half(half, m)
        h[0] = (0.0, half[0][1]); h[-1] = (0.0, half[-1][1])
        s["pts"] = h + [(-y, z) for (y, z) in reversed(h[1:-1])]
        s["info"]["fairCentreZ"] = c


_FAIR_STATS = {}


def fairness(surf, body_x=None, nu=120, nv=320, kmin=0.05):
    """Fairness of the lofted side surface (untrimmed), sampled on an nu x nv grid of its parameters:
    along the car (v rows) and around the sections (u rows), the normal curvature k in that direction,
    the number of sign changes of k where |k| > kmin (inflections; 1/kmin = 20 m radius), and the RMS of
    dk/ds over the arc length (1/m^2). A fair surface has few inflections and a small dk/ds."""
    u1, u2, v1, v2 = surf.Bounds()
    P = gp_Pnt(); du = gp_Vec(); dv = gp_Vec(); duu = gp_Vec(); dvv = gp_Vec(); duv = gp_Vec()
    us = [u1 + (u2 - u1) * (j + 0.5) / nu for j in range(nu)]
    vs = [v1 + (v2 - v1) * i / (nv - 1) for i in range(nv)]
    kv = [[0.0] * nv for _ in us]; sv = [[0.0] * nv for _ in us]
    ku = [[0.0] * nu for _ in vs]; su = [[0.0] * nu for _ in vs]
    for j, u in enumerate(us):
        for i, v in enumerate(vs):
            surf.D2(u, v, P, du, dv, duu, dvv, duv)
            n = du.Crossed(dv)
            ln = n.Magnitude()
            if ln < 1e-14:
                continue
            n.Divide(ln)
            kv[j][i] = dvv.Dot(n) / max(dv.Dot(dv), 1e-18)
            ku[i][j] = duu.Dot(n) / max(du.Dot(du), 1e-18)
            sv[j][i] = dv.Magnitude()
            su[i][j] = du.Magnitude()
    def stats(rows, speeds, step, periodic, keep=None):
        flips = 0; e = 0.0; L = 0.0; peak = 0.0
        for k_, s_ in zip(rows, speeds):
            last = 0
            idx = [i for i in range(len(k_)) if keep is None or keep(i)] + ([0] if periodic else [])
            for a, b in zip(idx, idx[1:]):
                if b != a + 1 and not (periodic and b == 0):
                    continue
                ds = 0.5 * (s_[a] + s_[b]) * step
                if ds <= 0:
                    continue
                g = (k_[b] - k_[a]) / ds
                e += g * g * ds; L += ds; peak = max(peak, abs(g))
            for i_ in idx[:len(idx) - (1 if periodic else 0)]:
                v_ = k_[i_]
                sg = 1 if v_ > kmin else (-1 if v_ < -kmin else 0)
                if sg and last and sg != last:
                    flips += 1
                if sg:
                    last = sg
        return {"inflections": flips, "rmsDkDs": r6(math.sqrt(e / L)) if L else None, "maxDkDs": r6(peak)}
    out = {"alongCar": stats(kv, sv, (v2 - v1) / (nv - 1), False),
           "aroundSection": stats(ku, su, (u2 - u1) / nu, True),
           "grid": [nu, nv], "kminPerM": kmin}
    if body_x:
        a, b = body_x
        region = {"nose": lambda i: vs[i] < a, "body": lambda i: a <= vs[i] <= b, "tail": lambda i: vs[i] > b}
        out["regions"] = {"bodyX": [r6(a), r6(b)]}
        for name, inside_ in region.items():
            rows_u = [row for i, row in enumerate(ku) if inside_(i)]
            sp_u = [row for i, row in enumerate(su) if inside_(i)]
            out["regions"][name] = {"alongCar": stats(kv, sv, (v2 - v1) / (nv - 1), False, inside_),
                                    "aroundSection": stats(rows_u, sp_u, (u2 - u1) / nu, True) if rows_u else None}
    return {**out,
            "method": "normal curvature of the B-spline side surface (OCP D2) along each parameter direction on a uniform parameter grid; inflections = sign changes of k beyond +/-kmin; rmsDkDs = sqrt(integral (dk/ds)^2 ds / integral ds), finite differences"}


def poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        (y0, z0), (y1, z1) = pts[i], pts[(i + 1) % len(pts)]
        a += y0 * z1 - y1 * z0
    return abs(a) / 2


def resample_half(dense, m):
    """m + 1 points at equal arc-length fractions along an open polyline."""
    acc = [0.0]
    for a, b in zip(dense, dense[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total, out, j = acc[-1], [], 0
    for i in range(m + 1):
        s_ = total * i / m
        while j < len(acc) - 2 and acc[j + 1] < s_:
            j += 1
        seg = acc[j + 1] - acc[j]
        t = 0.0 if seg <= 0 else min(1.0, max(0.0, (s_ - acc[j]) / seg))
        (y0, z0), (y1, z1) = dense[j], dense[j + 1]
        out.append((y0 + t * (y1 - y0), z0 + t * (z1 - z0)))
    return out


def round_section(pts, n):
    """A superellipse (exponent n) over the bounding box of pts, with the same point count and the same
    arc-length parameterisation (roof centre, down the +y side, floor centre, up the -y side)."""
    a = max(abs(y) for y, _ in pts)
    zlo, zhi = min(z for _, z in pts), max(z for _, z in pts)
    zc, b = 0.5 * (zlo + zhi), 0.5 * (zhi - zlo)
    m = len(pts) // 2
    dense = []
    for i in range(400 + 1):
        th = math.pi * i / 400  # 0 = up, pi = down
        cy, cz = math.sin(th), math.cos(th)
        t = ((abs(cy) / a) ** n + (abs(cz) / b) ** n) ** (-1.0 / n)
        dense.append((cy * t, zc + cz * t))
    half = resample_half(dense, m)
    half[0] = (0.0, zhi); half[-1] = (0.0, zlo)
    return half + [(-y, z) for (y, z) in reversed(half[1:-1])]


def end_sections(secs, xs, P):
    """Nose: the first section drawn forward to a low tip (noseTipHeight above the ground) with a
    pointed side and plan profile (exponent noseShapeExponent < 2 is sharper than an ellipse).
    Tail: a Kamm tail, the last section tapered so that the truncated end face has kammAreaRatio of the
    largest section's area (roof drawn down more than the floor is raised), then cut off flat.
    With fairEnds (v2.1) the end sections are spaced at the station pitch and every scale and blend is a
    C1 function of the distance from the body (zero slope where it meets the first and last stations), so
    the loft does not ripple where the body turns into the nose and the tail; without it, the v2.0 ends."""
    if not P.get("fairEnds"):
        return end_sections_v20(secs, xs, P)
    first, last = secs[0], secs[-1]
    Ln, Lt = P["noseExtension"], P["tailExtension"]
    p = P["noseShapeExponent"]
    tip, tipw = P["endTipFraction"], P["endTipWidthFraction"]
    ztip = P["noseTipHeight"]
    dx = (xs[-1] - xs[0]) / max(len(xs) - 1, 1)
    smooth = lambda f: f * f * (3.0 - 2.0 * f)  # smoothstep: 0 -> 1 with zero slope at both ends
    taper = lambda f: (1.0 - f ** p) ** (1.0 / p)  # 1 -> 0, zero slope at f = 0 (p > 1)
    nose = []
    rounded = round_section(first["pts"], P["noseRoundExponent"])
    kn = max(3, int(math.ceil(Ln / dx)))
    for k in range(kn, 0, -1):  # tip first (the loft runs from the nose to the tail)
        f = k / kn
        s = tip + (1.0 - tip) * taper(f)
        sw = tipw + (1.0 - tipw) * taper(f)
        w = smooth(f)  # the fender pods fade into a rounded nose section toward the tip
        x = xs[0] - f * Ln
        base = [((1 - w) * y + w * yr, (1 - w) * z + w * zr) for (y, z), (yr, zr) in zip(first["pts"], rounded)]
        pts = [(y * sw, ztip + (z - ztip) * s) for y, z in base]
        nose.append({"x": x, "pts": pts, "info": {"x": x, "nose": f, "scaleH": s, "scaleW": sw}})
    amax = max(poly_area(q["pts"]) for q in secs)
    a0 = poly_area(last["pts"])
    target = min(1.0, P["kammAreaRatio"] * amax / a0) if a0 > 0 else 1.0
    zs_ = [z for _, z in last["pts"]]
    zlo, zhi = min(zs_), max(zs_)
    anchor = zlo + 0.25 * (zhi - zlo)  # the roof comes down more than the floor goes up
    kw = target ** 0.35
    kh = target / kw
    tail = []
    rounded_t = round_section(last["pts"], P["noseRoundExponent"])
    kt = max(2, int(math.ceil(Lt / dx)))
    for k in range(1, kt + 1):
        f = k / kt
        sw = 1.0 - (1.0 - kw) * f ** 1.5
        sh = 1.0 - (1.0 - kh) * f ** 1.3
        x = xs[-1] + f * Lt
        w = P["tailRound"] * smooth(f)  # the pods may fade partly into a rounded tail section toward the cut
        base = [((1 - w) * y + w * yr, (1 - w) * z + w * zr) for (y, z), (yr, zr) in zip(last["pts"], rounded_t)]
        pts = [(y * sw, anchor + (z - anchor) * sh) for y, z in base]
        tail.append({"x": x, "pts": pts, "info": {"x": x, "tail": f, "scaleH": sh, "scaleW": sw}})
    return nose + secs + tail


def end_sections_v20(secs, xs, P):
    """Nose: the first section drawn forward to a low tip (noseTipHeight above the ground) with a
    pointed side and plan profile (exponent noseShapeExponent < 2 is sharper than an ellipse).
    Tail: a Kamm tail, the last section tapered so that the truncated end face has kammAreaRatio of the
    largest section's area (roof drawn down more than the floor is raised), then cut off flat."""
    first, last = secs[0], secs[-1]
    Ln, Lt = P["noseExtension"], P["tailExtension"]
    p = P["noseShapeExponent"]
    tip = P["endTipFraction"]
    ztip = P["noseTipHeight"]
    nose = []
    rounded = round_section(first["pts"], P["noseRoundExponent"])
    for f in (1.0, 0.8, 0.55, 0.3):
        s = max((1.0 - f ** p) ** (1.0 / p), tip)
        sw = max(0.35 + 0.65 * s, tip) if f < 1.0 else tip * 4
        x = xs[0] - f * Ln
        w = min(1.0, 0.5 + f)  # the fender pods fade into a rounded nose section toward the tip
        base = [((1 - w) * y + w * yr, (1 - w) * z + w * zr) for (y, z), (yr, zr) in zip(first["pts"], rounded)]
        pts = [(y * sw, ztip + (z - ztip) * s) for y, z in base]
        nose.append({"x": x, "pts": pts, "info": {"x": x, "nose": f, "scaleH": s, "scaleW": sw}})
    amax = max(poly_area(s["pts"]) for s in secs)
    a0 = poly_area(last["pts"])
    target = min(1.0, P["kammAreaRatio"] * amax / a0) if a0 > 0 else 1.0
    zs_ = [z for _, z in last["pts"]]
    zlo, zhi = min(zs_), max(zs_)
    anchor = zlo + 0.25 * (zhi - zlo)  # the roof comes down more than the floor goes up
    kw = target ** 0.35
    kh = target / kw
    tail = []
    rounded_t = round_section(last["pts"], P["noseRoundExponent"])
    for f in (0.35, 0.7, 1.0):
        sw = 1.0 - (1.0 - kw) * f ** 1.5
        sh = 1.0 - (1.0 - kh) * f ** 1.3
        x = xs[-1] + f * Lt
        w = P["tailRound"] * f  # the pods may fade partly into a rounded tail section toward the cut
        base = [((1 - w) * y + w * yr, (1 - w) * z + w * zr) for (y, z), (yr, zr) in zip(last["pts"], rounded_t)]
        pts = [(y * sw, anchor + (z - anchor) * sh) for y, z in base]
        tail.append({"x": x, "pts": pts, "info": {"x": x, "tail": f, "scaleH": sh, "scaleW": sw}})
    return nose + secs + tail


# ------------------------------------------------------------------ the solid

def section_curve(s):
    pts = s["pts"]
    arr = HArrPnt(1, len(pts))
    par = HArrReal(1, len(pts) + 1)  # periodic: one more parameter, closing the curve
    for i, (y, z) in enumerate(pts):
        arr.SetValue(i + 1, gp_Pnt(s["x"], y, z))
    for i in range(len(pts) + 1):
        par.SetValue(i + 1, float(i))  # the same parameters on every section: one knot vector
    it = GeomAPI_Interpolate(arr, par, True, 1e-7)
    it.Perform()
    return it.Curve()


def loft(sections, P, floor_min=None):
    """Skin the sections: a periodic cubic B-spline per section (identical knots), then each pole row
    interpolated along x by a cubic B-spline (parameter = station x). The surface passes exactly through
    every section; the ends are closed with planar caps and the faces sewn into one solid."""
    curves = [section_curve(s) for s in sections]
    c0 = curves[0]
    npu = c0.NbPoles()
    xs = [s["x"] for s in sections]
    def kv(c):
        kn = Arr1Real(1, c.NbKnots()); mu = Arr1Int(1, c.NbKnots())
        for i in range(1, c.NbKnots() + 1):
            kn.SetValue(i, c.Knot(i)); mu.SetValue(i, c.Multiplicity(i))
        return kn, mu
    uk, um = kv(c0)
    K = int(P.get("fairPolesX") or 0)
    if not K and P.get("fairPoleSpacing"):
        K = int(round((xs[-1] - xs[0]) / P["fairPoleSpacing"])) + 3
    if K >= 4 and K < len(curves):
        # v2.1: each pole row is a least-squares cubic B-spline over K control points on uniform knots in x
        # (fewer, smoother control sections), not an interpolant through every section: the surface no
        # longer passes exactly through the sections, so the clearance loop in build() checks it.
        _FAIR_STATS["controlPointsX"] = K
        vkn, vmu, prow = lsq_rows([[c.Pole(j) for c in curves] for j in range(1, npu + 1)], xs, K, P["fairLambda"])
        if floor_min is not None:
            # a B-spline surface lies in the convex hull of its control points: with every control point at
            # or above the solved floor, the fitted surface cannot dip below it (the fit overshoots slightly
            # where the flat floor turns into the end ramps)
            low = min(q[2] for row in prow for q in row)
            _FAIR_STATS["floorPoleClampM"] = r6(max(0.0, floor_min - low))
            prow = [[(q[0], q[1], max(q[2], floor_min)) for q in row] for row in prow]
        npv = K
        poles = Arr2Pnt(1, npu, 1, npv)
        for j, row in enumerate(prow):
            for k, q in enumerate(row):
                poles.SetValue(j + 1, k + 1, gp_Pnt(*q))
        vk = Arr1Real(1, len(vkn)); vm = Arr1Int(1, len(vkn))
        for i, (a, b) in enumerate(zip(vkn, vmu)):
            vk.SetValue(i + 1, a); vm.SetValue(i + 1, b)
        vdeg = 3
    else:
        rows = []
        for j in range(1, npu + 1):
            arr = HArrPnt(1, len(curves)); par = HArrReal(1, len(curves))
            for i, c in enumerate(curves):
                arr.SetValue(i + 1, c.Pole(j)); par.SetValue(i + 1, xs[i])
            it = GeomAPI_Interpolate(arr, par, False, 1e-9)
            it.Perform()
            rows.append(it.Curve())
        r0 = rows[0]
        npv = r0.NbPoles()
        poles = Arr2Pnt(1, npu, 1, npv)
        for j, r in enumerate(rows):
            for k in range(1, npv + 1):
                poles.SetValue(j + 1, k, r.Pole(k))
        vk, vm = kv(r0)
        vdeg = r0.Degree()
    surf = Geom_BSplineSurface(poles, uk, vk, um, vm, c0.Degree(), vdeg, True, False)
    side = BRepBuilderAPI_MakeFace(surf, 1e-7).Face()
    sew = BRepBuilderAPI_Sewing(1e-5)
    sew.Add(side)
    for v in (xs[0], xs[-1]):
        e = BRepBuilderAPI_MakeEdge(surf.VIso(v)).Edge()
        sew.Add(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire(), True).Face())
    sew.Perform()
    sewed = sew.SewedShape()
    shell = None
    for sh in explore(sewed, TopAbs_SHELL):
        shell = _st(TopoDS, 'Shell')(sh)
        break
    solid = BRepBuilderAPI_MakeSolid(shell).Solid()
    fix = ShapeFix_Solid(solid)
    fix.Perform()
    solid = fix.Solid()
    g = GProp_GProps(); _st(BRepGProp, 'VolumeProperties')(solid, g)
    if g.Mass() < 0:
        solid.Reverse()
    return solid, surf


def _bspline_basis(knots, deg, t):
    """Values of all B-spline basis functions of the (full, expanded) knot vector at t (Cox-de Boor)."""
    n = len(knots) - deg - 1
    if t >= knots[-1]:
        out = [0.0] * n; out[-1] = 1.0
        return out
    N = [1.0 if knots[i] <= t < knots[i + 1] else 0.0 for i in range(len(knots) - 1)]
    for d in range(1, deg + 1):
        for i in range(len(knots) - 1 - d):
            a = (t - knots[i]) / (knots[i + d] - knots[i]) * N[i] if knots[i + d] > knots[i] else 0.0
            b = (knots[i + d + 1] - t) / (knots[i + d + 1] - knots[i + 1]) * N[i + 1] if knots[i + d + 1] > knots[i + 1] else 0.0
            N[i] = a + b
    return N[:n]


def _cholesky_solve(A, bs):
    n = len(A)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s_ = A[i][j] - sum(L[i][k] * L[j][k] for k in range(j))
            if i == j:
                if s_ <= 0:
                    raise RuntimeError("lsq_rows: normal matrix not positive definite")
                L[i][i] = math.sqrt(s_)
            else:
                L[i][j] = s_ / L[j][j]
    outs = []
    for b in bs:
        y = [0.0] * n
        for i in range(n):
            y[i] = (b[i] - sum(L[i][k] * y[k] for k in range(i))) / L[i][i]
        x = [0.0] * n
        for i in reversed(range(n)):
            x[i] = (y[i] - sum(L[k][i] * x[k] for k in range(i + 1, n))) / L[i][i]
        outs.append(x)
    return outs


def lsq_rows(rows, xs, K, lam):
    """Least-squares cubic B-spline (K control points, clamped, uniform knots on [xs[0], xs[-1]]) through
    each row of points (one per section, parameter = section x), with a second-difference penalty lam on
    the control points (lam = 0: plain least squares). One normal matrix for every row (same parameters).
    Cubic B-splines reproduce linear functions, so x(v) = v exactly: every v-iso curve is planar.
    Returns (distinct knots, multiplicities, rows of K control points as (x, y, z))."""
    deg = 3
    a, b = xs[0], xs[-1]
    inner = K - deg - 1
    knots = [a] * (deg + 1) + [a + (b - a) * (i + 1) / (inner + 1) for i in range(inner)] + [b] * (deg + 1)
    B = [_bspline_basis(knots, deg, t) for t in xs]
    A = [[sum(Bi[p] * Bi[q] for Bi in B) for q in range(K)] for p in range(K)]
    if lam > 0:
        for i in range(K - 2):
            d = [0.0] * K; d[i], d[i + 1], d[i + 2] = 1.0, -2.0, 1.0
            for p in range(i, i + 3):
                for q in range(i, i + 3):
                    A[p][q] += lam * d[p] * d[q]
    out = []
    for row in rows:
        pts = [(q.X(), q.Y(), q.Z()) for q in row]
        rhs = [[sum(Bi[p] * pt[c] for Bi, pt in zip(B, pts)) for p in range(K)] for c in range(3)]
        sol = _cholesky_solve(A, rhs)
        out.append([(sol[0][k], sol[1][k], sol[2][k]) for k in range(K)])
    distinct = [a] + [a + (b - a) * (i + 1) / (inner + 1) for i in range(inner)] + [b]
    mults = [deg + 1] + [1] * inner + [deg + 1]
    return distinct, mults, out


def wheel_tools(req):
    P = req["params"]
    tools = []
    for w in req.get("wheels", []):
        g = wheel_geometry(w, P["archClearance"])
        cx, cy, cz = w["center"]
        far = 3.0
        if cy < 0:
            y0, y1 = -far, cy + g["innerHalf"]
        else:
            y0, y1 = cy - g["innerHalf"], far
        tools.append(BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(cx, y0, cz), gp_Dir(0, 1, 0)), g["wellRadius"], y1 - y0).Shape())
    return tools


def cut_all(shape, tools):
    if not tools:
        return shape
    comp = TopoDS_Compound()
    bld = BRep_Builder()
    bld.MakeCompound(comp)
    for t in tools:
        bld.Add(comp, t)
    c = BRepAlgoAPI_Cut(shape, comp)
    c.Build()
    return c.Shape()


def first_solid(shape):
    for s in explore(shape, TopAbs_SOLID):
        return _st(TopoDS, 'Solid')(s)
    return None


def outer_shell(solid):
    for s in explore(solid, TopAbs_SHELL):
        return s
    return None


def obb_shape(b):
    h = [max(v, 5e-5) for v in b["half"]]
    shp = BRepPrimAPI_MakeBox(gp_Pnt(-h[0], -h[1], -h[2]), 2 * h[0], 2 * h[1], 2 * h[2]).Shape()
    a, c = b["axes"], b["center"]
    t = gp_Trsf()
    t.SetValues(a[0][0], a[1][0], a[2][0], c[0], a[0][1], a[1][1], a[2][1], c[1], a[0][2], a[1][2], a[2][2], c[2])
    return BRepBuilderAPI_Transform(shp, t, True).Shape()


def distance(a, b):
    d = BRepExtrema_DistShapeShape(a, b)
    d.Perform()
    return d.Value() if d.IsDone() else None


def inside(solid, p, tol=1e-7):
    c = BRepClass3d_SolidClassifier(solid, gp_Pnt(*p), tol)
    return c.State() == TopAbs_IN


def clearance(solid, shell, b):
    """Signed clearance of a box to the outer surface: + distance when inside, - deepest corner protrusion."""
    cs = box_corners(b)
    out = [p for p in cs if not inside(solid, p)]
    if out:
        return -max(distance(BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex(), shell) for p in out), False
    return distance(obb_shape(b), shell), True


def box_limits(bx):
    a, b = bx.CornerMin(), bx.CornerMax()
    return a.X(), a.Y(), a.Z(), b.X(), b.Y(), b.Z()


def side_patch(surf, x0, x1):
    """The lofted side surface restricted to stations x0..x1 (v is the station x): a small B-spline
    face, so a distance query does not walk the whole body."""
    u1, u2, v1, v2 = surf.Bounds()
    a, b = max(v1, x0), min(v2, x1)
    if b - a < 1e-6:
        return None
    seg = surf.Copy()  # (OCP builds without the copy constructor return the derived handle from Copy)
    if not hasattr(seg, "Segment"):
        seg = Geom_BSplineSurface.DownCast(seg)
    seg.Segment(u1, u2, a, b)
    return BRepBuilderAPI_MakeFace(seg, 1e-7).Face()


def fast_clearance(solid, surf, b, window=0.3):
    """Screening clearance for the iterations: the distance to the side surface within `window` of
    the box in x (untrimmed by the wheel wells, so never larger than the distance to that part of the
    side). The reported clearances are always the exact pass (clearance())."""
    cs = box_corners(b)
    xs = [p[0] for p in cs]
    patch = side_patch(surf, min(xs) - window, max(xs) + window)
    if patch is None:
        return clearance(solid, outer_shell(solid), b)[0]
    out = [p for p in cs if not inside(solid, p)]
    if out:
        return -max(distance(BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex(), patch) for p in out)
    return min(distance(obb_shape(b), patch), window)


_CTX = {}
TOL = 1e-5  # clearance shortfall that triggers another iteration (0.01 mm)


def mirror_key(b):
    """Boxes that are mirror images across y = 0 have the same clearance to the (symmetric) body.
    Only pitch-only boxes (no yaw or roll) are merged."""
    a = b["axes"]
    if any(abs(a[0][1]) > 1e-12 or abs(a[2][1]) > 1e-12 or abs(a[1][0]) > 1e-12 or abs(a[1][2]) > 1e-12 for _ in [0]):
        return ("id", b["id"])
    c = b["center"]
    return (round(c[0], 9), round(abs(c[1]), 9), round(c[2], 9), tuple(round(v, 9) for v in b["half"]), tuple(round(v, 9) for v in a[0] + a[2]))


def _work(args):
    kind, i = args
    b = _CTX["boxes"][i]
    if kind == "fast":
        return fast_clearance(_CTX["solid"], _CTX["surf"], b), None
    return clearance(_CTX["solid"], _CTX["shell"], b)


def clearances_for(kind, boxes, solid, shell, surf):
    """Clearance of every box (mirror pairs computed once), in parallel over CONKAY_BODY_WORKERS forked
    processes when set (the results do not depend on the worker count)."""
    keys = [mirror_key(b) for b in boxes]
    first = {}
    for i, k in enumerate(keys):
        first.setdefault(k, i)
    todo = sorted(set(first.values()))
    _CTX.update(boxes=boxes, solid=solid, shell=shell, surf=surf)
    n = int(os.environ.get("CONKAY_BODY_WORKERS", "1") or 1)
    res = {}
    if n > 1 and len(todo) > 1:
        import multiprocessing as mp
        with mp.get_context("fork").Pool(min(n, len(todo))) as pool:
            for i, r in zip(todo, pool.map(_work, [(kind, i) for i in todo], chunksize=1)):
                res[i] = r
    else:
        for i in todo:
            res[i] = _work((kind, i))
    return [res[first[k]] for k in keys]


def exact_extents(shape, axes=(0, 1, 2)):
    """Exact extents along the given axes: BRepExtrema distance from the B-rep to a plane 1 m outside the
    AddOptimal box on each side. AddOptimal alone is not tight on a large B-spline face (it was measured
    0.5-12.6 mm outside the surface), so it only places the planes. Returns (min[3], max[3]); axes not
    asked for keep the AddOptimal value."""
    b0 = bbox(shape)
    lo, hi = list(b0[:3]), list(b0[3:])
    span = 4 * max(hi[i] - lo[i] for i in range(3)) + 10
    out_lo, out_hi = list(lo), list(hi)
    for ax in axes:
        for sgn in (-1, 1):
            o = [0.0, 0.0, 0.0]; o[ax] = (lo[ax] if sgn < 0 else hi[ax]) + sgn
            n = [0.0, 0.0, 0.0]; n[ax] = 1.0
            face = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(*o), gp_Dir(*n)), -span, span, -span, span).Face()
            d = BRepExtrema_DistShapeShape(shape, face)
            d.Perform()
            if not d.IsDone():
                raise RuntimeError("extents: BRepExtrema did not converge")
            if sgn < 0:
                out_lo[ax] = o[ax] + d.Value()
            else:
                out_hi[ax] = o[ax] - d.Value()
    return out_lo, out_hi


def bbox(shape):
    bx = Bnd_Box()
    _st(BRepBndLib, 'AddOptimal')(shape, bx, False, False)
    return box_limits(bx)


def measure(solid, slices, lin=0.002, ang=0.1):
    g = GProp_GProps(); _st(BRepGProp, 'VolumeProperties')(solid, g)
    vol = g.Mass(); cg = g.CentreOfMass()
    g2 = GProp_GProps(); _st(BRepGProp, 'SurfaceProperties')(solid, g2)
    area = g2.Mass(); scg = g2.CentreOfMass()
    (x0, y0, z0), (x1, y1, z1) = exact_extents(solid)
    # projected frontal area (onto the y-z plane), from the kernel's tessellation of the solid: at each
    # height the silhouette width is the measure of the union of the y-intervals where the plane cuts the
    # triangles (a connected section region projects onto the interval its boundary spans); midpoint rule
    # over the height. The mesh is inscribed (chordal deviation <= meshLinear), so this is a slight under-estimate.
    verts, tris = triangulate(solid, lin, ang)
    dz = (z1 - z0) / slices
    per = [[] for _ in range(slices)]
    for t in tris:
        p = [verts[i] for i in t]
        za, zb_ = min(q[2] for q in p), max(q[2] for q in p)
        k0 = max(0, int(math.ceil((za - z0) / dz - 0.5)))
        k1 = min(slices - 1, int(math.floor((zb_ - z0) / dz - 0.5)))
        for k in range(k0, k1 + 1):
            z = z0 + (k + 0.5) * dz
            ys = []
            for i in range(3):
                q, r = p[i], p[(i + 1) % 3]
                if (q[2] - z) * (r[2] - z) <= 0 and q[2] != r[2]:
                    f = (z - q[2]) / (r[2] - q[2])
                    ys.append(q[1] + f * (r[1] - q[1]))
            if ys:
                per[k].append((min(ys), max(ys)))
    fa = 0.0
    for iv in per:
        iv.sort()
        w = 0.0; cur = None
        for a_, b_ in iv:
            if cur is None or a_ > cur[1]:
                if cur:
                    w += cur[1] - cur[0]
                cur = [a_, b_]
            else:
                cur[1] = max(cur[1], b_)
        if cur:
            w += cur[1] - cur[0]
        fa += w * dz
    return {"volumeM3": vol, "surfaceAreaM2": area, "frontalAreaM2": fa, "cg": [cg.X(), cg.Y(), cg.Z()], "scg": [scg.X(), scg.Y(), scg.Z()],
            "bbox": {"min": [x0, y0, z0], "max": [x1, y1, z1]}, "frontalSlices": slices,
            # the mesh is inscribed: each side of the silhouette is at most `lin` inside the surface, so the
            # area is under-estimated by at most 2 * lin * height (plus the midpoint rule's error)
            "frontalMeshLinearM": lin, "frontalMaxUnderestimateM2": 2 * lin * (z1 - z0)}


def validity(shape):
    ok = BRepCheck_Analyzer(shape).IsValid()
    solids = list(explore(shape, TopAbs_SOLID))
    fb = ShapeAnalysis_FreeBounds(shape, 1e-6, False, False)
    free = 0
    for _ in explore(fb.GetClosedWires(), TopAbs_EDGE):
        free += 1
    for _ in explore(fb.GetOpenWires(), TopAbs_EDGE):
        free += 1
    faces = sum(1 for _ in explore(shape, TopAbs_FACE))
    return {"valid": bool(ok), "solids": len(solids), "freeEdges": free, "faces": faces, "closed": free == 0 and len(solids) == 1}


def ray_hits(shape, rays):
    out = []
    inter = IntCurvesFace_ShapeIntersector()
    inter.Load(shape, 1e-7)
    for r in rays:
        o, d = r["origin"], r["dir"]
        n = math.sqrt(sum(v * v for v in d))
        inter.Perform(gp_Lin(gp_Pnt(*o), gp_Dir(d[0] / n, d[1] / n, d[2] / n)), 0.0, 100.0)
        best = None
        if inter.IsDone():
            for i in range(1, inter.NbPnt() + 1):
                w = inter.WParameter(i)
                if w > 1e-9 and (best is None or w < best):
                    best = w
        out.append({"id": r["id"], "distanceM": r6(best) if best is not None else None})
    return out


# ------------------------------------------------------------------ exports

def triangulate(shape, lin, ang):
    # Drop any earlier mesh so the triangulation depends only on (lin, ang).
    _st(BRepTools, 'Clean')(shape)
    BRepMesh_IncrementalMesh(shape, lin, False, ang, False)
    verts, tris = [], []
    for f in explore(shape, TopAbs_FACE):
        face = _st(TopoDS, 'Face')(f)
        loc = TopLoc_Location()
        tri = _st(BRep_Tool, 'Triangulation')(face, loc)
        if tri is None:
            continue
        tr = loc.Transformation()
        base = len(verts)
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(tr)
            verts.append((p.X(), p.Y(), p.Z()))
        rev = face.Orientation() == TopAbs_REVERSED
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            tris.append((base + a - 1, base + c - 1, base + b - 1) if rev else (base + a - 1, base + b - 1, base + c - 1))
    return verts, tris


def write_glb(path, verts, tris):
    pos = b"".join(struct.pack("<3f", *v) for v in verts)
    idx = b"".join(struct.pack("<3I", *t) for t in tris)
    mn = [min(v[i] for v in verts) for i in range(3)]
    mx = [max(v[i] for v in verts) for i in range(3)]
    gltf = {
        "asset": {"version": "2.0", "generator": f"conkay_body_occ {KERNEL_VERSION}"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "body"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"byteLength": len(pos) + len(idx)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
                        {"buffer": 0, "byteOffset": len(pos), "byteLength": len(idx), "target": 34963}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(verts), "type": "VEC3", "min": mn, "max": mx},
                      {"bufferView": 1, "componentType": 5125, "count": 3 * len(tris), "type": "SCALAR"}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    binb = pos + idx
    binb += b"\0" * ((4 - len(binb) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)


def write_stl(path, verts, tris):
    # binary STL from our own triangulation (deterministic byte for byte)
    with open(path, "wb") as f:
        f.write(b"conkay body".ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for a, b, c in tris:
            p, q, r = verts[a], verts[b], verts[c]
            u = [q[i] - p[i] for i in range(3)]; v = [r[i] - p[i] for i in range(3)]
            n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
            ln = math.sqrt(sum(x * x for x in n)) or 1.0
            f.write(struct.pack("<12fH", *(x / ln for x in n), *p, *q, *r, 0))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def export(shape, out_dir, P, kinds):
    os.makedirs(out_dir, exist_ok=True)
    files = {}
    verts, tris = triangulate(shape, P["meshLinear"], P["meshAngular"])
    if "step" in kinds:
        p = os.path.join(out_dir, "body.step")
        w = STEPControl_Writer(); w.Transfer(shape, STEPControl_AsIs); w.Write(p)
        files["step"] = {"path": p, "bytes": os.path.getsize(p)}
    if "stl" in kinds:
        p = os.path.join(out_dir, "body.stl"); write_stl(p, verts, tris)
        files["stl"] = {"path": p, "bytes": os.path.getsize(p), "sha256": sha256(p), "triangles": len(tris)}
    if "glb" in kinds:
        p = os.path.join(out_dir, "body.glb"); write_glb(p, verts, tris)
        files["glb"] = {"path": p, "bytes": os.path.getsize(p), "sha256": sha256(p), "triangles": len(tris)}
    return files


# ------------------------------------------------------------------ commands

DEFAULTS = {
    "skinOffset": 0.04, "thickness": 0.003, "stationCount": 56, "sectionPoints": 40,
    "upperExponent": 3.0, "lowerExponent": 8.0, "beltMin": 0.62, "beltMax": 0.85, "beltFenderDrop": 0.0, "fastbackDeg": 18.0, "greenhouseTaperDeg": 20.0, "floorRiseDeg": 8.0, "beltSigma": 0.30, "profileSigma": 0.12, "lowerOverlap": 0.03,
    "planClosingRadius": 3.0, "roofClosingRadius": 4.0, "floorClosingRadius": 3.0,
    "noseExtension": 0.36, "tailExtension": 0.22, "endTipFraction": 0.06,
    "archClearance": 0.04, "fenderSkin": 0.03, "fenderCover": 0.02,
    "podExponent": 2.5, "podShoulder": 0.10, "podShoulderDrop": 0.08, "podBlend": 0.8, "podMinHalfWidth": 0.30, "blendRadius": 0.08, "sectionSmoothing": 0.5, "rowSigma": 0.07, "podTuck": 0.10,
    "fairSigmaX": 0.25, "fairSigmaTheta": 0.10, "fairAngles": 4, "fairEnds": True, "endTipWidthFraction": 0.24, "fairPolesX": 0, "fairPoleSpacing": 0.24, "fairLambda": 0.0, "maxWidth": None,
    "noseTipHeight": 0.22, "noseShapeExponent": 1.6, "noseRoundExponent": 3.0, "kammAreaRatio": 0.5, "tailRound": 0.0,
    "floorCornerAllowance": 0.015, "maxIterations": 4, "frontalSlices": 240, "meshLinear": 0.004, "meshAngular": 0.25,
}


_T0 = [time.time()]


def tick(label):
    if os.environ.get("CONKAY_BODY_TIMING"):
        sys.stderr.write(f"[{time.time() - _T0[0]:8.2f}s] {label}\n")
        sys.stderr.flush()


def build(req):
    P = {**DEFAULTS, **{k: v for k, v in (req.get("params") or {}).items() if v is not None}}
    req = {**req, "params": P}
    o = P["skinOffset"]
    extra = {}
    history = []
    # Iterate on a fast screening clearance (side surface near each box only); then the exact pass
    # (BRepExtrema to the whole outer shell, wheel wells and caps included) gives the reported values,
    # and a shortfall found only there still triggers another iteration.
    adj = {"widthTrim": 0.0}
    adj_log = []
    for it in range(int(P["maxIterations"]) + 1):
        # The approximating loft (fairPolesX / fairPoleSpacing) may pass slightly outside the faired sections:
        # where it is wider than maxWidth, tighten the fairing's width cap by the excess and loft again. The
        # cap never cuts into a requirement, so when the requirements alone are wider the width stays over
        # and the solver reports it.
        for _ in range(6):
            sections, span = solve_sections(req, extra, adj)
            raw, surf = loft(sections, P, span["floorMin"] if P["fairSigmaX"] > 0 else None)
            if P["fairSigmaX"] <= 0:
                break
            (x0_, y0_, z0_), (x1_, y1_, z1_) = exact_extents(raw, axes=(1,))
            over = (y1_ - y0_) - P["maxWidth"] if P.get("maxWidth") else 0.0
            if over <= 1e-5:
                break
            adj["widthTrim"] += 0.5 * over + 2e-4
            adj_log.append({"iteration": it, "widthOverM": r6(over), "widthTrimM": r6(adj["widthTrim"])})
        tick(f"iteration {it}: sections solved and lofted ({len(sections)})")
        body = cut_all(raw, wheel_tools(req))
        tick("wheel wells cut")
        solid = first_solid(body)
        shell = outer_shell(solid)
        last = it == int(P["maxIterations"])
        short = {}
        enc = [b for b in req["envelopes"] if b.get("enclose", True)]
        if not last:
            for b, (c, _) in zip(enc, clearances_for("fast", enc, solid, shell, surf)):
                if c < o - TOL:
                    short[b["id"]] = (o - c) + 0.002
            tick(f"screening clearances ({len(short)} short)")
        cl = []
        if not short:
            for b, (c, ins) in zip(req["envelopes"], clearances_for("exact", req["envelopes"], solid, shell, surf)):
                cl.append({"id": b["id"], "kind": b.get("kind"), "enclose": b.get("enclose", True), "clearanceM": r6(c), "inside": ins})
                if b.get("enclose", True) and c < o - TOL:
                    short[b["id"]] = (o - c) + 0.002
            # required points (the entry header lines) must lie inside the body
            for p in req.get("points", []):
                if not inside(solid, p["p"]):
                    dp = distance(BRepBuilderAPI_MakeVertex(gp_Pnt(*p["p"])).Vertex(), shell)
                    short[p["id"]] = dp + 0.002
            tick(f"exact clearances ({len(short)} short)")
        history.append({"iteration": it, "short": len(short), "exact": bool(cl), "worstM": r6(min([x["clearanceM"] for x in cl if x["enclose"]] or [0])) if cl else None})
        if not short or last:
            if not cl:
                for b, (c, ins) in zip(req["envelopes"], clearances_for("exact", req["envelopes"], solid, shell, surf)):
                    cl.append({"id": b["id"], "kind": b.get("kind"), "enclose": b.get("enclose", True), "clearanceM": r6(c), "inside": ins})
            break
        for k, v in short.items():
            extra[k] = extra.get(k, 0.0) + v
    val = validity(body)
    tick("validity")
    fair = fairness(surf, (span["xmin"], span["xmax"]))
    tick("fairness")
    m = measure(solid, int(P["frontalSlices"]))
    tick("measured")
    # wheels: the tyre (static, and the front ones swept over the lock) to the body
    wheel_out = []
    for w in req.get("wheels", []):
        cx, cy, cz = w["center"]
        r, hw = w["radius"], w["halfWidth"]
        lock = w.get("steerDeg") or 0.0
        worst = None
        for a in ([0.0] if not lock else [-lock, -lock / 2, 0.0, lock / 2, lock]):
            t = gp_Trsf(); t.SetRotation(gp_Ax1(gp_Pnt(cx, cy, cz), gp_Dir(0, 0, 1)), math.radians(a))
            cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(cx, cy - hw, cz), gp_Dir(0, 1, 0)), r, 2 * hw).Shape()
            cyl = BRepBuilderAPI_Transform(cyl, t, True).Shape()
            d = distance(cyl, shell)
            centre_in = inside(solid, (cx, cy, cz))
            v = -d if centre_in else d
            worst = v if worst is None else min(worst, v)
        g = wheel_geometry(w, P["archClearance"])
        wheel_out.append({"id": w["id"], "minClearanceM": r6(worst), "wellRadiusM": r6(g["wellRadius"]), "wellInnerHalfM": r6(g["innerHalf"]), "steerDeg": lock})
    tick("wheels")
    rays = ray_hits(solid, req.get("rays", []))
    tick("rays")
    files = export(body, req["outDir"], P, req.get("exports", ["step", "stl", "glb"])) if req.get("outDir") else {}
    bb = m["bbox"]
    return {
        "ok": True, "command": "body", "kernel": {"name": "OpenCascade (OCP)", "occt": occt_version(), "script": KERNEL_VERSION},
        "params": P,
        "sections": [rinfo(s["info"]) for s in sections],
        "span": {k: r6(v) for k, v in span.items()},
        "solid": val,
        "metrics": {
            "volumeM3": r6(m["volumeM3"]), "surfaceAreaM2": r6(m["surfaceAreaM2"]), "frontalAreaM2": r6(m["frontalAreaM2"]),
            "frontalSlices": m["frontalSlices"], "frontalMeshLinearM": m["frontalMeshLinearM"], "frontalMaxUnderestimateM2": r6(m["frontalMaxUnderestimateM2"]), "centroid": [r6(v) for v in m["cg"]], "surfaceCentroid": [r6(v) for v in m["scg"]],
            "lengthM": r6(bb["max"][0] - bb["min"][0]), "widthM": r6(bb["max"][1] - bb["min"][1]), "heightM": r6(bb["max"][2]),
            "groundClearanceM": r6(bb["min"][2]), "bbox": {k: [r6(v) for v in vv] for k, vv in bb.items()},
        },
        "clearances": cl, "wheels": wheel_out, "rays": rays, "iterations": history,
        "fairness": fair, "fairing": rinfo({**_FAIR_STATS, "adjustments": adj_log}) if P["fairSigmaX"] > 0 else None,
        "localInflationM": {k: r6(v) for k, v in sorted(extra.items())},
        "files": files,
    }


def rinfo(v):
    if isinstance(v, dict):
        return {k: rinfo(x) for k, x in v.items()}
    if isinstance(v, list):
        return [rinfo(x) for x in v]
    return r6(v) if isinstance(v, float) else v


def ellipsoid(req):
    a, b, c = req["semi"]
    sph = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 1.0).Shape()
    g = gp_GTrsf(); g.SetValue(1, 1, a); g.SetValue(2, 2, b); g.SetValue(3, 3, c)
    e = BRepBuilderAPI_GTransform(sph, g, True).Shape()
    solid = first_solid(e)
    m = measure(solid, int(req.get("slices", 240)))
    return {"ok": True, "command": "ellipsoid", "semi": [a, b, c], "frontalAreaM2": r6(m["frontalAreaM2"]), "volumeM3": r6(m["volumeM3"]),
            "surfaceAreaM2": r6(m["surfaceAreaM2"]), "exactFrontalAreaM2": r6(math.pi * b * c), "exactVolumeM3": r6(4 / 3 * math.pi * a * b * c),
            "solid": validity(solid)}


_REAL_STDOUT = 1


def main():
    global _REAL_STDOUT
    req = json.load(sys.stdin)
    # The kernel's C++ writers (STEP transfer statistics) print to fd 1: send them to stderr so stdout
    # carries only the JSON result.
    sys.stdout.flush()
    _REAL_STDOUT = os.dup(1)
    os.dup2(2, 1)
    cmd = req.get("command", "body")
    try:
        if cmd == "body":
            out = build(req)
        elif cmd == "ellipsoid":
            out = ellipsoid(req)
        elif cmd == "version":
            out = {"ok": True, "kernel": {"name": "OpenCascade (OCP)", "occt": occt_version(), "script": KERNEL_VERSION}}
        else:
            out = {"ok": False, "error": f"unknown command {cmd}"}
    except Exception as ex:  # report, never a partial result
        out = {"ok": False, "error": f"{type(ex).__name__}: {ex}"}
    os.write(_REAL_STDOUT, json.dumps(out, sort_keys=True).encode())


if __name__ == "__main__":
    main()
