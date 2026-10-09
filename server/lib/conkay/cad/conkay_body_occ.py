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
from OCP.gp import gp_Pnt, gp_Ax2, gp_Ax1, gp_Dir, gp_Trsf, gp_Lin, gp_GTrsf
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

KERNEL_VERSION = "1.1.0"


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


def needs(pts, W, zs, nu, nl, zb=None):
    """Smallest zt (and, with zb None, the largest zb) containing pts for half width W and belt zs.
    With zb given (a fixed floor), None unless every point below the belt fits the lower half."""
    zt, zbn = zs + 1e-3, zs - 1e-3
    for u, z in pts:
        if u >= W:
            return None
        f = (u / W)
        if z >= zs:
            k = (1 - f ** nu) ** (1 / nu)
            zt = max(zt, zs + (z - zs) / k)
        elif zb is None:
            k = (1 - f ** nl) ** (1 / nl)
            zbn = min(zbn, zs - (zs - z) / k)
        else:
            if zs - zb <= 1e-9 or f ** nl + ((zs - z) / (zs - zb)) ** nl > 1 + 1e-12:
                return None
    return zt, (zbn if zb is None else zb)


def section_area(W, zs, zt, zb, nu, nl):
    return 2 * W * ((zt - zs) * quarter_area(nu) + (zs - zb) * quarter_area(nl))


def best_section(pts, nu, nl, zb=None, zs_fixed=None, floor_drop=None):
    """Minimum-area section containing pts: floor free (zb None; then at most floor_drop below the lowest
    point, so the floor is not traded for width) or fixed at zb; belt free or at zs_fixed."""
    umax = max(u for u, _ in pts)
    zmin = min(z for _, z in pts)
    zmax = max(z for _, z in pts)
    lo = zmin if zb is None else zb + 0.01
    best = None
    def ev(W, zs):
        nonlocal best
        r = needs(pts, W, zs, nu, nl, zb)
        if r is None:
            return
        if zb is None and floor_drop is not None and r[1] < zmin - floor_drop:
            return
        a = section_area(W, zs, r[0], r[1], nu, nl)
        if best is None or a < best[0] - 1e-12:
            best = (a, W, zs, r[0], r[1])
    zss = [zs_fixed] if zs_fixed is not None else [lo + (zmax - lo) * i / 30 for i in range(31)]
    W = umax + 0.004
    while best is None or W < best[1] + 0.3:
        for zs in zss:
            ev(W, zs)
        W += 0.01
        if W > umax + 3.0:
            break
    if best is None:
        return None
    _, W0, zs0, _, _ = best
    for i in range(-5, 6):
        Wi = max(umax + 0.002, W0 + 0.002 * i)
        for j in ([0] if zs_fixed is not None else range(-6, 7)):
            ev(Wi, zs_fixed if zs_fixed is not None else min(max(zs0 + j * (zmax - lo) / 180, lo), zmax))
    return {"W": best[1], "zs": best[2], "zt": best[3], "zb": best[4]}


def closing(xs, f, R, above=True):
    """Morphological closing of samples f(x) by a disc of radius R (from above if above, else from below)."""
    s = 1 if above else -1
    g = [s * v for v in f]
    n = len(xs)
    dil = []
    for i in range(n):
        m = -1e9
        for j in range(n):
            d = abs(xs[i] - xs[j])
            if d < R:
                m = max(m, g[j] + math.sqrt(R * R - d * d) - R)
        dil.append(m)
    out = []
    for i in range(n):
        m = 1e9
        for j in range(n):
            d = abs(xs[i] - xs[j])
            if d < R:
                m = min(m, dil[j] - math.sqrt(R * R - d * d) + R)
        out.append(max(m, g[i]))
    return [s * v for v in out]


def moving_average(v, k):
    n = len(v)
    out = []
    for i in range(n):
        lo, hi = max(0, i - k), min(n, i + k + 1)
        out.append(sum(v[lo:hi]) / (hi - lo))
    return out


# ------------------------------------------------------------ the section solve

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


def solve_sections(req, extra):
    P = req["params"]
    o = P["skinOffset"]
    nu, nl = P["upperExponent"], P["lowerExponent"]
    boxes = [e for e in req["envelopes"] if e.get("enclose", True)]
    allc = [box_corners(b) for b in boxes]
    xmin = min(p[0] for c in allc for p in c) - o
    xmax = max(p[0] for c in allc for p in c) + o
    n = int(P["stationCount"])
    dx = (xmax - xmin) / (n - 1)
    xs = [xmin + i * dx for i in range(n)]
    wheels = req.get("wheels", [])
    # requirement points per station (u = |y|, z), each inflated by the skin offset (+ any local extra)
    reqs = []
    for i, x in enumerate(xs):
        pts = []
        for b, c in zip(boxes, allc):
            oo = o + extra.get(b["id"], 0.0)
            for (y, z) in slab_vertices(c, x - dx / 2 - oo, x + dx / 2 + oo):
                pts.append((abs(y) + oo, z + oo))
                pts.append((abs(y) + oo, z - oo))
        for p in req.get("points", []):
            # both stations either side of the point carry it (the skin between them interpolates)
            if abs(p["p"][0] - x) <= dx:
                pts.append((abs(p["p"][1]), p["p"][2] + extra.get(p["id"], 0.0)))
        for w in wheels:
            g = wheel_geometry(w, P["archClearance"])
            cx, cy, cz = w["center"]
            for xx in (x - dx / 2, x, x + dx / 2):
                d = abs(xx - cx)
                if d < g["wellRadius"]:
                    top = cz + math.sqrt(g["wellRadius"] ** 2 - d * d) + P["fenderSkin"]
                    for u in (abs(cy) - w["halfWidth"], abs(cy) + w["halfWidth"]):
                        pts.append((u, top))
                if d < w["radius"]:
                    pts.append((abs(cy) + w["halfWidth"] + P["fenderCover"], cz))
        if pts:
            mir = pts + [(-u, z) for u, z in pts]
            pts = [(u, z) for u, z in hull(mir) if u >= 0]
        reqs.append(pts)
    for i in range(len(reqs)):  # a station with nothing in its window takes its neighbour's points
        if not reqs[i]:
            j = min((k for k in range(len(reqs)) if reqs[k]), key=lambda k: abs(k - i))
            reqs[i] = reqs[j]
    # 1. per-station minimum-area sections (floor and belt free); 2. the floor smoothed from below
    # (a flat floor), the belt smoothed by a moving average; 3. half width for that floor and belt,
    # smoothed in plan; 4. roof for that width, smoothed from above.
    first = [best_section(p, nu, nl, floor_drop=P["floorCornerAllowance"]) or best_section(p, nu, nl) for p in reqs]
    zb = closing(xs, [f["zb"] for f in first], P["floorClosingRadius"], above=False)
    zs = moving_average([f["zs"] for f in first], int(P.get("beltSmoothing", 8)))
    Wst = []
    for p, b, z in zip(reqs, zb, zs):
        r = best_section(p, nu, nl, b, zs_fixed=z)
        Wst.append(r["W"] if r else max(u for u, _ in p) + 0.004)
    W = closing(xs, Wst, P["planClosingRadius"], above=True)
    zt_req = []
    for i, (p, Wi, b) in enumerate(zip(reqs, W, zb)):
        r = needs(p, Wi, zs[i], nu, nl, b)
        while r is None:  # widen until the smoothed belt and floor fit
            Wi += 0.002
            r = needs(p, Wi, zs[i], nu, nl, b)
        W[i] = Wi
        zt_req.append(r[0])
    zt = closing(xs, zt_req, P["roofClosingRadius"], above=True)
    secs = [{"x": x, "W": a, "zs": b, "zt": c, "zb": d} for x, a, b, c, d in zip(xs, W, zs, zt, zb)]
    # nose and tail: quarter-ellipse taper in plan and height about the belt line, ahead of / behind the envelopes
    def taper(base, x, L, d):
        s = math.sqrt(max(0.0, 1 - (1 - d / L) ** 2))
        return {"x": x, "W": base["W"] * s, "zs": base["zs"], "zt": base["zs"] + (base["zt"] - base["zs"]) * s, "zb": base["zs"] - (base["zs"] - base["zb"]) * s}
    Ln, Lt = P["noseExtension"], P["tailExtension"]
    nose = [taper(secs[0], xmin - Ln + f * Ln, Ln, max(f, P["endTipFraction"]) * Ln) for f in (0.0, 0.35, 0.7)]
    tail = [taper(secs[-1], xmax + Lt - f * Lt, Lt, max(f, P["endTipFraction"]) * Lt) for f in (0.7, 0.35, 0.0)]
    return nose + secs + tail, {"xmin": xmin, "xmax": xmax, "dx": dx}


# ------------------------------------------------------------------ the solid

def section_points(s, nu, nl, m):
    half = []
    for i in range(m + 1):
        t = math.pi / 2 * i / m
        half.append((s["W"] * math.sin(t) ** (2 / nu), s["zs"] + (s["zt"] - s["zs"]) * math.cos(t) ** (2 / nu)))
    for i in range(1, m + 1):
        t = math.pi / 2 * i / m
        half.append((s["W"] * math.cos(t) ** (2 / nl), s["zs"] - (s["zs"] - s["zb"]) * math.sin(t) ** (2 / nl)))
    return half + [(-y, z) for (y, z) in reversed(half[1:-1])]


def section_curve(s, nu, nl, m):
    pts = section_points(s, nu, nl, m)
    arr = HArrPnt(1, len(pts))
    par = HArrReal(1, len(pts) + 1)  # periodic: one more parameter, closing the curve
    for i, (y, z) in enumerate(pts):
        arr.SetValue(i + 1, gp_Pnt(s["x"], y, z))
    for i in range(len(pts) + 1):
        par.SetValue(i + 1, float(i))  # the same parameters on every section: one knot vector
    it = GeomAPI_Interpolate(arr, par, True, 1e-7)
    it.Perform()
    return it.Curve()


def loft(sections, P):
    """Skin the sections: a periodic cubic B-spline per section (identical knots), then each pole row
    interpolated along x by a cubic B-spline (parameter = station x). The surface passes exactly through
    every section; the ends are closed with planar caps and the faces sewn into one solid."""
    nu, nl, m = P["upperExponent"], P["lowerExponent"], int(P["sectionPoints"])
    curves = [section_curve(s, nu, nl, m) for s in sections]
    c0 = curves[0]
    npu = c0.NbPoles()
    xs = [s["x"] for s in sections]
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
    def kv(c):
        kn = Arr1Real(1, c.NbKnots()); mu = Arr1Int(1, c.NbKnots())
        for i in range(1, c.NbKnots() + 1):
            kn.SetValue(i, c.Knot(i)); mu.SetValue(i, c.Multiplicity(i))
        return kn, mu
    uk, um = kv(c0)
    vk, vm = kv(r0)
    surf = Geom_BSplineSurface(poles, uk, vk, um, vm, c0.Degree(), r0.Degree(), True, False)
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
    seg = Geom_BSplineSurface(surf)
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


def bbox(shape):
    bx = Bnd_Box()
    _st(BRepBndLib, 'AddOptimal')(shape, bx, False, False)
    return box_limits(bx)


def measure(solid, slices, lin=0.002, ang=0.1):
    g = GProp_GProps(); _st(BRepGProp, 'VolumeProperties')(solid, g)
    vol = g.Mass(); cg = g.CentreOfMass()
    g2 = GProp_GProps(); _st(BRepGProp, 'SurfaceProperties')(solid, g2)
    area = g2.Mass(); scg = g2.CentreOfMass()
    x0, y0, z0, x1, y1, z1 = bbox(solid)
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
    "skinOffset": 0.04, "thickness": 0.003, "stationCount": 44, "sectionPoints": 20,
    "upperExponent": 2.4, "lowerExponent": 8.0, "beltSmoothing": 8,
    "planClosingRadius": 8.0, "roofClosingRadius": 2.5, "floorClosingRadius": 40.0,
    "noseExtension": 0.16, "tailExtension": 0.10, "endTipFraction": 0.04,
    "archClearance": 0.04, "fenderSkin": 0.03, "fenderCover": 0.02,
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
    for it in range(int(P["maxIterations"]) + 1):
        sections, span = solve_sections(req, extra)
        tick(f"iteration {it}: sections solved ({len(sections)})")
        raw, surf = loft(sections, P)
        tick("lofted")
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
        "sections": [{k: r6(v) for k, v in s.items()} for s in sections],
        "span": {k: r6(v) for k, v in span.items()},
        "solid": val,
        "metrics": {
            "volumeM3": r6(m["volumeM3"]), "surfaceAreaM2": r6(m["surfaceAreaM2"]), "frontalAreaM2": r6(m["frontalAreaM2"]),
            "frontalSlices": m["frontalSlices"], "frontalMeshLinearM": m["frontalMeshLinearM"], "frontalMaxUnderestimateM2": r6(m["frontalMaxUnderestimateM2"]), "centroid": [r6(v) for v in m["cg"]], "surfaceCentroid": [r6(v) for v in m["scg"]],
            "lengthM": r6(bb["max"][0] - bb["min"][0]), "widthM": r6(bb["max"][1] - bb["min"][1]), "heightM": r6(bb["max"][2]),
            "groundClearanceM": r6(bb["min"][2]), "bbox": {k: [r6(v) for v in vv] for k, vv in bb.items()},
        },
        "clearances": cl, "wheels": wheel_out, "rays": rays, "iterations": history,
        "localInflationM": {k: r6(v) for k, v in sorted(extra.items())},
        "files": files,
    }


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
