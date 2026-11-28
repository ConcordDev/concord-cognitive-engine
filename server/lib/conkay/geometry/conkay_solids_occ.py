#!/usr/bin/env python3
"""ConKay solids on OpenCascade (OCP).

Builds each part of a ConKay build as a B-rep solid from the same compiled
geometry ConKay's own math uses (SI metres), measures it with OpenCascade's
own mass properties, and optionally writes every solid into one STEP file.

stdin:  {"parts": [{"id", "name", "geometry": {...compiled...}, "axis": "x"|"y"|"z", "position": [x, y, z]}],
         "stepPath": "/path/out.step" | null}
stdout: {"ok": true, "parts": [{"id", "ok", "volume", "area", "error"?}], "step": "/path" | null}

Placement matches lib/conkay/geometry/shapes.js: a section (a, b) along axis u maps to
x: (u, a, b), y: (a, u, b), z: (a, b, u); revolve turns its (r, z) profile about z;
primitives follow lib/conkay/cad-glb.js (box/plate: length along x, width y, height z;
rods and tubes along props.axis, default y). Positions are part centres (a revolve's
position is its axis at z = 0).
"""
import json
import math
import sys

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeWire, BRepBuilderAPI_Transform
from OCP.BRepGProp import BRepGProp
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
from OCP.GProp import GProp_GProps
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopoDS import TopoDS_Compound
from OCP.BRep import BRep_Builder
from OCP.gp import gp_Ax1, gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec


def place(axis):
    if axis == "y":
        return lambda u, a, b: (a, u, b)
    if axis == "z":
        return lambda u, a, b: (a, b, u)
    return lambda u, a, b: (u, a, b)


def axis_dir(axis):
    return {"x": gp_Dir(1, 0, 0), "y": gp_Dir(0, 1, 0), "z": gp_Dir(0, 0, 1)}[axis]


def polygon_wire(points3d):
    poly = BRepBuilderAPI_MakePolygon()
    for p in points3d:
        poly.Add(gp_Pnt(*p))
    poly.Close()
    return poly.Wire()


def circle_wire(center, normal, radius):
    circ = gp_Circ(gp_Ax2(gp_Pnt(*center), normal), radius)
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circ).Edge()).Wire()


def signed_area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def extrude(g, axis):
    at = place(axis)
    L = g["length"]
    outer = g["profile"] if signed_area(g["profile"]) > 0 else list(reversed(g["profile"]))
    face = BRepBuilderAPI_MakeFace(polygon_wire([at(-L / 2, a, b) for a, b in outer]))
    for h in g.get("holes", []):
        hole = h if signed_area(h) < 0 else list(reversed(h))
        face.Add(polygon_wire([at(-L / 2, a, b) for a, b in hole]))
    for c in g.get("circles", []):
        w = circle_wire(at(-L / 2, c["at"][0], c["at"][1]), axis_dir(axis), c["d"] / 2)
        w.Reverse()  # an inner wire runs against the outer one
        face.Add(w)
    d = at(L, 0, 0)
    return BRepPrimAPI_MakePrism(face.Face(), gp_Vec(*d)).Shape()


def revolve(g):
    prof = g["profile"]
    wire = polygon_wire([(r, 0.0, z) for r, z in prof])
    face = BRepBuilderAPI_MakeFace(wire).Face()
    return BRepPrimAPI_MakeRevol(face, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), math.radians(g.get("angle", 360))).Shape()


def section_points(sec):
    # mirrors sectionPoints() in profiles.js; the points are passed in precomputed
    return sec["pts"]


def loft(g, axis):
    at = place(axis)
    ts = BRepOffsetAPI_ThruSections(True, True)  # solid, ruled
    for st in g["stations"]:
        ts.AddWire(polygon_wire([at(st["at"], a, b) for a, b in st["pts"]]))
    ts.Build()
    return ts.Shape()


def primitive(g, axis):
    s = g["shape"]
    if s in ("box", "plate"):
        L, W = g["length"], g["width"]
        H = g["height"] if s == "box" else g["thickness"]
        return BRepPrimAPI_MakeBox(gp_Pnt(-L / 2, -W / 2, -H / 2), L, W, H).Shape()
    if s in ("cylinder", "rod", "bolt", "round-tube"):
        d = g.get("diameter") or g.get("outerDiameter")
        L = g["length"]
        ax = axis or "y"
        start = {"x": (-L / 2, 0, 0), "y": (0, -L / 2, 0), "z": (0, 0, -L / 2)}[ax]
        outer = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*start), axis_dir(ax)), d / 2, L).Shape()
        if s == "round-tube":
            inner = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*start), axis_dir(ax)), d / 2 - g["wall"], L).Shape()
            return BRepAlgoAPI_Cut(outer, inner).Shape()
        return outer
    if s == "rect-tube":
        L, W, H, t = g["length"], g["width"], g["height"], g["wall"]
        outer = BRepPrimAPI_MakeBox(gp_Pnt(-L / 2, -W / 2, -H / 2), L, W, H).Shape()
        inner = BRepPrimAPI_MakeBox(gp_Pnt(-L / 2, -W / 2 + t, -H / 2 + t), L, W - 2 * t, H - 2 * t).Shape()
        return BRepAlgoAPI_Cut(outer, inner).Shape()
    return None


def build(part):
    g = part["geometry"]
    axis = part.get("axis") or ("x" if g["shape"] in ("extrude", "loft") else None)
    if g["shape"] == "extrude":
        shape = extrude(g, axis)
    elif g["shape"] == "revolve":
        shape = revolve(g)
    elif g["shape"] == "loft":
        shape = loft(g, axis)
    else:
        shape = primitive(g, axis)
    if shape is None:
        raise ValueError(f'no B-rep builder for shape "{g["shape"]}"')
    px, py, pz = part.get("position") or (0, 0, 0)
    if any((px, py, pz)):
        t = gp_Trsf()
        t.SetTranslation(gp_Vec(px, py, pz))
        shape = BRepBuilderAPI_Transform(shape, t, True).Shape()
    return shape


def measure(shape):
    vp, sp = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, vp)
    BRepGProp.SurfaceProperties_s(shape, sp)
    return abs(vp.Mass()), sp.Mass()


def main():
    req = json.load(sys.stdin)
    # OpenCascade's C++ side (the STEP writer) prints to fd 1; send that to stderr so stdout carries only the JSON reply
    import os
    sys.stdout.flush()
    saved = os.dup(1)
    os.dup2(2, 1)
    out, solids = [], []
    for part in req.get("parts", []):
        try:
            shape = build(part)
            v, a = measure(shape)
            out.append({"id": part["id"], "ok": True, "volume": v, "area": a})
            solids.append(shape)
        except Exception as e:  # one bad part never sinks the rest
            out.append({"id": part["id"], "ok": False, "error": str(e)})
    step = None
    if req.get("stepPath") and solids:
        comp = TopoDS_Compound()
        bb = BRep_Builder()
        bb.MakeCompound(comp)
        for s in solids:
            bb.Add(comp, s)
        w = STEPControl_Writer()
        w.Transfer(comp, STEPControl_AsIs)
        if w.Write(req["stepPath"]) == IFSelect_RetDone:
            step = req["stepPath"]
    sys.stdout.flush()
    os.dup2(saved, 1)
    os.close(saved)
    json.dump({"ok": True, "parts": out, "step": step}, sys.stdout)


if __name__ == "__main__":
    main()
