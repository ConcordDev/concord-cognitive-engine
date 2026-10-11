#!/usr/bin/env python3
# server/lib/conkay/cad/conkay_drawing_occ.py
#
# ConKay drawing projections on OpenCascade (OCP): reads one JSON request on
# stdin, writes one JSON result on stdout. Standard library + OCP only; runs on
# OCP 7.7 (statics suffixed _s) and 7.8+.
#
# command "project": hidden-line removal of a STEP solid into orthographic
# views. Each view is a projector (view direction toward the viewer, and the
# drawing's x axis); the result is the visible and the hidden edges as 2D
# polylines in model metres (drawing x along the projector's x axis, drawing y
# up the sheet).
#
# Method: HLRBRep_PolyAlgo on the solid's triangulation (BRepMesh with the
# requested linear / angular deflection). The exact HLRBRep_Algo was tried on
# the CAD body and finds no silhouettes on its one large B-spline face, so the
# polygonal algorithm is used; its edges are within the tessellation's chordal
# deflection of the surface, and the result carries that tolerance. Smooth
# (G1) edges, such as the periodic seam of the lofted face, are not drawn: they
# are not visible edges of the part. Silhouette segments of a near-tangent
# surface can be misclassified hidden over short lengths (a property of the
# polygonal algorithm), which the result reports as such, never corrects.

import sys, json, math, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extents_occ import bracketed_extents

from OCP.STEPControl import STEPControl_Reader
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.HLRBRep import HLRBRep_PolyAlgo, HLRBRep_PolyHLRToShape
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GCPnts import GCPnts_QuasiUniformDeflection
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.TopAbs import TopAbs_FACE
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.gp import gp_Pln

SCRIPT_VERSION = "1.2.0"
Q = 1e-4  # output grid: 0.1 mm


def _st(cls, name):
    return getattr(cls, name + "_s", None) or getattr(cls, name)


def occt_version():
    try:
        from OCP.Standard import Standard_Version
        return _st(Standard_Version, "String")()
    except Exception:
        import OCP
        return getattr(OCP, "__version__", None)


def load_step(path):
    rd = STEPControl_Reader()
    if rd.ReadFile(path) != 1:
        raise RuntimeError(f"cannot read STEP {path}")
    rd.TransferRoots()
    return rd.OneShape()


def edges_of(compound, deflection):
    out = []
    if compound is None or compound.IsNull():
        return out
    ex = TopExp_Explorer(compound, TopAbs_EDGE)
    while ex.More():
        e = _st(TopoDS, "Edge")(ex.Current())
        ex.Next()
        a = BRepAdaptor_Curve(e)
        g = GCPnts_QuasiUniformDeflection(a, deflection)
        if not g.IsDone() or g.NbPoints() < 2:
            continue
        pts = [(round(g.Value(i).X() / Q) * Q, round(g.Value(i).Y() / Q) * Q) for i in range(1, g.NbPoints() + 1)]
        dedup = [pts[0]] + [p for a_, p in zip(pts, pts[1:]) if p != a_]
        if len(dedup) >= 2:
            out.append(dedup)
    return out


def chain(segs):
    """Join polylines that share end points (on the 0.1 mm grid) into longer ones; deterministic order."""
    segs = sorted(segs)
    ends = {}
    for i, s in enumerate(segs):
        for k in (s[0], s[-1]):
            ends.setdefault(k, []).append(i)
    used = [False] * len(segs)
    out = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        line = list(segs[i])
        for _ in range(2):  # extend from the tail, then (reversed) from the other end
            while True:
                tip = line[-1]
                nxt = next((j for j in ends.get(tip, []) if not used[j]), None)
                if nxt is None:
                    break
                used[nxt] = True
                s_ = segs[nxt]
                line.extend((s_ if s_[0] == tip else list(reversed(s_)))[1:])
            line.reverse()
        out.append([[round(x, 4), round(y, 4)] for x, y in line])
    return out


def mesh_vertices_tris(shape):
    verts, tris = [], []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        face = _st(TopoDS, "Face")(ex.Current())
        ex.Next()
        loc = TopLoc_Location()
        tri = _st(BRep_Tool, "Triangulation")(face, loc)
        if tri is None:
            continue
        tr = loc.Transformation()
        base = len(verts)
        for i in range(1, tri.NbNodes() + 1):
            q = tri.Node(i).Transformed(tr)
            verts.append((q.X(), q.Y(), q.Z()))
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            tris.append((base + a - 1, base + b - 1, base + c - 1))
    return verts, tris


def outer_outline(verts, tris, xdir, ydir, step):
    """The outer outline of the projected solid: slices at drawing-x spacing `step`; at each slice the
    lowest and highest drawing-y of the triangulation's cross-section (exact for the mesh, which is
    inscribed in the surface by at most its deflection). Returns one closed polyline (upper edge, then
    the lower edge back), or None. Unlike hidden-line removal this needs no silhouette edge, so it holds
    on faces seen exactly edge-on (a flat floor from the side)."""
    P = [(v[0] * xdir[0] + v[1] * xdir[1] + v[2] * xdir[2], v[0] * ydir[0] + v[1] * ydir[1] + v[2] * ydir[2]) for v in verts]
    s0 = min(p[0] for p in P); s1 = max(p[0] for p in P)
    n = max(2, int(math.ceil((s1 - s0) / step)))
    ss = [s0 + (s1 - s0) * i / n for i in range(n + 1)]
    lo = [math.inf] * (n + 1); hi = [-math.inf] * (n + 1)
    for t in tris:
        q = [P[i] for i in t]
        a_, b_ = min(x for x, _ in q), max(x for x, _ in q)
        i0 = max(0, int(math.ceil((a_ - s0) / (s1 - s0) * n - 1e-9))); i1 = min(n, int(math.floor((b_ - s0) / (s1 - s0) * n + 1e-9)))
        for i in range(i0, i1 + 1):
            x = ss[i]
            for (xa, ya), (xb, yb) in ((q[0], q[1]), (q[1], q[2]), (q[2], q[0])):
                if (xa - x) * (xb - x) <= 0:
                    y = ya if xa == xb else ya + (x - xa) / (xb - xa) * (yb - ya)
                    if xa == xb:
                        lo[i] = min(lo[i], ya, yb); hi[i] = max(hi[i], ya, yb)
                    else:
                        lo[i] = min(lo[i], y); hi[i] = max(hi[i], y)
    pts = [(x, h) for x, h in zip(ss, hi) if h > -math.inf]
    low = [(x, l) for x, l in zip(ss, lo) if l < math.inf]
    if len(pts) < 2:
        return None
    ring = pts + list(reversed(low)) + [pts[0]]
    out = [[round(x / Q) * Q, round(y / Q) * Q] for x, y in ring]
    return [[round(x, 4), round(y, 4)] for x, y in out]


def exact_extents(shape):
    """Bracketed extents (extents_occ.py). The earlier BRepExtrema plane-distance method converged to local
    solutions on ConKay bodies (up to 9.6 mm inside the surface) and is not used."""
    r = bracketed_extents(shape)
    return {"min": [round(v, 6) for v in r["min"]], "max": [round(v, 6) for v in r["max"]],
            "minBracket": [[round(a, 6), round(b, 6)] for a, b in r["minBracket"]], "maxBracket": [[round(a, 6), round(b, 6)] for a, b in r["maxBracket"]],
            "addOptimalBox": {k: [round(v, 6) for v in vv] for k, vv in r["box"].items()}, "meshDeflectionM": r["meshDeflection"],
            "method": r["method"], "version": r["version"]}

def length(lines):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for l in lines for a, b in zip(l, l[1:]))


def project(req):
    shape = load_step(req["step"])
    lin, ang = req.get("linearDeflection", 0.002), req.get("angularDeflection", 0.05)
    defl = req.get("curveDeflection", 0.001)
    _st(BRepTools, "Clean")(shape)
    BRepMesh_IncrementalMesh(shape, lin, False, ang, False)
    extents = exact_extents(shape)
    verts, tris = mesh_vertices_tris(shape)
    step = req.get("outlineStep", 0.002)
    views = {}
    for v in req["views"]:
        d, x = v["dir"], v["xDir"]
        algo = HLRBRep_PolyAlgo()
        algo.Load(shape)
        algo.Projector(HLRAlgo_Projector(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(*d), gp_Dir(*x))))
        algo.Update()
        h = HLRBRep_PolyHLRToShape()
        h.Update(algo)
        vis = chain(edges_of(h.VCompound(), defl) + edges_of(h.OutLineVCompound(), defl))
        hid = chain(edges_of(h.HCompound(), defl) + edges_of(h.OutLineHCompound(), defl))
        xd = v["xDir"]
        yd = [d[1] * xd[2] - d[2] * xd[1], d[2] * xd[0] - d[0] * xd[2], d[0] * xd[1] - d[1] * xd[0]]  # drawing y = dir x xDir
        ring = outer_outline(verts, tris, xd, yd, step)
        pts = [p for l in vis for p in l] + (ring or [])
        bb = [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)] if pts else None
        views[v["id"]] = {"visible": vis, "hidden": hid, "outline": ring, "bbox": bb,
                          "visibleLengthM": round(length(vis), 4), "hiddenLengthM": round(length(hid), 4)}
    return {"ok": True, "command": "project", "views": views, "extents": extents,
            "kernel": {"name": "OpenCascade (OCP)", "occt": occt_version(), "script": SCRIPT_VERSION},
            "method": {"algorithm": "HLRBRep_PolyAlgo (polygonal hidden-line removal)", "linearDeflectionM": lin, "angularDeflectionRad": ang,
                       "curveDeflectionM": defl, "gridM": Q,
                       "tolerance": f"edges lie within the tessellation's chordal deflection ({lin} m) of the B-rep surface; output on a {Q} m grid",
                       "notDrawn": "smooth (G1) edges, e.g. the lofted face's periodic seam",
                       "outline": f"outer outline per view from {step} m slices of the triangulation (lowest / highest point of each cross-section); holds where hidden-line removal finds no silhouette (faces seen edge-on)"}}


def main():
    req = json.load(sys.stdin)
    import os
    sys.stdout.flush()
    real = os.dup(1)
    os.dup2(2, 1)  # OCC C++ chatter to stderr; stdout carries only the JSON
    try:
        out = project(req) if req.get("command") == "project" else {"ok": False, "error": f"unknown command {req.get('command')}"}
    except Exception as ex:  # report, never a partial result
        out = {"ok": False, "error": f"{type(ex).__name__}: {ex}"}
    os.write(real, json.dumps(out, sort_keys=True).encode())


if __name__ == "__main__":
    main()
