#!/usr/bin/env python3
"""FEniCSx / DOLFINx PDE workbench kernel — SXE-09.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on
stdin, one result JSON on stdout. Written against the pinned
release (DOLFINx 0.11) documented API.

Ops:
  health     — Poisson on the unit square against the
               manufactured solution u = 1 + x^2 + 2y^2;
               serves {l2Error, dofs}; the health bound is
               l2Error < 1e-3 (SOLVER-ENGINES-PLAN.md §2).
  poisson    — same case, request {nx} (cells per side,
               default 32, cap 128).
  elasticity — 2-D cantilever (L=1, H=0.1, degree-2 vector
               elements), uniform tip traction; serves
               {tipDeflection, beamTheory, relDeviation}
               against Euler-Bernoulli PL^3/(3EI).

A dolfinx stack that does not import is a provisioning
defect: the kernel exits 3 naming the import failure —
never a fabricated result.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


try:
    import numpy as np
    from mpi4py import MPI
    import ufl
    from dolfinx import fem, mesh
    from dolfinx.fem.petsc import LinearProblem
except Exception as exc:  # provisioning defect, named
    fail(3, "fenicsx stack import failed: %s" % (exc,))


def poisson(nx):
    domain = mesh.create_unit_square(MPI.COMM_WORLD, nx, nx,
                                     mesh.CellType.triangle)
    V = fem.functionspace(domain, ("Lagrange", 1))
    u_exact_fn = fem.Function(V)
    u_exact_fn.interpolate(lambda x: 1.0 + x[0] ** 2 + 2.0 * x[1] ** 2)
    tdim = domain.topology.dim
    fdim = tdim - 1
    domain.topology.create_connectivity(fdim, tdim)
    boundary_dofs = fem.locate_dofs_topological(
        V, fdim, mesh.exterior_facet_indices(domain.topology))
    bc = fem.dirichletbc(u_exact_fn, boundary_dofs)
    u, v = ufl.TrialFunction(V), ufl.TestFunction(V)
    f = fem.Constant(domain, -6.0)  # -laplacian(u_exact) = -6
    a = ufl.inner(ufl.grad(u), ufl.grad(v)) * ufl.dx
    L = ufl.inner(f, v) * ufl.dx
    uh = LinearProblem(a, L, bcs=[bc],
                       petsc_options={"ksp_type": "preonly",
                                      "pc_type": "lu"}).solve()
    V2 = fem.functionspace(domain, ("Lagrange", 2))
    uex = fem.Function(V2)
    uex.interpolate(lambda x: 1.0 + x[0] ** 2 + 2.0 * x[1] ** 2)
    err_form = fem.form(ufl.inner(uh - uex, uh - uex) * ufl.dx)
    l2 = float(np.sqrt(domain.comm.allreduce(
        fem.assemble_scalar(err_form), op=MPI.SUM)))
    return {"l2Error": l2, "dofs": int(V.dofmap.index_map.size_global),
            "converged": True}


def elasticity(traction):
    E, nu = 1000.0, 0.3
    L_len, H = 1.0, 0.1
    domain = mesh.create_rectangle(
        MPI.COMM_WORLD, [np.array([0.0, 0.0]), np.array([L_len, H])],
        [50, 5], mesh.CellType.triangle)
    V = fem.functionspace(domain, ("Lagrange", 2, (2,)))
    clamped = fem.locate_dofs_geometrical(V, lambda x: np.isclose(x[0], 0.0))
    bc = fem.dirichletbc(np.zeros(2), clamped, V)
    mu = E / (2.0 * (1.0 + nu))
    lam = E * nu / ((1.0 + nu) * (1.0 - 2.0 * nu))

    def sigma(u):
        return lam * ufl.nabla_div(u) * ufl.Identity(2) + 2.0 * mu * ufl.sym(ufl.grad(u))

    u, v = ufl.TrialFunction(V), ufl.TestFunction(V)
    a = ufl.inner(sigma(u), ufl.grad(v)) * ufl.dx
    # Tip traction on the x = L face, integrated via a marked measure.
    fdim = domain.topology.dim - 1
    domain.topology.create_connectivity(fdim, domain.topology.dim)
    facets = mesh.locate_entities_boundary(
        domain, fdim, lambda x: np.isclose(x[0], L_len))
    tags = mesh.meshtags(domain, fdim, facets,
                         np.full(len(facets), 1, dtype=np.int32))
    ds = ufl.Measure("ds", domain=domain, subdomain_data=tags)
    tvec = fem.Constant(domain, np.array([0.0, traction]))
    Lform = ufl.inner(tvec, v) * ds(1)
    uh = LinearProblem(a, Lform, bcs=[bc],
                       petsc_options={"ksp_type": "preonly",
                                      "pc_type": "lu"}).solve()
    tip_dofs = fem.locate_dofs_geometrical(
        V, lambda x: np.isclose(x[0], L_len))
    vals = uh.x.array.reshape(-1, 2)
    # dof indices are per-component interleaved in the blocked space;
    # read the y components of the tip dofs conservatively by node set.
    tip_nodes = set((tip_dofs // 2).tolist())
    tip_defl = max(abs(vals[n][1]) for n in tip_nodes) if tip_nodes else 0.0
    P = abs(traction) * H            # resultant force per unit thickness
    I = H ** 3 / 12.0                # second moment per unit thickness
    theory = P * L_len ** 3 / (3.0 * E * I)
    rel = abs(tip_defl - theory) / theory if theory else 0.0
    return {"tipDeflection": float(tip_defl), "beamTheory": float(theory),
            "relDeviation": float(rel), "converged": True}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "poisson"):
        nx = request.get("nx", 32)
        if not isinstance(nx, int) or isinstance(nx, bool) or nx < 4 or nx > 128:
            fail(2, "nx must be an integer in [4, 128], got %r" % (nx,))
        result = poisson(nx)
    elif op == "elasticity":
        traction = request.get("traction", -0.25)
        if not isinstance(traction, (int, float)) or isinstance(traction, bool):
            fail(2, "traction must be a number, got %r" % (traction,))
        result = elasticity(float(traction))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
