# server/lib/conkay/cad/tub_fit_occ.py
#
# Does each structural part fit inside the CAD body? For every oriented box
# (a tub part's outer envelope), against the body solid read from its STEP:
#   inside     every corner classified IN the solid (BRepClass3d_SolidClassifier);
#   distance   BRepExtrema distance from the box solid to the body's outer shell
#              (0 when the box crosses the surface, wheel wells included);
#   clearance  distance - skin thickness: the gap to the inner face of the skin
#              (the skin is modelled as a uniform thickness inward of the outer surface).
# A box with all corners inside and a positive distance lies entirely inside
# (a box is connected: it cannot leave the solid without crossing the shell).
#
# Request (stdin, JSON): { "step": path, "skinThickness": m, "boxes": [{ id, center, half, axes }] }
# Result (stdout, JSON): { ok, kernel, rows: [{ id, inside, cornersOutside, distanceM, clearanceM, fits }] }
# Standard library + OCP (7.7 and 7.8+).

import sys, json

from OCP.STEPControl import STEPControl_Reader
from OCP.gp import gp_Pnt, gp_Trsf
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_SHELL, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

SCRIPT_VERSION = "1.0.0"


def _st(cls, name):
    return getattr(cls, name + "_s", None) or getattr(cls, name)


def explore(shape, kind):
    ex = TopExp_Explorer(shape, kind)
    while ex.More():
        yield ex.Current()
        ex.Next()


def load_step(path):
    rd = STEPControl_Reader()
    if rd.ReadFile(path) != 1:
        raise RuntimeError(f"cannot read STEP {path}")
    rd.TransferRoots()
    return rd.OneShape()


def box_corners(b):
    c, h, a = b["center"], b["half"], b["axes"]
    return [[c[i] + sx * h[0] * a[0][i] + sy * h[1] * a[1][i] + sz * h[2] * a[2][i] for i in range(3)]
            for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]


def obb_shape(b):
    h = [max(v, 5e-5) for v in b["half"]]
    shp = BRepPrimAPI_MakeBox(gp_Pnt(-h[0], -h[1], -h[2]), 2 * h[0], 2 * h[1], 2 * h[2]).Shape()
    a, c = b["axes"], b["center"]
    t = gp_Trsf()
    t.SetValues(a[0][0], a[1][0], a[2][0], c[0], a[0][1], a[1][1], a[2][1], c[1], a[0][2], a[1][2], a[2][2], c[2])
    return BRepBuilderAPI_Transform(shp, t, True).Shape()


def main():
    req = json.loads(sys.stdin.read())
    shape = load_step(req["step"])
    solid = next((_st(TopoDS, "Solid")(s) for s in explore(shape, TopAbs_SOLID)), None)
    if solid is None:
        print(json.dumps({"ok": False, "error": "no solid in the STEP"}))
        return
    shell = next(explore(solid, TopAbs_SHELL), None)
    skin = float(req["skinThickness"])
    rows = []
    for b in req["boxes"]:
        outside = [p for p in box_corners(b) if BRepClass3d_SolidClassifier(solid, gp_Pnt(*p), 1e-7).State() != TopAbs_IN]
        d = BRepExtrema_DistShapeShape(obb_shape(b), shell)
        d.Perform()
        dist = d.Value() if d.IsDone() else None
        inside = not outside and dist is not None and dist > 0
        clear = (dist - skin) if inside else None
        rows.append({"id": b["id"], "inside": inside, "cornersOutside": len(outside), "distanceM": round(dist, 6) if dist is not None else None,
                     "clearanceM": round(clear, 6) if clear is not None else None, "fits": bool(inside and clear >= 0)})
    try:
        from OCP.Standard import Standard_Version
        occt = _st(Standard_Version, "String")()
    except Exception:
        occt = None
    print(json.dumps({"ok": True, "kernel": {"name": "OpenCascade (OCP)", "occt": occt, "script": SCRIPT_VERSION}, "rows": rows}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - reported to the caller as a failed kernel run
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
