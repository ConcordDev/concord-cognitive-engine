#!/usr/bin/env python3
"""PETSc / SLEPc linear-algebra engine kernel — SXE-03.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on
stdin, one result JSON on stdout. PETSc installs into the
FEniCSx env (SOLVER-ENGINES-PLAN.md §2: petsc4py + slepc4py
from conda-forge), so this kernel's driver env is the
fenicsx env's Python — the sharing is deliberate and named
in the manifest entry.

Ops:
  health        — the 1-D Poisson KSP solve (the plan's
                  health case); serves {maxError,
                  iterations}; the health bound is
                  maxError < 1e-3, asserted by the suite.
  ksp-poisson1d — -u'' = pi^2 sin(pi x) on (0,1), u(0)=u(1)=0,
                  exact solution sin(pi x); request {n}
                  (interior points, default 63, range
                  [8, 4096]). CG + Jacobi on the standard
                  3-point Laplacian.
  eigen         — SLEPc smallest eigenpair of the same
                  discrete Laplacian; the reference is the
                  EXACT discrete eigenvalue
                  (4/h^2) sin^2(pi h / 2), h = 1/(n+1) —
                  independent of any solver output.

A KSP/EPS non-convergence is served as converged:false with
the iteration count, which the framework maps to
NOT_COMPUTED engine_not_converged — never a quiet wrong
answer. A petsc4py stack that does not import is a
provisioning defect: exit 3 naming the failure.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


try:
    from petsc4py import PETSc
    from slepc4py import SLEPc
except Exception as exc:  # provisioning defect, named
    fail(3, "petsc stack import failed: %s" % (exc,))


def laplacian_1d(n):
    h = 1.0 / (n + 1)
    mat = PETSc.Mat()
    mat.create(PETSc.COMM_WORLD)
    mat.setSizes([n, n])
    mat.setType("aij")
    mat.setPreallocationNNZ(3)
    for i in range(n):
        mat.setValue(i, i, 2.0 / h ** 2)
        if i > 0:
            mat.setValue(i, i - 1, -1.0 / h ** 2)
        if i < n - 1:
            mat.setValue(i, i + 1, -1.0 / h ** 2)
    mat.assemblyBegin()
    mat.assemblyEnd()
    return mat, h


def ksp_poisson1d(n):
    mat, h = laplacian_1d(n)
    xs = [(i + 1) * h for i in range(n)]
    b = mat.createVecRight()
    b.setValues(range(n), [math.pi ** 2 * math.sin(math.pi * x) for x in xs])
    b.assemblyBegin()
    b.assemblyEnd()
    x = mat.createVecRight()
    ksp = PETSc.KSP()
    ksp.create(PETSc.COMM_WORLD)
    ksp.setOperators(mat)
    ksp.setType("cg")
    ksp.getPC().setType("jacobi")
    ksp.setTolerances(rtol=1e-12, atol=1e-14, max_it=10000)
    ksp.solve(b, x)
    reason = int(ksp.getConvergedReason())
    got = x.getValues(range(n))
    max_err = max(abs(g - math.sin(math.pi * xx)) for g, xx in zip(got, xs))
    result = {"maxError": float(max_err),
              "iterations": int(ksp.getIterationNumber()),
              "converged": reason > 0}
    if reason <= 0:
        result["residuals"] = [float(ksp.getResidualNorm())]
    return result


def eigen_smallest(n):
    mat, h = laplacian_1d(n)
    eps = SLEPc.EPS()
    eps.create(PETSc.COMM_WORLD)
    eps.setOperators(mat)
    eps.setProblemType(SLEPc.EPS.ProblemType.HEP)
    eps.setWhichEigenpairs(SLEPc.EPS.Which.SMALLEST_REAL)
    eps.setDimensions(nev=1)
    eps.setTolerances(tol=1e-12, max_it=10000)
    eps.solve()
    nconv = eps.getConverged()
    if nconv < 1:
        return {"eigenvalue": 0.0, "exactEigenvalue": 0.0,
                "relError": 1.0, "converged": False,
                "residuals": [float(nconv)]}
    vr = mat.createVecRight()
    lam = eps.getEigenpair(0, vr)
    lam = float(lam.real)
    exact = (4.0 / h ** 2) * math.sin(math.pi * h / 2.0) ** 2
    return {"eigenvalue": lam, "exactEigenvalue": float(exact),
            "relError": float(abs(lam - exact) / exact),
            "converged": True}


def checked_n(request):
    n = request.get("n", 63)
    if not isinstance(n, int) or isinstance(n, bool) or n < 8 or n > 4096:
        fail(2, "n must be an integer in [8, 4096], got %r" % (n,))
    return n


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = ksp_poisson1d(63)
    elif op == "ksp-poisson1d":
        result = ksp_poisson1d(checked_n(request))
    elif op == "eigen":
        result = eigen_smallest(checked_n(request))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
