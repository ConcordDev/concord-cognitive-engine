#!/usr/bin/env python3
"""acados kernel — SXE-20 (controls set, acados leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a finite-horizon LQR OCP
on the double integrator (x0 = [1, 0], Q = diag(1, 0.1), R = 0.1,
N = 20, tf = 2 s), solved by acados (BSD-2, separate process; its
code generation + SQP_RTI run inside this child). The independent
reference is computed in the kernel by iterating the discrete
Riccati equation in numpy for the same discretised system: the
first optimal control u0 must agree within 5% (the band covers
acados' RTI single-iteration-per-step scheme vs the exact
finite-horizon solution), and the terminal state must be small
(|p(tf)| < 0.1 from p0 = 1).

Ops:
  health / ocp — request {p0, nSteps, tFinal};
    defaults p0=1, N=20, tf=2.

No acados_template in the driver env is a provisioning defect:
exit 3 naming the import. A nonzero solver status raises
(exit 6) rather than serving an unconverged trajectory.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def riccati_first_control(p0, n_steps, t_final):
    import numpy as np
    dt = t_final / n_steps
    A = np.array([[1.0, dt], [0.0, 1.0]])
    B = np.array([[dt * dt / 2.0], [dt]])
    Q = np.diag([1.0, 0.1])
    R = np.array([[0.1]])
    P = Q.copy()
    for _ in range(n_steps):
        K = np.linalg.solve(R + B.T @ P @ B, B.T @ P @ A)
        P = Q + A.T @ P @ (A - B @ K)
    K0 = np.linalg.solve(R + B.T @ P @ B, B.T @ P @ A)
    # Recompute the FIRST-step gain by rolling the recursion from
    # the terminal cost and taking the gain at step 0.
    gains = []
    P = Q.copy()
    seq = []
    for _ in range(n_steps):
        K = np.linalg.solve(R + B.T @ P @ B, B.T @ P @ A)
        seq.append(K)
        P = Q + A.T @ P @ (A - B @ K)
    K_first = seq[-1]
    u0 = -float((K_first @ np.array([p0, 0.0]))[0])
    return u0


def run_ocp(p0, n_steps, t_final):
    try:
        from acados_template import AcadosOcp, AcadosOcpSolver, AcadosModel
        import casadi as ca
        import numpy as np
    except Exception as e:
        fail(3, "acados import failed (%s) - the acados driver env "
                "is not provisioned" % e)
    model = AcadosModel()
    model.name = "double_integrator"
    x = ca.SX.sym("x", 2)
    u = ca.SX.sym("u", 1)
    xdot = ca.SX.sym("xdot", 2)
    model.x, model.u, model.xdot = x, u, xdot
    model.f_expl_expr = ca.vertcat(x[1], u)
    model.f_impl_expr = xdot - model.f_expl_expr
    ocp = AcadosOcp()
    ocp.model = model
    ocp.solver_options.N_horizon = n_steps
    ocp.solver_options.tf = t_final
    ocp.cost.cost_type = "LINEAR_LS"
    ocp.cost.cost_type_e = "LINEAR_LS"
    Vx = np.zeros((3, 2)); Vx[0, 0] = 1.0; Vx[1, 1] = 1.0
    Vu = np.zeros((3, 1)); Vu[2, 0] = 1.0
    ocp.cost.Vx, ocp.cost.Vu = Vx, Vu
    ocp.cost.W = np.diag([1.0, 0.1, 0.1])
    ocp.cost.W_e = np.diag([1.0, 0.1])
    ocp.cost.Vx_e = np.eye(2)
    ocp.cost.yref = np.zeros(3)
    ocp.cost.yref_e = np.zeros(2)
    ocp.constraints.x0 = np.array([p0, 0.0])
    ocp.solver_options.qp_solver = "PARTIAL_CONDENSING_HPIPM"
    ocp.solver_options.nlp_solver_type = "SQP_RTI"
    ocp.solver_options.hessian_approx = "EXACT"
    import os
    code_dir = os.path.join(os.environ.get("CONKAY_ENGINE_SCRATCH")
                            or os.getcwd(), "acados-ocp")
    ocp.code_export_directory = code_dir
    try:
        solver = AcadosOcpSolver(ocp, json_file=os.path.join(
            code_dir, "acados_ocp.json"))
        status = solver.solve()
    except Exception as e:
        fail(6, "acados solve failed: %s" % e)
    if status != 0:
        fail(6, "acados returned nonzero status %d" % status)
    u0 = float(solver.get(0, "u")[0])
    x_final = solver.get(n_steps, "x")
    p_final = float(x_final[0])
    u0_ref = riccati_first_control(p0, n_steps, t_final)
    rel = abs(u0 - u0_ref) / abs(u0_ref) if u0_ref else abs(u0)
    return {"u0": u0, "u0Reference": u0_ref, "relError": rel,
            "pFinal": p_final,
            "converged": rel <= 0.05 and abs(p_final) < 0.1}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "ocp"):
        p0 = request.get("p0", 1.0)
        n_steps = request.get("nSteps", 20)
        t_final = request.get("tFinal", 2.0)
        if not isinstance(p0, (int, float)) or isinstance(p0, bool):
            fail(2, "p0 must be a number, got %r" % (p0,))
        for name, v in (("nSteps", n_steps), ("tFinal", t_final)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_ocp(float(p0), int(n_steps), float(t_final))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
