# server/lib/conkay/cad/extents_occ.py
#
# Extents of a B-rep solid along x, y and z, BRACKETED from both sides, shared by
# the CAD body kernel (conkay_body_occ.py) and the drawing kernel
# (conkay_drawing_occ.py). Standard library + OCP; OCP 7.7 and 7.8+.
#
# Why bracketed: two shortcuts were found wrong on ConKay bodies (2026-10-09):
#   - BRepBndLib::AddOptimal is an OUTER bound: tight on the faired body, but
#     12.6 mm outside the surface of a v2.0 (interpolated) body;
#   - BRepExtrema distance from the solid to a bounding plane converged to a
#     local solution and reported extents inside the surface (9.6 mm low on a
#     test body, 1.1 mm per side on the car's width).
# So each extent here is a value with a proof on each side:
#   attained  a point ON the surface: the extreme node of a fine triangulation,
#             refined by gradient ascent on its face's surface, kept inside the
#             trimmed face (BRepClass_FaceClassifier); the true extent is at
#             least this far out;
#   bound     the smaller of AddOptimal's box and the extreme node plus the mesh
#             deflection; the true extent is at most this far out.
# The reported value is the attained one; the bracket [attained, bound] is its
# uncertainty (zero width when the outer bound is reached).

import math

from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_IN, TopAbs_ON
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.gp import gp_Pnt, gp_Pnt2d, gp_Vec

EXTENTS_VERSION = "1.0.0"


def _st(cls, name):
    return getattr(cls, name + "_s", None) or getattr(cls, name)


def outer_box(shape):
    b = Bnd_Box()
    _st(BRepBndLib, "AddOptimal")(shape, b, False, False)
    lo, hi = b.CornerMin(), b.CornerMax()
    return [lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]


def bracketed_extents(shape, axes=(0, 1, 2), lin=0.001, starts=4, iters=200):
    """{"min", "max": [x, y, z] attained values; "minBracket", "maxBracket": [[lo, hi]] per axis (None for axes not
    asked); "box": AddOptimal; "meshDeflection"; "method"}. Remeshes the shape at `lin`."""
    box_lo, box_hi = outer_box(shape)
    _st(BRepTools, "Clean")(shape)
    BRepMesh_IncrementalMesh(shape, lin, False, 0.1, False)
    faces, nodes = [], []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = _st(TopoDS, "Face")(ex.Current())
        ex.Next()
        loc = TopLoc_Location()
        tri = _st(BRep_Tool, "Triangulation")(f, loc)
        if tri is None:
            continue
        fi = len(faces)
        faces.append(f)
        tr = loc.Transformation()
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(tr)
            uv = tri.UVNode(i)
            nodes.append(((p.X(), p.Y(), p.Z()), fi, uv.X(), uv.Y()))
    if not nodes:
        raise RuntimeError("extents: the shape has no triangulation")
    cache = {}

    def surface(fi):
        if fi not in cache:
            u1, u2, v1, v2 = _st(BRepTools, "UVBounds")(faces[fi])
            cache[fi] = (BRepAdaptor_Surface(faces[fi]), (u1, u2, v1, v2))
        return cache[fi]

    def inside(fi, u, v):
        return BRepClass_FaceClassifier(faces[fi], gp_Pnt2d(u, v), 1e-7).State() in (TopAbs_IN, TopAbs_ON)

    def refine(ax, sg, fi, u, v):
        s, (u1, u2, v1, v2) = surface(fi)
        P, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
        s.D1(u, v, P, du, dv)
        best = sg * P.Coord(ax + 1)
        step = 0.05 * max(u2 - u1, v2 - v1)
        for _ in range(iters):
            g = (sg * du.Coord(ax + 1), sg * dv.Coord(ax + 1))
            n = math.hypot(*g)
            if n < 1e-14 or step < 1e-12:
                break
            un = min(max(u + step * g[0] / n, u1), u2)
            vn = min(max(v + step * g[1] / n, v1), v2)
            if inside(fi, un, vn):
                s.D1(un, vn, P, du, dv)
                val = sg * P.Coord(ax + 1)
                if val > best + 1e-13:
                    best, u, v = val, un, vn
                    continue
            s.D1(u, v, P, du, dv)
            step *= 0.5
        return sg * best

    out = {"min": list(box_lo), "max": list(box_hi), "minBracket": [None] * 3, "maxBracket": [None] * 3,
           "box": {"min": box_lo, "max": box_hi}, "meshDeflection": lin, "version": EXTENTS_VERSION,
           "method": "attained: extreme node of a triangulation refined by gradient ascent on its face's surface inside the trimmed face (a point on the surface); bound: min(AddOptimal box (a strict outer bound), extreme node + mesh deflection (BRepMesh's target chordal deflection, approximate)). Value = attained; bracket = [attained, bound]."}
    for ax in axes:
        for side, sg in (("min", -1), ("max", 1)):
            ranked = sorted(nodes, key=lambda n: -sg * n[0][ax])
            mesh_ext = ranked[0][0][ax]
            picks, seen = [], set()
            for n in ranked[: 200 * starts]:
                if n[1] in seen and len(picks) >= 1:
                    continue
                picks.append(n)
                seen.add(n[1])
                if len(picks) >= starts:
                    break
            vals = [mesh_ext] + [refine(ax, sg, n[1], n[2], n[3]) for n in picks]
            attained = max(vals) if sg > 0 else min(vals)
            if sg > 0:
                bound = min(box_hi[ax], mesh_ext + lin)
                out["max"][ax] = attained
                out["maxBracket"][ax] = [attained, max(bound, attained)]
            else:
                bound = max(box_lo[ax], mesh_ext - lin)
                out["min"][ax] = attained
                out["minBracket"][ax] = [min(bound, attained), attained]
    return out
