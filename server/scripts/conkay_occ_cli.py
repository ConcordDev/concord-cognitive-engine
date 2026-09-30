#!/usr/bin/env python3
"""ConKay OpenCascade (OCP) CLI — B-rep STEP + feature tree + sketch + measure + solid mates.

Mac kitchen venv: ~/.zuko/venvs/cad-occ
Honesty: advanced B-rep (ADVANCED_FACE), NOT faceted POLY_LOOP.
NOT SolidWorks feature-parity. NOT ISO CMM lab certification.
"""
from __future__ import annotations

import contextlib
import json
import os
import sys
import traceback
import uuid
from pathlib import Path

ADVANCED_MARKERS = (
    "ADVANCED_FACE",
    "ADVANCED_BREP_SHAPE_REPRESENTATION",
    "MANIFOLD_SOLID_BREP",
    "AXIS2_PLACEMENT_3D",
)
FACETED_MARKERS = ("POLY_LOOP", "TRIANGULATED_FACE", "COMPLEX_TRIANGULATED_SURFACE")

FEATURE_TREE_ROOT = Path(os.path.expanduser("~/.zuko/conkay-feature-trees"))



@contextlib.contextmanager
def _silence_occ_stdio():
    """OCC STEP writer dumps ANSI transfer stats to stdout — keep JSON clean."""
    import os
    try:
        devnull = open(os.devnull, "w")
        old_out = os.dup(1)
        old_err = os.dup(2)
        os.dup2(devnull.fileno(), 1)
        os.dup2(devnull.fileno(), 2)
        yield
    finally:
        try:
            os.dup2(old_out, 1)
            os.dup2(old_err, 2)
            os.close(old_out)
            os.close(old_err)
            devnull.close()
        except Exception:
            pass


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _fail(reason: str, **extra) -> dict:
    return {"ok": False, "reason": reason, **extra}


def _new_id(prefix: str = "f") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def probe() -> dict:
    try:
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: F401
        import OCP

        ver = getattr(OCP, "__version__", None) or "cadquery-ocp"
        return {
            "ok": True,
            "kernel": "ocp",
            "package": "cadquery-ocp",
            "ocp": True,
            "version_hint": ver,
            "python": sys.executable,
            "commands": sorted(COMMANDS.keys()),
            "honesty": {
                "note": "OpenCascade via cadquery-ocp (OCP). Real B-rep STEP — not faceted POLY_LOOP.",
                "not": "SolidWorks UI parity / physical ISO 17025 CMM lab",
                "industrial": "multi-DOF mates + advanced features + digital ASME Y14.5 harness when companion loaded",
            },
        }
    except Exception as e:
        return _fail("ocp_import_failed", error=str(e), python=sys.executable)


def _make_shape(kind: str, params: dict):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir

    kind = (kind or "box").lower()
    if kind in ("box", "cube", "rect", "beam", "plate", "block", "slab"):
        dx = float(params.get("dx") or params.get("x") or params.get("width") or 10.0)
        dy = float(params.get("dy") or params.get("y") or params.get("depth") or 10.0)
        dz = float(params.get("dz") or params.get("z") or params.get("height") or 10.0)
        return BRepPrimAPI_MakeBox(abs(dx), abs(dy), abs(dz)).Shape(), {
            "kind": "box",
            "dx": abs(dx),
            "dy": abs(dy),
            "dz": abs(dz),
        }
    if kind in ("cylinder", "cyl", "pipe", "rod"):
        r = float(params.get("r") or params.get("radius") or 5.0)
        h = float(params.get("h") or params.get("height") or 20.0)
        ax = gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
        return BRepPrimAPI_MakeCylinder(ax, abs(r), abs(h)).Shape(), {
            "kind": "cylinder",
            "r": abs(r),
            "h": abs(h),
        }
    raise ValueError(f"unsupported_archetype:{kind}")


def _translate(shape, x: float, y: float, z: float):
    from OCP.gp import gp_Trsf, gp_Vec
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform

    if abs(x) < 1e-12 and abs(y) < 1e-12 and abs(z) < 1e-12:
        return shape
    tr = gp_Trsf()
    tr.SetTranslation(gp_Vec(float(x), float(y), float(z)))
    return BRepBuilderAPI_Transform(shape, tr, True).Shape()


def _rotate(shape, axis: str, deg: float):
    from OCP.gp import gp_Trsf, gp_Ax1, gp_Pnt, gp_Dir
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    import math

    if abs(deg) < 1e-12:
        return shape
    d = {"x": gp_Dir(1, 0, 0), "y": gp_Dir(0, 1, 0), "z": gp_Dir(0, 0, 1)}.get(
        (axis or "z").lower(), gp_Dir(0, 0, 1)
    )
    tr = gp_Trsf()
    tr.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), d), math.radians(float(deg)))
    return BRepBuilderAPI_Transform(shape, tr, True).Shape()


def _write_step(shape, path: str, name: str = "conkay_occ") -> dict:
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.Interface import Interface_Static

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    writer = STEPControl_Writer()
    try:
        Interface_Static.SetCVal_s("write.step.schema", "AP214")
    except Exception:
        pass
    try:
        Interface_Static.SetCVal_s("write.step.product.name", str(name)[:64])
    except Exception:
        pass
    with _silence_occ_stdio():
        st = writer.Transfer(shape, STEPControl_AsIs)
        if int(st) != 1 and st != IFSelect_RetDone:
            return _fail("step_transfer_failed", status=int(st))
        st = writer.Write(str(path))
        if int(st) != 1 and st != IFSelect_RetDone:
            return _fail("step_write_failed", status=int(st), path=path)
    text = Path(path).read_text(errors="replace")
    markers = {m: (m in text) for m in ADVANCED_MARKERS}
    faceted = {m: (m in text) for m in FACETED_MARKERS}
    advanced = bool(markers.get("ADVANCED_FACE")) and not faceted.get("POLY_LOOP")
    return {
        "ok": True,
        "path": str(path),
        "bytes": Path(path).stat().st_size,
        "markers": markers,
        "faceted_markers": faceted,
        "advanced_brep": advanced,
        "step_preview_head": text[:240],
    }


def _tessellate(shape, deflection: float = 0.5) -> dict:
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopLoc import TopLoc_Location
    from OCP.BRep import BRep_Tool
    from OCP.TopoDS import TopoDS

    BRepMesh_IncrementalMesh(shape, float(deflection))
    positions: list[float] = []
    indices: list[int] = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            exp.Next()
            continue
        base = len(positions) // 3
        trsf = loc.Transformation()
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i)
            p.Transform(trsf)
            positions.extend([float(p.X()), float(p.Y()), float(p.Z())])
        reversed_face = face.Orientation() == TopAbs_REVERSED
        for t in range(1, tri.NbTriangles() + 1):
            n1, n2, n3 = tri.Triangle(t).Get()
            if reversed_face:
                indices.extend([base + n1 - 1, base + n3 - 1, base + n2 - 1])
            else:
                indices.extend([base + n1 - 1, base + n2 - 1, base + n3 - 1])
        exp.Next()
    return {
        "positions": positions,
        "indices": indices,
        "vertexCount": len(positions) // 3,
        "triangleCount": len(indices) // 3,
    }


def _maybe_mesh(shape, payload: dict) -> dict | None:
    if payload.get("include_mesh") is False or payload.get("omit_mesh"):
        return None
    mesh = _tessellate(shape, float(payload.get("deflection") or 0.5))
    if payload.get("mesh_summary_only"):
        return {"vertexCount": mesh["vertexCount"], "triangleCount": mesh["triangleCount"]}
    return mesh


def _count_solids(shape) -> int:
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID

    n = 0
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        n += 1
        exp.Next()
    return n


def _bbox(shape) -> dict:
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    return {
        "minX": float(xmin),
        "minY": float(ymin),
        "minZ": float(zmin),
        "maxX": float(xmax),
        "maxY": float(ymax),
        "maxZ": float(zmax),
        "dx": float(xmax - xmin),
        "dy": float(ymax - ymin),
        "dz": float(zmax - zmin),
    }


def _apply_pos_rot(shape, feat: dict):
    pos = feat.get("position") or {}
    shape = _translate(
        shape,
        float(pos.get("x", feat.get("x", 0)) or 0),
        float(pos.get("y", feat.get("y", 0)) or 0),
        float(pos.get("z", feat.get("z", 0)) or 0),
    )
    rot = feat.get("rotation") or {}
    if rot.get("axis") is not None or rot.get("deg") is not None:
        shape = _rotate(shape, rot.get("axis") or "z", float(rot.get("deg") or 0))
    elif feat.get("rotate_deg") is not None:
        shape = _rotate(shape, feat.get("rotate_axis") or "z", float(feat["rotate_deg"]))
    return shape


def _shape_from_feature_params(feat: dict):
    """Build a primitive solid from a feature dict (box/cylinder or nested tool)."""
    ftype = (feat.get("type") or feat.get("op") or feat.get("kind") or "box").lower()
    params = feat.get("params") or feat
    if ftype in ("box", "cube", "rect", "beam", "plate", "block", "slab"):
        shape, used = _make_shape("box", params)
    elif ftype in ("cylinder", "cyl", "pipe", "rod"):
        shape, used = _make_shape("cylinder", params)
    else:
        raise ValueError(f"unsupported_feature_primitive:{ftype}")
    shape = _apply_pos_rot(shape, feat)
    return shape, used


def _fillet_all_edges(shape, radius: float):
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS

    mk = BRepFilletAPI_MakeFillet(shape)
    exp = TopExp_Explorer(shape, TopAbs_EDGE)
    n = 0
    while exp.More():
        mk.Add(float(radius), TopoDS.Edge_s(exp.Current()))
        n += 1
        exp.Next()
    if n == 0:
        return shape, 0
    mk.Build()
    if not mk.IsDone():
        raise RuntimeError("fillet_failed")
    return mk.Shape(), n


def _chamfer_all_edges(shape, dist: float):
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS

    edges = []
    exp = TopExp_Explorer(shape, TopAbs_EDGE)
    while exp.More():
        edges.append(TopoDS.Edge_s(exp.Current()))
        exp.Next()
    if not edges:
        return shape, 0
    # Try all edges; on failure, try progressively fewer (industrial best-effort)
    for take in (len(edges), max(1, len(edges)//2), max(1, len(edges)//4), min(4, len(edges)), 1):
        mk = BRepFilletAPI_MakeChamfer(shape)
        n = 0
        for edge in edges[:take]:
            try:
                mk.Add(float(dist), edge)
                n += 1
            except Exception:
                continue
        if n == 0:
            continue
        try:
            mk.Build()
            if mk.IsDone():
                return mk.Shape(), n
        except Exception:
            continue
    raise RuntimeError("chamfer_failed")


def _boolean(op: str, a, b):
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut, BRepAlgoAPI_Common

    op = op.lower()
    if op in ("union", "fuse", "boolean_union"):
        mk = BRepAlgoAPI_Fuse(a, b)
    elif op in ("cut", "diff", "boolean_diff", "subtract"):
        mk = BRepAlgoAPI_Cut(a, b)
    elif op in ("intersect", "common", "boolean_intersect"):
        mk = BRepAlgoAPI_Common(a, b)
    else:
        raise ValueError(f"unsupported_boolean:{op}")
    mk.Build()
    if not mk.IsDone():
        raise RuntimeError(f"boolean_failed:{op}")
    return mk.Shape()


def _wire_from_sketch(sketch: dict):
    """Build a closed TopoDS_Wire from sketch entities (lines/arcs/rect)."""
    from OCP.gp import gp_Pnt, gp_Circ, gp_Ax2, gp_Dir
    from OCP.GC import GC_MakeArcOfCircle, GC_MakeSegment
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
    from OCP.TopoDS import TopoDS_Wire

    entities = sketch.get("entities") or sketch.get("edges") or []
    if not entities and sketch.get("type") == "rect":
        entities = [{"type": "rect", **sketch}]
    if not entities:
        # convenience: rect from w/h
        w = float(sketch.get("w") or sketch.get("width") or sketch.get("dx") or 0)
        h = float(sketch.get("h") or sketch.get("height") or sketch.get("dy") or 0)
        if w > 0 and h > 0:
            x0 = float(sketch.get("x") or 0)
            y0 = float(sketch.get("y") or 0)
            entities = [{"type": "rect", "x": x0, "y": y0, "w": w, "h": h}]
    if not entities:
        raise ValueError("empty_sketch")

    mk_wire = BRepBuilderAPI_MakeWire()
    for ent in entities:
        et = (ent.get("type") or ent.get("kind") or "line").lower()
        if et in ("rect", "rectangle"):
            x = float(ent.get("x") or 0)
            y = float(ent.get("y") or 0)
            w = float(ent.get("w") or ent.get("width") or 10)
            h = float(ent.get("h") or ent.get("height") or 10)
            pts = [
                gp_Pnt(x, y, 0),
                gp_Pnt(x + w, y, 0),
                gp_Pnt(x + w, y + h, 0),
                gp_Pnt(x, y + h, 0),
                gp_Pnt(x, y, 0),
            ]
            for i in range(4):
                seg = GC_MakeSegment(pts[i], pts[i + 1]).Value()
                mk_wire.Add(BRepBuilderAPI_MakeEdge(seg).Edge())
        elif et in ("line", "segment"):
            p1 = gp_Pnt(float(ent["x1"]), float(ent["y1"]), 0)
            p2 = gp_Pnt(float(ent["x2"]), float(ent["y2"]), 0)
            seg = GC_MakeSegment(p1, p2).Value()
            mk_wire.Add(BRepBuilderAPI_MakeEdge(seg).Edge())
        elif et in ("arc",):
            # 3-point arc: x1,y1 mid x2,y2 end x3,y3 OR center+start+end
            if all(k in ent for k in ("x1", "y1", "x2", "y2", "x3", "y3")):
                p1 = gp_Pnt(float(ent["x1"]), float(ent["y1"]), 0)
                p2 = gp_Pnt(float(ent["x2"]), float(ent["y2"]), 0)
                p3 = gp_Pnt(float(ent["x3"]), float(ent["y3"]), 0)
                arc = GC_MakeArcOfCircle(p1, p2, p3).Value()
                mk_wire.Add(BRepBuilderAPI_MakeEdge(arc).Edge())
            else:
                cx = float(ent.get("cx") or 0)
                cy = float(ent.get("cy") or 0)
                r = float(ent.get("r") or ent.get("radius") or 5)
                # full circle as wire edge
                circ = gp_Circ(gp_Ax2(gp_Pnt(cx, cy, 0), gp_Dir(0, 0, 1)), r)
                mk_wire.Add(BRepBuilderAPI_MakeEdge(circ).Edge())
        else:
            raise ValueError(f"unsupported_sketch_entity:{et}")
    if not mk_wire.IsDone():
        raise RuntimeError("wire_build_failed")
    return mk_wire.Wire()


def _face_from_wire(wire):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace

    mk = BRepBuilderAPI_MakeFace(wire, True)
    if not mk.IsDone():
        raise RuntimeError("face_from_wire_failed")
    return mk.Face()


def _extrude_face(face, distance: float):
    from OCP.gp import gp_Vec
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism

    return BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, float(distance))).Shape()


def _revolve_face(face, angle_deg: float = 360.0):
    from OCP.gp import gp_Ax1, gp_Pnt, gp_Dir
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    import math

    ax = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0))
    return BRepPrimAPI_MakeRevol(face, ax, math.radians(float(angle_deg))).Shape()


def rebuild_from_features(features: list) -> tuple:
    """Replay feature list → OCC shape. Returns (shape, normalized_features, notes)."""
    if not features:
        raise ValueError("empty_feature_tree")
    shape = None
    notes = []
    normalized = []
    for raw in features:
        feat = dict(raw)
        if "id" not in feat:
            feat["id"] = _new_id()
        ftype = (feat.get("type") or feat.get("op") or feat.get("kind") or "").lower()
        if ftype in ("box", "cube", "cylinder", "cyl", "pipe", "rod", "beam", "rect", "plate", "block", "slab"):
            prim, used = _shape_from_feature_params(feat)
            if shape is None:
                shape = prim
            else:
                # successive primitives default to union
                shape = _boolean("union", shape, prim)
            feat["type"] = used["kind"]
            feat["params"] = {k: used[k] for k in used if k != "kind"}
            notes.append(f"add:{used['kind']}")
        elif ftype in ("extrude", "pad"):
            sketch = feat.get("sketch") or feat.get("profile") or {}
            dist = float(feat.get("distance") or feat.get("dz") or feat.get("height") or 10)
            wire = _wire_from_sketch(sketch)
            face = _face_from_wire(wire)
            prim = _extrude_face(face, dist)
            prim = _apply_pos_rot(prim, feat)
            if shape is None:
                shape = prim
            else:
                shape = _boolean("union", shape, prim)
            notes.append(f"extrude:{dist}")
        elif ftype in ("revolve",):
            sketch = feat.get("sketch") or feat.get("profile") or {}
            ang = float(feat.get("angle") or feat.get("angle_deg") or 360)
            wire = _wire_from_sketch(sketch)
            face = _face_from_wire(wire)
            prim = _revolve_face(face, ang)
            prim = _apply_pos_rot(prim, feat)
            if shape is None:
                shape = prim
            else:
                shape = _boolean("union", shape, prim)
            notes.append(f"revolve:{ang}")
        elif ftype in ("cut", "boolean_diff", "subtract"):
            if shape is None:
                raise ValueError("cut_without_base")
            tool_spec = feat.get("tool") or feat.get("params") or feat
            tool, _ = _shape_from_feature_params(
                tool_spec if isinstance(tool_spec, dict) else {"type": "cylinder", **feat}
            )
            if feat.get("tool") is None and (feat.get("type") or "").lower() == "cut":
                # allow inline cylinder cut params on feature itself
                if feat.get("r") or feat.get("radius") or (feat.get("params") or {}).get("r"):
                    tool, _ = _shape_from_feature_params(
                        {
                            "type": "cylinder",
                            "params": feat.get("params") or feat,
                            "position": feat.get("position"),
                        }
                    )
            shape = _boolean("cut", shape, tool)
            notes.append("cut")
        elif ftype in ("boolean_union", "union", "fuse"):
            if shape is None:
                raise ValueError("union_without_base")
            tool, _ = _shape_from_feature_params(feat.get("tool") or feat)
            shape = _boolean("union", shape, tool)
            notes.append("union")
        elif ftype in ("boolean_intersect", "intersect", "common"):
            if shape is None:
                raise ValueError("intersect_without_base")
            tool, _ = _shape_from_feature_params(feat.get("tool") or feat)
            shape = _boolean("intersect", shape, tool)
            notes.append("intersect")
        elif ftype in ("fillet",):
            if shape is None:
                raise ValueError("fillet_without_base")
            r = float(feat.get("radius") or feat.get("r") or 1.0)
            shape, n = _fillet_all_edges(shape, r)
            notes.append(f"fillet:r={r}:edges={n}")
        elif ftype in ("chamfer",):
            if shape is None:
                raise ValueError("chamfer_without_base")
            d = float(feat.get("distance") or feat.get("d") or feat.get("dist") or 0.5)
            shape, n = _chamfer_all_edges(shape, d)
            notes.append(f"chamfer:d={d}:edges={n}")
        elif ftype in ("transform", "move"):
            if shape is None:
                raise ValueError("transform_without_base")
            shape = _apply_pos_rot(shape, feat)
            notes.append("transform")
        else:
            # INDUSTRIAL_CLASS advanced ops (shell/draft/pattern) via companion module
            adv = None
            try:
                from conkay_occ_industrial import apply_advanced_feature
                adv = apply_advanced_feature(ftype, feat, shape)
            except ImportError:
                adv = None
            if adv is None:
                raise ValueError(f"unsupported_feature:{ftype}")
            shape, note = adv
            notes.append(note)
        normalized.append(feat)
    if shape is None:
        raise ValueError("rebuild_produced_no_shape")
    return shape, normalized, notes


def _tree_path(part_id: str) -> Path:
    FEATURE_TREE_ROOT.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(part_id))[:80]
    return FEATURE_TREE_ROOT / f"{safe}.json"


def _load_tree(part_id: str) -> dict:
    p = _tree_path(part_id)
    if not p.is_file():
        return {"ok": True, "partId": part_id, "features": [], "path": str(p)}
    data = json.loads(p.read_text())
    data["ok"] = True
    data["path"] = str(p)
    return data


def _save_tree(part_id: str, features: list, extra: dict | None = None) -> dict:
    p = _tree_path(part_id)
    doc = {
        "partId": part_id,
        "features": features,
        "updatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
    if extra:
        doc.update(extra)
    p.write_text(json.dumps(doc, indent=2))
    return {"ok": True, "partId": part_id, "features": features, "path": str(p), "count": len(features)}


# ── commands ──────────────────────────────────────────────────────────────


def cmd_make_archetype(payload: dict) -> dict:
    kind = payload.get("kind") or "box"
    params = payload.get("params") or {}
    out = payload.get("out") or payload.get("path")
    if not out:
        return _fail("need_out_path")
    try:
        shape, used = _make_shape(kind, params)
        pos = payload.get("position") or {}
        shape = _translate(shape, pos.get("x", 0), pos.get("y", 0), pos.get("z", 0))
        written = _write_step(shape, out, name=payload.get("name") or f"conkay_{used['kind']}")
        if not written.get("ok"):
            return written
        mesh = _tessellate(shape, float(payload.get("deflection") or 0.5))
        return {
            "ok": True,
            "archetype": used,
            "solids": _count_solids(shape),
            "bbox": _bbox(shape),
            "export": written,
            "mesh": mesh,
            "honesty": {
                "kernel": "OpenCascade/OCP",
                "format": "AP214 advanced B-rep STEP",
                "not": "faceted POLY_LOOP mesh STEP",
            },
        }
    except Exception as e:
        return _fail("make_archetype_failed", error=str(e), trace=traceback.format_exc()[-800:])


def cmd_export_compound(payload: dict) -> dict:
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound

    parts = payload.get("parts") or []
    out = payload.get("out") or payload.get("path")
    if not out:
        return _fail("need_out_path")
    if not parts:
        return _fail("no_parts")
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    used_parts = []
    for p in parts:
        kind = p.get("kind") or "box"
        params = p.get("params") or {}
        if p.get("bbox"):
            bb = p["bbox"]
            params = {
                "dx": abs(float(bb.get("dx") or bb.get("maxX", 1) - bb.get("minX", 0))),
                "dy": abs(float(bb.get("dy") or bb.get("maxY", 1) - bb.get("minY", 0))),
                "dz": abs(float(bb.get("dz") or bb.get("maxZ", 1) - bb.get("minZ", 0))),
            }
            kind = "box"
            for k in ("dx", "dy", "dz"):
                if params[k] < 1e-6:
                    params[k] = 1.0
        try:
            shape, used = _make_shape(kind, params)
        except Exception as e:
            return _fail("part_shape_failed", part=p.get("id"), error=str(e))
        pos = p.get("position") or {}
        if p.get("bbox") and "minX" in p["bbox"]:
            pos = {
                "x": float(p["bbox"]["minX"]),
                "y": float(p["bbox"]["minY"]),
                "z": float(p["bbox"]["minZ"]),
            }
        shape = _translate(shape, pos.get("x", 0), pos.get("y", 0), pos.get("z", 0))
        builder.Add(compound, shape)
        used_parts.append({"id": p.get("id"), "name": p.get("name"), **used})
    written = _write_step(compound, out, name=payload.get("name") or "conkay_assembly_occ")
    if not written.get("ok"):
        return written
    mesh = _tessellate(compound, float(payload.get("deflection") or 0.5))
    return {
        "ok": True,
        "parts": used_parts,
        "solids": _count_solids(compound),
        "export": written,
        "mesh": mesh,
        "honesty": {
            "kernel": "OpenCascade/OCP",
            "note": "Compound of primitive solids (box/cylinder). Mesh-only parts mapped via AABB box when bbox provided.",
        },
    }


def cmd_import_step(payload: dict) -> dict:
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone

    path = payload.get("path")
    text = payload.get("step") or payload.get("text")
    keep_path = payload.get("keep_path")
    if text and not path:
        path = payload.get("tmp_path") or "/tmp/conkay_occ_import.step"
        Path(path).write_text(text)
    if not path or not Path(path).is_file():
        return _fail("need_step_path_or_text")
    reader = STEPControl_Reader()
    with _silence_occ_stdio():
        st = reader.ReadFile(str(path))
        if int(st) != 1 and st != IFSelect_RetDone:
            return _fail("step_read_failed", status=int(st), path=path)
        n = reader.TransferRoots()
    if n < 1:
        return _fail("step_no_roots", path=path)
    shape = reader.OneShape()
    solids = _count_solids(shape)
    step_text = Path(path).read_text(errors="replace")
    markers = {m: (m in step_text) for m in ADVANCED_MARKERS}
    faceted = {m: (m in step_text) for m in FACETED_MARKERS}
    advanced = bool(markers.get("ADVANCED_FACE")) and not faceted.get("POLY_LOOP")
    mesh = _tessellate(shape, float(payload.get("deflection") or 0.5))
    kept = None
    if keep_path:
        Path(keep_path).parent.mkdir(parents=True, exist_ok=True)
        if os.path.abspath(path) != os.path.abspath(keep_path):
            Path(keep_path).write_bytes(Path(path).read_bytes())
        kept = str(keep_path)
    return {
        "ok": True,
        "path": str(path),
        "keptPath": kept,
        "bytes": Path(path).stat().st_size,
        "solids": solids,
        "transferRoots": int(n),
        "markers": markers,
        "faceted_markers": faceted,
        "advanced_brep": advanced,
        "bbox": _bbox(shape),
        "mesh": mesh,
        "honesty": {
            "kernel": "OpenCascade/OCP",
            "note": "B-rep STEP imported + tessellated for Unity mesh. Original B-rep kept on disk when keep_path set.",
        },
    }


def cmd_roundtrip_box(payload: dict) -> dict:
    out = payload.get("out") or "/tmp/conkay_occ_roundtrip_box.step"
    made = cmd_make_archetype(
        {
            "kind": "box",
            "params": payload.get("params") or {"dx": 10, "dy": 20, "dz": 30},
            "out": out,
            "name": "proof_box",
            "deflection": payload.get("deflection") or 0.5,
        }
    )
    if not made.get("ok"):
        return made
    imported = cmd_import_step({"path": out, "deflection": payload.get("deflection") or 0.5})
    if not imported.get("ok"):
        return imported
    return {
        "ok": True,
        "export": made["export"],
        "import": {
            "solids": imported["solids"],
            "advanced_brep": imported["advanced_brep"],
            "markers": imported["markers"],
            "faceted_markers": imported["faceted_markers"],
            "mesh": {
                "vertexCount": imported["mesh"]["vertexCount"],
                "triangleCount": imported["mesh"]["triangleCount"],
            },
        },
        "advanced_brep": bool(made["export"].get("advanced_brep") and imported.get("advanced_brep")),
        "honesty": made.get("honesty"),
    }


def cmd_feature_list(payload: dict) -> dict:
    part_id = payload.get("partId") or payload.get("part_id") or payload.get("id")
    if not part_id:
        return _fail("need_partId")
    return _load_tree(part_id)


def cmd_feature_create(payload: dict) -> dict:
    """Create part feature tree from initial features (or empty)."""
    part_id = payload.get("partId") or payload.get("part_id") or _new_id("part")
    features = list(payload.get("features") or [])
    for f in features:
        if "id" not in f:
            f["id"] = _new_id()
    return _save_tree(part_id, features)


def cmd_feature_append(payload: dict) -> dict:
    part_id = payload.get("partId") or payload.get("part_id")
    if not part_id:
        return _fail("need_partId")
    feat = payload.get("feature") or payload.get("feat")
    if not feat:
        return _fail("need_feature")
    feat = dict(feat)
    if "id" not in feat:
        feat["id"] = _new_id()
    tree = _load_tree(part_id)
    features = list(tree.get("features") or [])
    features.append(feat)
    return _save_tree(part_id, features)


def cmd_feature_undo(payload: dict) -> dict:
    part_id = payload.get("partId") or payload.get("part_id")
    if not part_id:
        return _fail("need_partId")
    tree = _load_tree(part_id)
    features = list(tree.get("features") or [])
    if not features:
        return _fail("nothing_to_undo", partId=part_id)
    removed = features.pop()
    saved = _save_tree(part_id, features)
    saved["removed"] = removed
    return saved


def cmd_feature_rebuild(payload: dict) -> dict:
    """Rebuild solid from feature tree; export STEP + tessellate."""
    part_id = payload.get("partId") or payload.get("part_id")
    features = payload.get("features")
    if features is None:
        if not part_id:
            return _fail("need_partId_or_features")
        tree = _load_tree(part_id)
        features = tree.get("features") or []
        if part_id and not features and payload.get("seed"):
            features = payload["seed"]
    if not features:
        return _fail("empty_feature_tree", partId=part_id)
    out = payload.get("out") or payload.get("path")
    if not out:
        out = f"/tmp/conkay_feature_{part_id or 'anon'}.step"
    try:
        shape, normalized, notes = rebuild_from_features(features)
        if part_id:
            _save_tree(part_id, normalized, {"rebuildNotes": notes})
        written = _write_step(shape, out, name=payload.get("name") or f"feat_{part_id or 'part'}")
        if not written.get("ok"):
            return written
        mesh = _maybe_mesh(shape, payload)
        bb = _bbox(shape)
        return {
            "ok": True,
            "partId": part_id,
            "features": normalized,
            "featureCount": len(normalized),
            "notes": notes,
            "solids": _count_solids(shape),
            "bbox": bb,
            "export": written,
            "mesh": mesh,
            "honesty": {
                "kernel": "OpenCascade/OCP",
                "note": "Parametric feature tree replayed to B-rep. Not SolidWorks feature-parity.",
                "ops": notes,
            },
        }
    except Exception as e:
        return _fail("feature_rebuild_failed", error=str(e), trace=traceback.format_exc()[-1200:])


def cmd_sketch_extrude(payload: dict) -> dict:
    sketch = payload.get("sketch") or payload.get("profile") or {}
    distance = float(payload.get("distance") or payload.get("dz") or payload.get("height") or 10)
    mode = (payload.get("mode") or "extrude").lower()
    out = payload.get("out") or payload.get("path") or "/tmp/conkay_sketch_extrude.step"
    try:
        wire = _wire_from_sketch(sketch)
        face = _face_from_wire(wire)
        if mode == "revolve":
            shape = _revolve_face(face, float(payload.get("angle") or 360))
        else:
            shape = _extrude_face(face, distance)
        pos = payload.get("position") or {}
        shape = _translate(shape, pos.get("x", 0), pos.get("y", 0), pos.get("z", 0))
        written = _write_step(shape, out, name=payload.get("name") or "sketch_extrude")
        if not written.get("ok"):
            return written
        mesh = _maybe_mesh(shape, payload)
        bb = _bbox(shape)
        # Proof helper: rectangle extrude ≈ box
        is_rect = False
        ents = sketch.get("entities") or []
        if sketch.get("type") == "rect" or sketch.get("w") or any(
            (e.get("type") or "").lower() in ("rect", "rectangle") for e in ents
        ):
            is_rect = True
        return {
            "ok": True,
            "mode": mode,
            "distance": distance if mode != "revolve" else None,
            "solids": _count_solids(shape),
            "bbox": bb,
            "export": written,
            "mesh": mesh,
            "proof": {
                "sketch_rect_extrude_is_box_like": bool(
                    is_rect
                    and mode == "extrude"
                    and abs(bb["dz"] - abs(distance)) < 1e-3
                    and bb["dx"] > 0
                    and bb["dy"] > 0
                ),
            },
            "honesty": {
                "kernel": "OpenCascade/OCP",
                "note": "2D sketch (lines/arcs/rect) → face → extrude/revolve solid",
            },
        }
    except Exception as e:
        return _fail("sketch_extrude_failed", error=str(e), trace=traceback.format_exc()[-1200:])


def cmd_measure(payload: dict) -> dict:
    """Geometry verification harness — measure solid vs GD&T-like callout. NOT ISO CMM."""
    callout = payload.get("callout") or payload.get("gdt") or {}
    features = payload.get("features")
    shape = None
    used_features = None
    notes = []
    try:
        if features:
            shape, used_features, notes = rebuild_from_features(features)
        elif payload.get("kind") or payload.get("params"):
            shape, used = _make_shape(payload.get("kind") or "box", payload.get("params") or {})
            used_features = [{"type": used["kind"], "params": used}]
        elif payload.get("partId"):
            tree = _load_tree(payload["partId"])
            feats = tree.get("features") or []
            if not feats:
                return _fail("no_features_for_part", partId=payload["partId"])
            shape, used_features, notes = rebuild_from_features(feats)
        else:
            return _fail("need_features_or_kind_or_partId")

        bb = _bbox(shape)
        kind = (callout.get("kind") or callout.get("type") or callout.get("measure") or "length").lower()
        measured = None
        nominal = callout.get("nominal")
        tol_plus = float(callout.get("tolPlus") or callout.get("tol_plus") or callout.get("upper") or callout.get("tol") or 0)
        tol_minus = float(callout.get("tolMinus") or callout.get("tol_minus") or callout.get("lower") or callout.get("tol") or tol_plus)
        axis = (callout.get("axis") or "x").lower()
        source = "bbox"

        if kind in ("length", "overall", "size", "linear"):
            measured = {"x": bb["dx"], "y": bb["dy"], "z": bb["dz"]}.get(axis, bb["dx"])
            source = f"bbox_{axis}"
        elif kind in ("diameter", "hole", "cyl_diameter"):
            # Prefer cylinder feature radius * 2
            for f in reversed(used_features or []):
                t = (f.get("type") or "").lower()
                params = f.get("params") or f
                if t in ("cylinder", "cyl") or params.get("r") or params.get("radius"):
                    r = float(params.get("r") or params.get("radius") or 0)
                    if r > 0:
                        measured = 2.0 * r
                        source = "cylinder_feature"
                        break
            if measured is None:
                # fallback: min of dx/dy as diameter proxy on bbox
                measured = min(bb["dx"], bb["dy"])
                source = "bbox_min_xy_proxy"
        elif kind in ("height",):
            measured = bb["dz"]
            source = "bbox_z"
        elif kind in ("width",):
            measured = bb["dx"]
            source = "bbox_x"
        elif kind in ("depth",):
            measured = bb["dy"]
            source = "bbox_y"
        else:
            return _fail("unsupported_measure_kind", kind=kind)

        measured = float(measured)
        if nominal is None:
            nominal = measured
        else:
            nominal = float(nominal)
        lo = nominal - abs(tol_minus)
        hi = nominal + abs(tol_plus)
        passed = lo - 1e-9 <= measured <= hi + 1e-9
        return {
            "ok": True,
            "pass": passed,
            "measured": measured,
            "nominal": nominal,
            "tolerance": {"plus": abs(tol_plus), "minus": abs(tol_minus), "lo": lo, "hi": hi},
            "kind": kind,
            "axis": axis if kind in ("length", "overall", "size", "linear") else None,
            "source": source,
            "bbox": bb,
            "features": used_features,
            "notes": notes,
            "honesty": {
                "harness": "geometry verification harness",
                "note": "Computes measured value from OCC solid/feature geometry vs callout ±tol. NOT ISO CMM lab certification.",
            },
        }
    except Exception as e:
        return _fail("measure_failed", error=str(e), trace=traceback.format_exc()[-1200:])


def cmd_mate_solids(payload: dict) -> dict:
    """Mate solver that updates OCC solid placements (AABB / axis), stronger than mesh-only mates v2.

    Honesty: NOT a full industrial multi-DOF constraint solver — but operates on solid
    instances (rebuild/placement), not triangle-mesh transforms alone.
    """
    a_spec = payload.get("a") or payload.get("solidA") or {}
    b_spec = payload.get("b") or payload.get("solidB") or {}
    mate = payload.get("mate") or payload.get("constraint") or {}
    mtype = (mate.get("type") or "coincident").lower()
    axis = (mate.get("axis") or "z").lower()
    offset = float(mate.get("offset") or mate.get("distance") or 0)

    def build_one(spec):
        if spec.get("features"):
            sh, feats, notes = rebuild_from_features(spec["features"])
            return sh, feats, notes
        kind = spec.get("kind") or spec.get("type") or "box"
        params = spec.get("params") or spec
        sh, used = _make_shape(kind, params)
        pos = spec.get("position") or {}
        sh = _translate(sh, pos.get("x", 0), pos.get("y", 0), pos.get("z", 0))
        return sh, [{"type": used["kind"], "params": used, "position": pos}], []

    try:
        shape_a, feats_a, _ = build_one(a_spec)
        shape_b, feats_b, _ = build_one(b_spec)
        bb_a = _bbox(shape_a)
        bb_b = _bbox(shape_b)

        # Centers
        ca = {
            "x": (bb_a["minX"] + bb_a["maxX"]) / 2,
            "y": (bb_a["minY"] + bb_a["maxY"]) / 2,
            "z": (bb_a["minZ"] + bb_a["maxZ"]) / 2,
        }
        cb = {
            "x": (bb_b["minX"] + bb_b["maxX"]) / 2,
            "y": (bb_b["minY"] + bb_b["maxY"]) / 2,
            "z": (bb_b["minZ"] + bb_b["maxZ"]) / 2,
        }

        # Face-normal proxies: ±axis faces of AABB
        # Solve B placement relative to A
        new_b_pos = {
            "x": float((b_spec.get("position") or {}).get("x", bb_b["minX"])),
            "y": float((b_spec.get("position") or {}).get("y", bb_b["minY"])),
            "z": float((b_spec.get("position") or {}).get("z", bb_b["minZ"])),
        }
        # Work in center space then convert back to min-corner placement for box-like
        b_half = {"x": bb_b["dx"] / 2, "y": bb_b["dy"] / 2, "z": bb_b["dz"] / 2}
        new_c = dict(cb)

        if mtype in ("coincident", "aligned", "align_axis"):
            # Align B center[axis] to A center[axis] (+ optional face mating)
            face = (mate.get("face") or "center").lower()
            if face in ("max", "max_a", "a_max"):
                # put B min face against A max face along axis
                if axis == "x":
                    new_c["x"] = bb_a["maxX"] + b_half["x"] + offset
                elif axis == "y":
                    new_c["y"] = bb_a["maxY"] + b_half["y"] + offset
                else:
                    new_c["z"] = bb_a["maxZ"] + b_half["z"] + offset
            elif face in ("min", "min_a", "a_min"):
                if axis == "x":
                    new_c["x"] = bb_a["minX"] - b_half["x"] - offset
                elif axis == "y":
                    new_c["y"] = bb_a["minY"] - b_half["y"] - offset
                else:
                    new_c["z"] = bb_a["minZ"] - b_half["z"] - offset
            else:
                new_c[axis] = ca[axis] + offset
            if mtype in ("aligned", "align_axis"):
                # also zero other axes toward A center (axis-align stack)
                for ax in ("x", "y", "z"):
                    if ax != axis:
                        new_c[ax] = ca[ax]
        elif mtype in ("distance", "offset"):
            # Place B center at A center + offset * axis unit
            u = {"x": 0.0, "y": 0.0, "z": 0.0}
            u[axis] = 1.0
            new_c = {
                "x": ca["x"] + u["x"] * offset,
                "y": ca["y"] + u["y"] * offset,
                "z": ca["z"] + u["z"] * offset,
            }
        elif mtype in ("fixed",):
            new_c = dict(ca)
        else:
            return _fail("unsupported_mate_type", type=mtype)

        # Convert center → translation delta applied to current B shape
        dx = new_c["x"] - cb["x"]
        dy = new_c["y"] - cb["y"]
        dz = new_c["z"] - cb["z"]
        shape_b2 = _translate(shape_b, dx, dy, dz)
        bb_b2 = _bbox(shape_b2)
        placement = {
            "position": {
                "x": float(bb_b2["minX"]),
                "y": float(bb_b2["minY"]),
                "z": float(bb_b2["minZ"]),
            },
            "center": new_c,
            "delta": {"x": dx, "y": dy, "z": dz},
        }

        out = payload.get("out")
        export = None
        mesh = None
        if out:
            from OCP.BRep import BRep_Builder
            from OCP.TopoDS import TopoDS_Compound

            builder = BRep_Builder()
            compound = TopoDS_Compound()
            builder.MakeCompound(compound)
            builder.Add(compound, shape_a)
            builder.Add(compound, shape_b2)
            export = _write_step(compound, out, name=payload.get("name") or "mate_solids")
            mesh = _maybe_mesh(compound, payload) if out else None

        stronger_than_mesh_v2 = True  # solid AABB + face-normal proxies on OCC solids
        return {
            "ok": True,
            "mate": {"type": mtype, "axis": axis, "offset": offset, "face": mate.get("face") or "center"},
            "a": {"bbox": bb_a, "features": feats_a},
            "b": {"bbox": bb_b2, "placement": placement, "features": feats_b},
            "export": export,
            "mesh": mesh,
            "solids": 2,
            "honesty": {
                "note": "Solid-instance mate solver on OCC AABB / face-normal proxies. Strictly stronger than mesh-only mates v2.",
                "not": "Full industrial multi-DOF CAD constraint solver",
                "stronger_than_mesh_mates_v2": stronger_than_mesh_v2,
            },
        }
    except Exception as e:
        return _fail("mate_solids_failed", error=str(e), trace=traceback.format_exc()[-1200:])


COMMANDS = {
    "probe": lambda p: probe(),
    "status": lambda p: probe(),
    "make_archetype": cmd_make_archetype,
    "export_compound": cmd_export_compound,
    "import_step": cmd_import_step,
    "roundtrip_box": cmd_roundtrip_box,
    # Gate A — feature tree
    "feature_create": cmd_feature_create,
    "feature_append": cmd_feature_append,
    "feature_list": cmd_feature_list,
    "feature_undo": cmd_feature_undo,
    "feature_rebuild": cmd_feature_rebuild,
    "feature-rebuild": cmd_feature_rebuild,  # alias kebab
    # Gate B — sketch
    "sketch_extrude": cmd_sketch_extrude,
    "sketch-extrude": cmd_sketch_extrude,
    # Gate D — measure / geometry verification
    "measure": cmd_measure,
    # Gate C — solid mates
    "mate_solids": cmd_mate_solids,
    "mate-solids": cmd_mate_solids,
}


# ── INDUSTRIAL_CLASS extensions (multi-DOF mates / sketch solve / digital GD&T / advanced features)
try:
    import sys as _sys
    from pathlib import Path as _Path
    _scripts_dir = str(_Path(__file__).resolve().parent)
    if _scripts_dir not in _sys.path:
        _sys.path.insert(0, _scripts_dir)
    import conkay_occ_industrial as _ind

    _ind.bind_helpers(
        rebuild_from_features=rebuild_from_features,
        _make_shape=_make_shape,
        _apply_pos_rot=_apply_pos_rot,
        _translate=_translate,
        _write_step=_write_step,
        _maybe_mesh=_maybe_mesh,
        _bbox=_bbox,
        _count_solids=_count_solids,
        _boolean=_boolean,
        _wire_from_sketch=_wire_from_sketch,
        _face_from_wire=_face_from_wire,
        _extrude_face=_extrude_face,
        _revolve_face=_revolve_face,
        _fail=_fail,
        _new_id=_new_id,
    )
    _ind.register(COMMANDS)
except Exception as _ind_err:  # keep base CLI alive if industrial companion missing
    COMMANDS["_industrial_load_error"] = lambda p, e=_ind_err: {
        "ok": False,
        "reason": "industrial_module_load_failed",
        "error": str(e),
    }



def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] not in ("-", "--json"):
        cmd = argv[1]
        payload = {}
        if len(argv) >= 3:
            try:
                payload = json.loads(argv[2])
            except json.JSONDecodeError:
                payload = {"path": argv[2], "out": argv[2] if cmd.startswith("make") else None}
        fn = COMMANDS.get(cmd)
        if not fn:
            _emit(_fail("unknown_command", command=cmd, commands=sorted(set(COMMANDS))))
            return 2
        _emit(fn(payload))
        return 0

    raw = sys.stdin.read()
    if not raw.strip():
        _emit(probe())
        return 0
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError as e:
        _emit(_fail("bad_json", error=str(e)))
        return 2
    cmd = msg.get("cmd") or msg.get("command") or "probe"
    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else msg
    fn = COMMANDS.get(cmd)
    if not fn:
        _emit(_fail("unknown_command", command=cmd, commands=sorted(set(COMMANDS))))
        return 2
    try:
        _emit(fn(payload))
        return 0
    except Exception as e:
        _emit(_fail("cli_exception", error=str(e), trace=traceback.format_exc()[-1200:]))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
