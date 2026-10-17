# server/lib/conkay/fea/calculix_kernel.py
#
# The 3-D linear-elastic stress kernel: one JSON request on stdin, one JSON
# result on stdout (the cad/*.py protocol; run through cad/kernel-queue.js
# runPythonKernel, so it is a child process and never blocks the event loop).
#
# Pipeline (op "static"):
#   1. STEP solid: request.step (a path) is imported with gmsh's OpenCascade
#      reader; or request.geometry (a parametric "box" / "plate_hole") is first
#      built with OCC and written to a STEP file, which is then re-imported —
#      the validation geometry goes through the same STEP path as a user's.
#   2. gmsh second-order (10-node) tetrahedral mesh, optional local refinement
#      near selected surfaces (Distance + Threshold fields).
#   3. CalculiX input deck (C3D10, *ELASTIC isotropic, *BOUNDARY on the nodes
#      of the selected support surfaces, *CLOAD from area-consistent nodal
#      loads of the selected load surfaces, *STATIC, *NODE FILE U, *EL FILE S).
#   4. ccx as a subprocess with a timeout (request.ccx, else $CONKAY_CCX).
#   5. The .frd (ASCII) is read back: nodal displacement and nodal
#      (extrapolated) stress; von Mises is computed from the six components.
#
# Surfaces are selected by axis-aligned bounding box (every boundary surface
# entirely inside the box). Units are whatever the STEP uses, consistently
# (mm, N, MPa in the validation cases).
#
# Errors come back as { "ok": false, "error": "..." } — never a traceback only.

import json
import math
import os
import subprocess
import sys
import tempfile
import time

try:
    import gmsh
except Exception as _e:  # noqa: BLE001 - reported as JSON
    gmsh = None
    _IMPORT_ERROR = f"gmsh import failed: {type(_e).__name__}: {_e}"
else:
    _IMPORT_ERROR = None

# gmsh 10-node tet edge order (01,12,20,30,32,31) -> CalculiX C3D10 (01,12,20,03,13,23)
GMSH_TO_CCX_TET10 = [0, 1, 2, 3, 4, 5, 6, 7, 9, 8]


def fail(msg):
    return {"ok": False, "error": msg}


def build_step(geometry, path):
    """Build a parametric validation solid with OCC and write it as STEP."""
    kind = geometry.get("kind")
    gmsh.model.add("build")
    occ = gmsh.model.occ
    if kind == "box":
        occ.addBox(0, 0, 0, float(geometry["L"]), float(geometry["b"]), float(geometry["h"]))
    elif kind == "plate_hole":
        # quarter plate: x in [0, L/2], y in [0, W/2], z in [0, t/2]; hole radius r at the origin
        box = occ.addBox(0, 0, 0, float(geometry["L"]) / 2, float(geometry["W"]) / 2, float(geometry["t"]) / 2)
        cyl = occ.addCylinder(0, 0, -1, 0, 0, float(geometry["t"]) / 2 + 2, float(geometry["d"]) / 2)
        occ.cut([(3, box)], [(3, cyl)])
    else:
        raise ValueError(f"unknown geometry kind {kind!r}: expected box or plate_hole")
    occ.synchronize()
    gmsh.write(path)
    gmsh.model.remove()


def surfaces_in(bbox, eps):
    x0, y0, z0, x1, y1, z1 = bbox
    ents = gmsh.model.getEntitiesInBoundingBox(x0 - eps, y0 - eps, z0 - eps, x1 + eps, y1 + eps, z1 + eps, 2)
    return [t for (_d, t) in ents]


def surface_nodes(tags):
    s = set()
    for t in tags:
        nt, _c, _p = gmsh.model.mesh.getNodes(2, t, includeBoundary=True)
        s.update(int(n) for n in nt)
    return s


def tri_area(p, a, b, c):
    ux, uy, uz = (p[b][i] - p[a][i] for i in range(3))
    vx, vy, vz = (p[c][i] - p[a][i] for i in range(3))
    return 0.5 * math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)


def consistent_loads(tags, coords, force):
    """Area-consistent nodal loads for a uniform traction on 6-node triangles:
    corner nodes 0, midside nodes A/3 each (exact for a quadratic triangle)."""
    loads = {}
    total_area = 0.0
    faces = []
    for t in tags:
        types, _tags, nodes = gmsh.model.mesh.getElements(2, t)
        for et, nn in zip(types, nodes):
            if et != 9:
                raise ValueError(f"surface element type {et} is not a 6-node triangle")
            for k in range(0, len(nn), 6):
                tri = [int(n) for n in nn[k:k + 6]]
                a = tri_area(coords, tri[0], tri[1], tri[2])
                total_area += a
                faces.append((tri, a))
    if total_area <= 0:
        raise ValueError("load surface has zero area")
    for tri, a in faces:
        w = a / total_area / 3.0
        for n in tri[3:]:
            f = loads.setdefault(n, [0.0, 0.0, 0.0])
            for i in range(3):
                f[i] += w * force[i]
    return loads, total_area


def von_mises(s):
    sxx, syy, szz, sxy, syz, szx = s
    return math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3 * (sxy ** 2 + syz ** 2 + szx ** 2))


def read_frd(path):
    """Nodal DISP (3) and STRESS (6) blocks from an ASCII .frd."""
    blocks = {}
    current = None
    with open(path) as fh:
        for line in fh:
            if line.startswith(" -4"):
                name = line[5:13].strip()
                current = blocks.setdefault(name, {}) if name in ("DISP", "STRESS") else None
            elif line.startswith(" -1") and current is not None:
                node = int(line[3:13])
                vals = [float(line[13 + 12 * i: 25 + 12 * i]) for i in range((len(line.rstrip("\n")) - 13) // 12)]
                current[node] = vals
            elif line.startswith(" -3"):
                current = None
    return blocks.get("DISP", {}), blocks.get("STRESS", {})


def in_box(p, bbox, eps):
    return all(bbox[i] - eps <= p[i] <= bbox[i + 3] + eps for i in range(3))


def static(req):
    mat = req.get("material") or {}
    E, nu = float(mat.get("E", 0)), float(mat.get("nu", -1))
    if not (E > 0) or not (-1 < nu < 0.5):
        return fail("material needs E > 0 and -1 < nu < 0.5")
    ccx = req.get("ccx") or os.environ.get("CONKAY_CCX")
    if not ccx or not os.path.exists(ccx):
        return fail(f"CalculiX ccx not found ({ccx!r}): set CONKAY_CCX")
    timeout_s = float(req.get("timeoutS", 600))
    mesh = req.get("mesh") or {}
    size = float(mesh.get("size", 0))
    if not (size > 0):
        return fail("mesh.size must be positive")
    eps = float(req.get("selectTolerance", 1e-6 * max(1.0, size)))
    work = tempfile.mkdtemp(prefix="conkay-ccx-")
    warnings = []
    t0 = time.time()
    gmsh.initialize(["-noenv"])
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("General.NumThreads", 1)
        step = req.get("step")
        if step:
            if not os.path.exists(step):
                return fail(f"STEP file not found: {step}")
        else:
            if not req.get("geometry"):
                return fail("request needs step (a STEP path) or geometry")
            step = os.path.join(work, "solid.step")
            build_step(req["geometry"], step)
        gmsh.model.add("solid")
        gmsh.model.occ.importShapes(step)
        gmsh.model.occ.synchronize()
        vols = gmsh.model.getEntities(3)
        if len(vols) != 1:
            return fail(f"STEP must contain exactly one solid, found {len(vols)}")
        bb = gmsh.model.getBoundingBox(3, vols[0][1])
        gmsh.option.setNumber("Mesh.MeshSizeMax", size)
        gmsh.option.setNumber("Mesh.MeshSizeMin", size * float(mesh.get("minFactor", 0.05)))
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
        ref = mesh.get("refine")
        if ref:
            stags = surfaces_in(ref["bbox"], eps)
            if not stags:
                return fail("mesh.refine.bbox selects no surface")
            f = gmsh.model.mesh.field
            d = f.add("Distance")
            f.setNumbers(d, "SurfacesList", stags)
            th = f.add("Threshold")
            f.setNumber(th, "InField", d)
            f.setNumber(th, "SizeMin", float(ref["sizeMin"]))
            f.setNumber(th, "SizeMax", size)
            f.setNumber(th, "DistMin", float(ref.get("distMin", 0)))
            f.setNumber(th, "DistMax", float(ref["distMax"]))
            f.setAsBackgroundMesh(th)
            gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
        gmsh.option.setNumber("Mesh.ElementOrder", 2)
        gmsh.option.setNumber("Mesh.SecondOrderLinear", 0)
        gmsh.model.mesh.generate(3)
        ntags, ncoord, _ = gmsh.model.mesh.getNodes()
        coords = {int(t): (ncoord[3 * i], ncoord[3 * i + 1], ncoord[3 * i + 2]) for i, t in enumerate(ntags)}
        etypes, etags, enodes = gmsh.model.mesh.getElements(3, vols[0][1])
        tets = []
        for et, tg, nn in zip(etypes, etags, enodes):
            if et != 11:
                return fail(f"volume element type {et} is not a 10-node tetrahedron")
            for k, e in enumerate(tg):
                g = nn[10 * k: 10 * k + 10]
                tets.append((int(e), [int(g[j]) for j in GMSH_TO_CCX_TET10]))
        if not tets:
            return fail("gmsh produced no tetrahedra")

        bc_lines = []
        for s in req.get("supports") or []:
            tags = surfaces_in(s["bbox"], eps)
            if not tags:
                return fail(f"support bbox {s['bbox']} selects no surface")
            for n in sorted(surface_nodes(tags)):
                for dof in s.get("dofs", [1, 2, 3]):
                    bc_lines.append(f"{n},{int(dof)},{int(dof)},0.")
        if not bc_lines:
            return fail("no supports: the model would be a mechanism")
        load_lines = []
        applied = [0.0, 0.0, 0.0]
        load_areas = []
        for ld in req.get("loads") or []:
            tags = surfaces_in(ld["bbox"], eps)
            if not tags:
                return fail(f"load bbox {ld['bbox']} selects no surface")
            force = [float(v) for v in ld["force"]]
            nl, area = consistent_loads(tags, coords, force)
            load_areas.append(area)
            for n, f in sorted(nl.items()):
                for i in range(3):
                    if f[i] != 0.0:
                        load_lines.append(f"{n},{i + 1},{f[i]:.12e}")
                        applied[i] += f[i]
        if not load_lines:
            return fail("no loads")

        inp = os.path.join(work, "job.inp")
        with open(inp, "w") as fh:
            fh.write("*NODE\n")
            for n in sorted(coords):
                x, y, z = coords[n]
                fh.write(f"{n},{x:.12e},{y:.12e},{z:.12e}\n")
            fh.write("*ELEMENT, TYPE=C3D10, ELSET=SOLID\n")
            for e, nn in tets:
                fh.write(f"{e}," + ",".join(str(n) for n in nn[:8]) + ",\n" + ",".join(str(n) for n in nn[8:]) + "\n")
            fh.write(f"*MATERIAL, NAME=MAT\n*ELASTIC\n{E:.12e},{nu:.12e}\n")
            fh.write("*SOLID SECTION, ELSET=SOLID, MATERIAL=MAT\n\n")
            fh.write("*STEP\n*STATIC\n*BOUNDARY\n" + "\n".join(bc_lines) + "\n")
            fh.write("*CLOAD\n" + "\n".join(load_lines) + "\n")
            fh.write("*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
        t_mesh = time.time() - t0
        try:
            proc = subprocess.run([ccx, "-i", "job"], cwd=work, capture_output=True, text=True, timeout=timeout_s,
                                  env={**os.environ, "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")})
        except subprocess.TimeoutExpired:
            return fail(f"ccx timed out after {timeout_s} s")
        log = (proc.stdout or "") + (proc.stderr or "")
        frd = os.path.join(work, "job.frd")
        if proc.returncode != 0 or "*ERROR" in log or not os.path.exists(frd):
            tail = [l for l in log.splitlines() if l.strip()][-5:]
            return fail(f"ccx failed (exit {proc.returncode}): {' | '.join(tail)}")
        disp, stress = read_frd(frd)
        if not disp or not stress:
            return fail("ccx .frd has no DISP/STRESS blocks")

        def probe_disp(p):
            ids = [n for n in coords if in_box(coords[n], p["bbox"], eps) and n in disp]
            if not ids:
                raise ValueError(f"displacement probe {p.get('name')} selects no node")
            avg = [sum(disp[n][i] for n in ids) / len(ids) for i in range(3)]
            return {"name": p.get("name"), "nodes": len(ids), "mean": avg,
                    "min": [min(disp[n][i] for n in ids) for i in range(3)],
                    "max": [max(disp[n][i] for n in ids) for i in range(3)]}

        def probe_stress(p):
            ids = [n for n in coords if in_box(coords[n], p["bbox"], eps) and n in stress]
            if not ids:
                raise ValueError(f"stress probe {p.get('name')} selects no node")
            vm = {n: von_mises(stress[n][:6]) for n in ids}
            nvm = max(ids, key=lambda n: vm[n])
            comp = {}
            for i, k in enumerate(["sxx", "syy", "szz", "sxy", "syz", "szx"]):
                nmax = max(ids, key=lambda n: stress[n][i])
                comp[k] = {"max": stress[nmax][i], "at": list(coords[nmax])}
            return {"name": p.get("name"), "nodes": len(ids), "vonMisesMax": vm[nvm], "vonMisesAt": list(coords[nvm]), "components": comp}

        all_vm = {n: von_mises(s[:6]) for n, s in stress.items()}
        nmax = max(all_vm, key=all_vm.get)
        umag = {n: math.sqrt(sum(v * v for v in d[:3])) for n, d in disp.items()}
        nu_max = max(umag, key=umag.get)
        return {
            "ok": True,
            "gmsh": gmsh.__version__,
            "ccx": ccx,
            "elementType": "C3D10",
            "elements": len(tets),
            "nodes": len(coords),
            "meshSize": size,
            "boundingBox": list(bb),
            "appliedForce": applied,
            "loadAreas": load_areas,
            "maxDisplacement": {"value": umag[nu_max], "at": list(coords[nu_max])},
            "maxVonMises": {"value": all_vm[nmax], "at": list(coords[nmax])},
            "displacementProbes": [probe_disp(p) for p in req.get("displacementProbes") or []],
            "stressProbes": [probe_stress(p) for p in req.get("stressProbes") or []],
            "timing": {"meshAndDeckS": round(t_mesh, 3), "totalS": round(time.time() - t0, 3)},
            "warnings": warnings,
        }
    finally:
        gmsh.finalize()
        if not req.get("keepWork"):
            import shutil
            shutil.rmtree(work, ignore_errors=True)


def main():
    # OpenCascade's STEP reader/writer and gmsh print to the C-level stdout: point
    # fd 1 at stderr while working and write the one JSON result to the real stdout.
    out_fd = os.dup(1)
    os.dup2(2, 1)
    out = os.fdopen(out_fd, "w")
    try:
        res = run(sys.stdin.read())
    finally:
        sys.stdout.flush()
    out.write(json.dumps(res))
    out.flush()


def run(text):
    try:
        req = json.loads(text or "{}")
    except Exception as e:  # noqa: BLE001
        return fail(f"bad JSON request: {e}")
    if _IMPORT_ERROR:
        return fail(_IMPORT_ERROR)
    try:
        op = req.get("op")
        if op != "static":
            res = fail(f"unknown op {op!r}: expected static")
        else:
            res = static(req)
    except Exception as e:  # noqa: BLE001
        res = fail(f"{type(e).__name__}: {e}")
    return res


if __name__ == "__main__":
    main()
