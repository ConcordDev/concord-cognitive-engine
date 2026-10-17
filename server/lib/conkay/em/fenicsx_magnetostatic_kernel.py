# server/lib/conkay/em/fenicsx_magnetostatic_kernel.py
#
# Low-frequency (magnetostatic) electromagnetics kernel on FEniCSx (dolfinx)
# + gmsh: one JSON request on stdin, one JSON result on stdout (the cad/*.py
# protocol; run through cad/kernel-queue.js runPythonKernel, so it is a child
# process and never blocks the event loop).
#
# op "planar2d": 2-D planar magnetic vector potential A_z(x, y), SI units,
#
#     -div( (1/mu) grad A_z ) = J_z      in the domain,
#     A_z = 0 on "dirichlet" sides (flux line), (1/mu) dA/dn = 0 on "neumann"
#     sides (field normal to the side),
#     B = curl(A_z e_z) = (dA/dy, -dA/dx).
#
#   request = {
#     op: "planar2d",
#     domain: { type: "rect", x0, y0, x1, y1 } | { type: "disk", cx, cy, r },
#     boundary: { left, right, bottom, top: "dirichlet" | "neumann" }  (rect; a disk is dirichlet),
#     regions: [  # later regions override earlier ones where they overlap
#       { shape: "rect", x0, y0, x1, y1 } | { shape: "disk", cx, cy, r }
#       | { shape: "annulus", cx, cy, r0, r1, gapAngle? (rad, wedge centred on +x) },
#       muR?: 1, J?: A/m^2 | I?: A (J = I / meshed area), h?: m (mesh size) }
#     ],
#     backgroundMuR?: 1, h: m (global mesh size), order?: 2,
#     probes: [{ name?, x, y }]
#   }
#   -> { ok, probes: [{ name, x, y, A, Bx, By, B, region }], energy (J/m),
#        regions: [{ area, current, J, cells }], cells, dofs, dolfinxVersion, gmshVersion, elapsedS }
#
# Linear, isotropic, non-saturating materials only. Errors come back as
# { "ok": false, "error": "..." }.

import json
import math
import os
import sys
import time

try:
    os.nice(15)  # never compete with the server for the CPU
except Exception:  # noqa: BLE001
    pass
os.environ.setdefault("OMP_NUM_THREADS", "1")
# MPICH's default libfabric "sockets" provider spins forever in MPI_Finalize
# on macOS (seen on the install test); tcp works for these serial runs.
os.environ.setdefault("FI_PROVIDER", "tcp")

# gmsh / PETSc may write to fd 1: keep a private copy of stdout for the one
# JSON line and point fd 1 at stderr.
sys.stdout.flush()
_JSON_OUT = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)

MU0 = 4e-7 * math.pi

try:
    import numpy as np
    import gmsh
    from mpi4py import MPI
    import dolfinx
    import ufl
    from dolfinx import fem, geometry
    from dolfinx.fem.petsc import LinearProblem
    try:
        from dolfinx.io import gmsh as gmshio
    except ImportError:  # dolfinx < 0.10
        from dolfinx.io import gmshio
except Exception as _e:  # noqa: BLE001 - reported as JSON
    _IMPORT_ERROR = f"fenicsx/gmsh import failed: {type(_e).__name__}: {_e}"
else:
    _IMPORT_ERROR = None


def fail(msg):
    return {"ok": False, "error": msg}


def _shape(occ, reg):
    s = reg.get("shape")
    if s == "rect":
        x0, y0, x1, y1 = (float(reg[k]) for k in ("x0", "y0", "x1", "y1"))
        if not (x1 > x0 and y1 > y0):
            raise ValueError("rect region needs x1 > x0 and y1 > y0")
        return [(2, occ.addRectangle(x0, y0, 0, x1 - x0, y1 - y0))]
    if s == "disk":
        r = float(reg["r"])
        if not r > 0:
            raise ValueError("disk region needs r > 0")
        return [(2, occ.addDisk(float(reg.get("cx", 0)), float(reg.get("cy", 0)), 0, r, r))]
    if s == "annulus":
        cx, cy, r0, r1 = float(reg.get("cx", 0)), float(reg.get("cy", 0)), float(reg["r0"]), float(reg["r1"])
        if not (r1 > r0 > 0):
            raise ValueError("annulus region needs r1 > r0 > 0")
        outer = occ.addDisk(cx, cy, 0, r1, r1)
        inner = occ.addDisk(cx, cy, 0, r0, r0)
        ring, _ = occ.cut([(2, outer)], [(2, inner)])
        g = float(reg.get("gapAngle") or 0)
        if g > 0:
            if not g < math.pi:
                raise ValueError("annulus gapAngle must be < pi")
            R = 2 * r1
            p = [occ.addPoint(cx, cy, 0)] + [occ.addPoint(cx + R * math.cos(a), cy + R * math.sin(a), 0) for a in (-g / 2, g / 2)]
            lines = [occ.addLine(p[0], p[1]), occ.addLine(p[1], p[2]), occ.addLine(p[2], p[0])]
            wedge = occ.addPlaneSurface([occ.addCurveLoop(lines)])
            ring, _ = occ.cut(ring, [(2, wedge)])
        return ring
    raise ValueError(f"unknown region shape {s!r}")


def planar2d(q):
    regions = q.get("regions") or []
    h0 = float(q["h"])
    order = int(q.get("order", 2))
    if not (h0 > 0 and order in (1, 2, 3)):
        return fail("h must be > 0 and order 1, 2 or 3")
    d = q.get("domain") or {}
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("General.NumThreads", 1)
        gmsh.model.add("magnetostatic")
        occ = gmsh.model.occ
        if d.get("type") == "rect":
            x0, y0, x1, y1 = (float(d[k]) for k in ("x0", "y0", "x1", "y1"))
            dom = occ.addRectangle(x0, y0, 0, x1 - x0, y1 - y0)
        elif d.get("type") == "disk":
            dom = occ.addDisk(float(d.get("cx", 0)), float(d.get("cy", 0)), 0, float(d["r"]), float(d["r"]))
        else:
            return fail("domain.type must be 'rect' or 'disk'")
        tools, owner_of_tool = [], []
        for k, reg in enumerate(regions):
            for dt in _shape(occ, reg):
                tools.append(dt)
                owner_of_tool.append(k)
        if tools:
            _, omap = occ.fragment([(2, dom)], tools)
        else:
            omap = [[(2, dom)]]
        occ.synchronize()
        in_domain = {t for (_, t) in omap[0]}
        owner = {t: -1 for t in in_domain}  # -1 = background
        for i, m in enumerate(omap[1:]):
            for (_, t) in m:
                if t not in in_domain:
                    return fail(f"region {owner_of_tool[i]} extends outside the domain")
                owner[t] = max(owner[t], owner_of_tool[i])
        # mesh size per piece: the owning region's h (else the global h)
        fields = []
        for t, k in owner.items():
            hk = float(regions[k].get("h") or h0) if k >= 0 else h0
            f = gmsh.model.mesh.field.add("MathEval")
            gmsh.model.mesh.field.setString(f, "F", repr(hk))
            r = gmsh.model.mesh.field.add("Restrict")
            gmsh.model.mesh.field.setNumber(r, "InField", f)
            gmsh.model.mesh.field.setNumbers(r, "SurfacesList", [t])
            fields.append(r)
        fmin = gmsh.model.mesh.field.add("Min")
        gmsh.model.mesh.field.setNumbers(fmin, "FieldsList", fields)
        gmsh.model.mesh.field.setAsBackgroundMesh(fmin)
        for opt in ("Mesh.MeshSizeExtendFromBoundary", "Mesh.MeshSizeFromPoints", "Mesh.MeshSizeFromCurvature"):
            gmsh.option.setNumber(opt, 0)
        groups = {}
        for t, k in owner.items():
            groups.setdefault(k, []).append(t)
        for k, ts in groups.items():
            gmsh.model.addPhysicalGroup(2, ts, k + 2)  # background 1, region k -> k + 2
        gmsh.model.mesh.generate(2)
        md = gmshio.model_to_mesh(gmsh.model, MPI.COMM_WORLD, 0, gdim=2)
        gmsh_version = gmsh.__version__
    finally:
        gmsh.finalize()
    if isinstance(md, tuple):
        msh, ct = md[0], md[1]
    else:
        msh, ct = md.mesh, md.cell_tags

    dx = ufl.Measure("dx", domain=msh, subdomain_data=ct)
    Q = fem.functionspace(msh, ("DG", 0))
    nu = fem.Function(Q)
    Jf = fem.Function(Q)
    nu.x.array[:] = 1.0 / (MU0 * float(q.get("backgroundMuR", 1.0)))
    reg_out = []
    for k, reg in enumerate(regions):
        cells = ct.find(k + 2)
        area = fem.assemble_scalar(fem.form(fem.Constant(msh, 1.0) * dx(k + 2)))
        mu_r = float(reg.get("muR", 1.0))
        if not mu_r > 0:
            return fail(f"region {k}: muR must be > 0")
        if reg.get("I") is not None:
            J = float(reg["I"]) / area if area > 0 else 0.0
        else:
            J = float(reg.get("J", 0.0))
        dofs = Q.dofmap.list[cells].ravel()
        nu.x.array[dofs] = 1.0 / (MU0 * mu_r)
        Jf.x.array[dofs] = J
        reg_out.append({"area": area, "J": J, "current": J * area, "cells": int(len(cells))})

    V = fem.functionspace(msh, ("Lagrange", order))
    fdim = 1
    msh.topology.create_connectivity(fdim, 2)
    if d["type"] == "rect":
        bnd = q.get("boundary") or {}
        tol = 1e-8 * max(x1 - x0, y1 - y0)
        sides = {"left": lambda X: np.abs(X[0] - x0) < tol, "right": lambda X: np.abs(X[0] - x1) < tol,
                 "bottom": lambda X: np.abs(X[1] - y0) < tol, "top": lambda X: np.abs(X[1] - y1) < tol}
        dir_facets = []
        for name, marker in sides.items():
            kind = bnd.get(name, "dirichlet")
            if kind not in ("dirichlet", "neumann"):
                return fail(f"boundary.{name} must be 'dirichlet' or 'neumann'")
            if kind == "dirichlet":
                dir_facets.append(dolfinx.mesh.locate_entities_boundary(msh, fdim, marker))
        if not dir_facets:
            return fail("at least one side must be dirichlet (A = 0), else A is undetermined")
        facets = np.unique(np.concatenate(dir_facets))
    else:
        facets = dolfinx.mesh.exterior_facet_indices(msh.topology)
    bc = fem.dirichletbc(0.0, fem.locate_dofs_topological(V, fdim, facets), V)
    u, v = ufl.TrialFunction(V), ufl.TestFunction(V)
    a = nu * ufl.inner(ufl.grad(u), ufl.grad(v)) * ufl.dx
    L = Jf * v * ufl.dx
    prob = LinearProblem(a, L, bcs=[bc], petsc_options_prefix="conkay_mag_",
                         petsc_options={"ksp_type": "preonly", "pc_type": "lu"})
    Ah = prob.solve()
    if isinstance(Ah, tuple):
        Ah = Ah[0]
    energy = 0.5 * fem.assemble_scalar(fem.form(nu * ufl.inner(ufl.grad(Ah), ufl.grad(Ah)) * ufl.dx))

    W = fem.functionspace(msh, ("DG", order - 1, (2,)))
    Bh = fem.Function(W)
    ip = W.element.interpolation_points
    ip = ip() if callable(ip) else ip
    Bh.interpolate(fem.Expression(ufl.as_vector((Ah.dx(1), -Ah.dx(0))), ip))

    probes = q.get("probes") or []
    out = []
    if probes:
        pts = np.array([[float(p["x"]), float(p["y"]), 0.0] for p in probes])
        tree = geometry.bb_tree(msh, 2)
        cand = geometry.compute_collisions_points(tree, pts)
        coll = geometry.compute_colliding_cells(msh, cand, pts)
        tag_of = np.ones(msh.topology.index_map(2).size_local, dtype=int)
        tag_of[ct.indices] = ct.values
        for i, p in enumerate(probes):
            cells = coll.links(i)
            if len(cells) == 0:
                return fail(f"probe {p.get('name', i)} at ({p['x']}, {p['y']}) is outside the mesh")
            c = np.array([cells[0]], dtype=np.int32)
            Bv = Bh.eval(pts[i], c)
            Av = Ah.eval(pts[i], c)
            out.append({"name": p.get("name", str(i)), "x": float(p["x"]), "y": float(p["y"]), "A": float(Av[0]),
                        "Bx": float(Bv[0]), "By": float(Bv[1]), "B": float(math.hypot(Bv[0], Bv[1])),
                        "region": int(tag_of[cells[0]]) - 2})
    return {"ok": True, "probes": out, "energy": float(energy), "regions": reg_out,
            "cells": int(msh.topology.index_map(2).size_local), "dofs": int(V.dofmap.index_map.size_local),
            "order": order, "dolfinxVersion": dolfinx.__version__, "gmshVersion": gmsh_version}


def _emit(r):
    sys.stdout.flush()
    _JSON_OUT.write(json.dumps(r) + "\n")
    _JSON_OUT.flush()


def main():
    t0 = time.time()
    try:
        q = json.loads(sys.stdin.read() or "{}")
    except Exception as e:  # noqa: BLE001
        _emit(fail(f"bad request JSON: {e}"))
        return
    if _IMPORT_ERROR:
        _emit(fail(_IMPORT_ERROR))
        return
    op = q.get("op")
    try:
        r = planar2d(q) if op == "planar2d" else fail(f"unknown op {op!r}")
    except Exception as e:  # noqa: BLE001
        r = fail(f"fenicsx run failed: {type(e).__name__}: {e}")
    if r.get("ok"):
        r["elapsedS"] = time.time() - t0
    _emit(r)


if __name__ == "__main__":
    main()
    sys.stderr.flush()
    # Skip MPI_Finalize (it can hang in libfabric on macOS); the JSON is already out.
    os._exit(0)
