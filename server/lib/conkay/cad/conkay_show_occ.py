# server/lib/conkay/cad/conkay_show_occ.py
#
# Visual polish (c): the "show solid". Cuts the design-surface apertures into
# a COPY of the analysed body (cad.body's STEP) and re-measures it with the
# body kernel's own functions. The analysed body is never replaced.
#
# Each glazing / lamp aperture is a prism along its outward direction d. The
# pane is the slab of the body inside that prism between the outer skin and
# the skin shifted inward by the pane depth along d:
#     P    = body ∩ prism
#     pane = P − translate(body, −depth·d)
# (Restricting to the prism first keeps the boolean clear of the body's flat
# faces that run parallel to d, which coincide with their own translates.)
# The show solid is body − panes − door grooves; show ∪ panes = body − grooves
# exactly, so the outer shape is unchanged except for the door grooves.
#
# Door gaps are grooves: a band of the given width around the door outline,
# depth along d, cut and NOT refilled.
#
# Re-measured on the reassembled body (show ∪ panes):
#   - every envelope's exact clearance to the outer surface (BRepExtrema +
#     solid classification: clearance() of conkay_body_occ.py), the entry
#     points inside, and the J1100 rays;
#   - volume, surface area and frontal area (measure() of conkay_body_occ.py);
#   - volume conservation: V(body) − V(show) − ΣV(panes) − ΣV(grooves).
# Which J1100 ray first meets glass (a pane) is reported as geometry only.
#
#   echo '{"command":"show", ...}' | python conkay_show_occ.py

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import conkay_body_occ as K  # noqa: E402  (the body kernel's own measurement functions)

from OCP.STEPControl import STEPControl_Reader  # noqa: E402
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Common, BRepAlgoAPI_Fuse  # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace  # noqa: E402
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffset  # noqa: E402
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism  # noqa: E402
from OCP.BRepCheck import BRepCheck_Analyzer  # noqa: E402
from OCP.BRepGProp import BRepGProp  # noqa: E402
from OCP.GProp import GProp_GProps  # noqa: E402
from OCP.GeomAbs import GeomAbs_Intersection  # noqa: E402
from OCP.TopoDS import TopoDS_Compound, TopoDS  # noqa: E402
from OCP.BRep import BRep_Builder  # noqa: E402
from OCP.TopAbs import TopAbs_WIRE  # noqa: E402
from OCP.gp import gp_Trsf, gp_Vec, gp_Pnt  # noqa: E402

SHOW_VERSION = "1.0.0"
VOL_EPS = 1e-6  # GProp integration tolerance: the default is too coarse to see a 5 mm pane (measured 2026-10-16)
r6 = K.r6


def vol(s):
    p = GProp_GProps()
    BRepGProp.VolumeProperties_s(s, p, VOL_EPS, True)
    return p.Mass()


def bop(cls, a, b):
    o = cls(a, b)
    o.Build()
    if not o.IsDone():
        raise RuntimeError(f"{cls.__name__} failed")
    return o.Shape()


def compound(shapes):
    c = TopoDS_Compound()
    b = BRep_Builder()
    b.MakeCompound(c)
    for s in shapes:
        b.Add(c, s)
    return c


def translate(shape, v):
    t = gp_Trsf()
    t.SetTranslation(gp_Vec(*v))
    return BRepBuilderAPI_Transform(shape, t, True).Shape()


def polygon_wire(pts):
    p = BRepBuilderAPI_MakePolygon()
    for q in pts:
        p.Add(gp_Pnt(*q))
    p.Close()
    return p.Wire()


def prism_of(wire, d, length):
    face = BRepBuilderAPI_MakeFace(wire, True).Face()
    return BRepPrimAPI_MakePrism(face, gp_Vec(*(c * length for c in d))).Shape()


def offset_wire(wire, dist):
    """Planar 2D offset of a closed wire (+ outward, − inward for a CCW-in-its-plane wire), sharp corners."""
    face = BRepBuilderAPI_MakeFace(wire, True).Face()
    m = BRepOffsetAPI_MakeOffset(face, GeomAbs_Intersection)
    m.Perform(dist)
    if not m.IsDone():
        raise RuntimeError("2D offset of the door outline failed")
    for w in K.explore(m.Shape(), TopAbs_WIRE):
        return TopoDS.Wire_s(w)
    raise RuntimeError("2D offset gave no wire")


def area_of(face_wire):
    p = GProp_GProps()
    BRepGProp.SurfaceProperties_s(BRepBuilderAPI_MakeFace(face_wire, True).Face(), p)
    return p.Mass()


def aperture_tool(a):
    d = a["dir"]
    w = polygon_wire(a["outline3d"])
    if a["kind"] == "door-gap":
        half = a["gapWidthM"] / 2
        outer, inner = offset_wire(w, half), offset_wire(w, -half)
        # the larger-area wire is the outside of the band whichever way the outline winds
        if area_of(outer) < area_of(inner):
            outer, inner = inner, outer
        return bop(BRepAlgoAPI_Cut, prism_of(outer, d, a["lengthM"]), prism_of(inner, d, a["lengthM"]))
    return prism_of(w, d, a["lengthM"])


def show(req):
    rd = STEPControl_Reader()
    if rd.ReadFile(req["step"]) != 1:
        return {"ok": False, "error": f"could not read {req['step']}"}
    rd.TransferRoots()
    body = K.first_solid(rd.OneShape())
    if body is None:
        return {"ok": False, "error": "the STEP has no solid"}
    v_body = vol(body)
    K.tick("body read")
    panes, grooves, rows = [], [], []
    for a in req["apertures"]:
        tool = aperture_tool(a)
        P = bop(BRepAlgoAPI_Common, body, tool)
        inward = [-c * a["depthM"] for c in a["dir"]]
        piece = bop(BRepAlgoAPI_Cut, P, translate(body, inward))
        v = vol(piece)
        solid_ok = BRepCheck_Analyzer(piece).IsValid()
        row = {"id": a["id"], "kind": a["kind"], "volumeM3": r6(v), "valid": solid_ok, "depthM": a["depthM"]}
        if a["kind"] == "door-gap":
            grooves.append(piece)
            row["gapWidthM"] = a["gapWidthM"]
        else:
            panes.append((a["id"], a["kind"], piece))
        rows.append(row)
        K.tick(f"aperture {a['id']}: {v:.6f} m3")
    cut_tools = [p for _, _, p in panes] + grooves
    show_solid = bop(BRepAlgoAPI_Cut, body, compound(cut_tools)) if cut_tools else body
    v_show = vol(show_solid)
    v_panes = sum(vol(p) for _, _, p in panes)
    v_grooves = sum(vol(g) for g in grooves)
    conservation = v_body - v_show - v_panes - v_grooves
    K.tick("show solid cut")

    # reassemble: show ∪ panes (= body − grooves) and re-measure with the body kernel's functions
    re = bop(BRepAlgoAPI_Fuse, show_solid, compound([p for _, _, p in panes])) if panes else show_solid
    re_solid = K.first_solid(re)
    re_shell = K.outer_shell(re_solid)
    v_re = vol(re_solid)
    cl = []
    for b in req["envelopes"]:
        c, ins = K.clearance(re_solid, re_shell, b)
        cl.append({"id": b["id"], "kind": b.get("kind"), "enclose": b.get("enclose", True), "clearanceM": r6(c), "inside": ins})
    K.tick("clearances")
    points = [{"id": p["id"], "inside": K.inside(re_solid, p["p"])} for p in req.get("points", [])]
    rays = K.ray_hits(re_solid, req.get("rays", []))
    # which ray meets glass first: the exit point lies on a pane
    glass_hit = {}
    for r, h in zip(req.get("rays", []), rays):
        if h["distanceM"] is None:
            continue
        o, dd = r["origin"], r["dir"]
        n = math.sqrt(sum(x * x for x in dd))
        p = [o[i] + h["distanceM"] * dd[i] / n for i in range(3)]
        vtx = K.BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex()
        hit = []
        for pid, _, pane in panes:
            dist = K.distance(vtx, pane)  # 0.0 is a hit: never fold it into a default with `or`
            if dist is not None and dist < 1e-4:
                hit.append(pid)
        glass_hit[r["id"]] = hit[0] if hit else None
    K.tick("rays")
    m = K.measure(re_solid, int(req.get("frontalSlices") or K.DEFAULTS["frontalSlices"]))
    K.tick("measured")
    files = {}
    if req.get("outDir"):
        P = {**K.DEFAULTS, **(req.get("params") or {})}
        files["show"] = K.export(show_solid, os.path.join(req["outDir"], "show"), P, ["step", "stl"])
        if panes:
            files["panes"] = K.export(compound([p for _, _, p in panes]), os.path.join(req["outDir"], "panes"), P, ["stl"])
    return {
        "ok": True, "command": "show",
        "kernel": {"name": "OpenCascade (OCP)", "occt": K.occt_version(), "script": SHOW_VERSION, "bodyScript": K.KERNEL_VERSION},
        "apertures": rows,
        "volumes": {"bodyM3": r6(v_body), "showM3": r6(v_show), "panesM3": r6(v_panes), "groovesM3": r6(v_grooves),
                    "reassembledM3": r6(v_re), "conservationM3": float(f"{conservation:.3e}"), "integrationEps": VOL_EPS},
        "show": K.validity(show_solid),
        "reassembled": K.validity(re_solid),
        "clearances": cl,
        "points": points,
        "rays": rays,
        "rayFirstGlass": glass_hit,
        "metrics": {"volumeM3": r6(m["volumeM3"]), "surfaceAreaM2": r6(m["surfaceAreaM2"]), "frontalAreaM2": r6(m["frontalAreaM2"]),
                    "frontalSlices": m["frontalSlices"], "frontalMaxUnderestimateM2": r6(m["frontalMaxUnderestimateM2"])},
        "files": files,
    }


def main():
    req = json.load(sys.stdin)
    sys.stdout.flush()
    real = os.dup(1)
    os.dup2(2, 1)  # the C++ writers print to fd 1; stdout carries only the JSON result
    try:
        out = show(req) if req.get("command") == "show" else {"ok": False, "error": f"unknown command {req.get('command')}"}
    except Exception as ex:  # report, never a partial result
        out = {"ok": False, "error": f"{type(ex).__name__}: {ex}"}
    os.write(real, json.dumps(out, sort_keys=True).encode())


if __name__ == "__main__":
    main()
