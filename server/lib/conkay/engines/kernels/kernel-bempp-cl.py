#!/usr/bin/env python3
"""bempp-cl kernel - SXE-34.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on
stdin, one result JSON on stdout. Health case (the plan's):
acoustic scattering from a rigid (sound-soft, Dirichlet) unit
sphere vs the analytic Mie series. A plane wave exp(i k z)
impinges; bempp-cl solves the exterior Dirichlet problem with
the single-layer representation on a coarse sphere grid
(h = 0.3), and the kernel evaluates the scattered field at a
far point on the +z axis (r = 10). The expected value is the
Mie far field e^{i k r} / r * f(0) with
f(0) = (1 / i k) * sum_n (2n + 1) * (-j_n(ka) / h_n(ka)),
computed in-kernel from scipy's spherical Bessel functions
(n to 25; ka <= 4 needs far fewer). Band 15%: the coarse DP0
grid's discretisation error dominates and is honestly inside
that band at these wavenumbers.

Ops:
  health - request {} (k = 2)
  scatter - request {wavenumber} in [0.5, 4]
    -> {farFieldAbs, expectedFarFieldAbs, relError, converged}.

No bempp in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def mie_forward(k, a, r, n_max=25):
    import numpy as np
    from scipy.special import spherical_jn, spherical_yn
    ka = k * a
    total = 0.0j
    for n in range(n_max + 1):
        j = spherical_jn(n, ka)
        h = j + 1j * spherical_yn(n, ka)
        total += (2 * n + 1) * (-j / h)
    f0 = total / (1j * k)
    return abs(np.exp(1j * k * r) / r * f0)


def run_scatter(k):
    try:
        import bempp.api
        import numpy as np
        from bempp.api.operators.boundary import helmholtz as bh
        from bempp.api.operators.potential import helmholtz as ph
    except Exception as e:
        fail(3, "bempp import failed (%s) - the bempp-cl driver "
                "env is not provisioned" % e)
    a = 1.0
    grid = bempp.api.shapes.sphere(r=a, h=0.3)
    space = bempp.api.function_space(grid, "DP", 0)
    slp = bh.single_layer(space, space, space, k)

    def incident(x, n, domain_index, result):
        result[0] = np.exp(1j * k * x[2])

    rhs = bempp.api.GridFunction(space, fun=incident)
    phi, info = bempp.api.linalg.gmres(slp, rhs, tol=1e-5,
                                       maxiter=200)
    if info != 0:
        fail(6, "bempp GMRES did not converge (info=%s)" % (info,))
    r_far = 10.0
    pts = np.array([[0.0], [0.0], [r_far]])
    pot = ph.single_layer(space, pts, k)
    u_scat = (pot * phi).ravel()
    got = abs(complex(u_scat[0]))
    exp = mie_forward(k, a, r_far)
    rel = abs(got - exp) / exp
    return {"farFieldAbs": got, "expectedFarFieldAbs": exp,
            "relError": rel, "converged": bool(rel <= 0.15)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "scatter"):
        k = request.get("wavenumber", 2.0)
        if not isinstance(k, (int, float)) or not (0.5 <= k <= 4):
            fail(2, "wavenumber must be a number in [0.5, 4], "
                    "got %r" % (k,))
        result = run_scatter(float(k))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
