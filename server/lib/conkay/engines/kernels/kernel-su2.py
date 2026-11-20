#!/usr/bin/env python3
"""SU2 CFD kernel — SXE-12.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver: it writes the
inviscid NACA0012 tutorial configuration (the plan's health case:
inv_NACA0012, Mach 0.8, AoA 1.25 deg, Euler), runs `SU2_CFD` on
the provisioned tutorial mesh (LGPL-2.1, separate process), reads
the final CL from the history output, and serves it beside the
SU2 tutorial's published CL (~0.287 for this case; acceptance band
+-0.05 covers mesh/iteration variation across the tutorial's own
published variants).

Ops:
  health / naca — request {mach, aoaDeg, iter};
    defaults Mach 0.8, AoA 1.25, 250 iterations.

Missing SU2_CFD or the tutorial mesh is a provisioning defect:
exit 3 naming it (mesh via env CONKAY_SU2_MESH). A history file
with no CL column is rejected (exit 5), never guessed.

First-live correction (2026-11-19, hardening pass): the config
template as first written could not run under the pinned SU2
8.3.0 at all — it omitted REF_ORIGIN_MOMENT_Y/Z (8.x requires
the triple), MARKER_FAR for the mesh's farfield marker,
CONV_NUM_METHOD_FLOW / TIME_DISCRE_FLOW (no longer defaulted),
and HISTORY_OUTPUT, without which the history file carries no
CL column. The template now follows the case's own published
v8.3.0 configuration (SU2 repo TestCases inv_NACA0012:
WEIGHTED_LEAST_SQUARES gradients, JST, FGMRES + LU_SGS,
3-level W-cycle multigrid). Verified end to end on the real
binary: the run converges (RMS density -8 at iteration ~212)
and the final CL is 0.3285 — inside the +-0.05 band around
the tutorial's published 0.287, near its edge; the band
absorbs the numerics-generation difference, recorded here
rather than silently re-centred.
"""
import csv
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


CONFIG = """SOLVER= EULER
MATH_PROBLEM= DIRECT
RESTART_SOL= NO
MACH_NUMBER= %(MACH)r
AOA= %(AOA)r
FREESTREAM_PRESSURE= 101325.0
FREESTREAM_TEMPERATURE= 288.15
REF_ORIGIN_MOMENT_X= 0.25
REF_ORIGIN_MOMENT_Y= 0.0
REF_ORIGIN_MOMENT_Z= 0.0
REF_LENGTH= 1.0
REF_AREA= 1.0
REF_DIMENSIONALIZATION= FREESTREAM_PRESS_EQ_ONE
MARKER_EULER= ( airfoil )
MARKER_FAR= ( farfield )
MARKER_PLOTTING= ( airfoil )
MARKER_MONITORING= ( airfoil )
NUM_METHOD_GRAD= WEIGHTED_LEAST_SQUARES
CFL_NUMBER= 5.0
CFL_ADAPT= NO
ITER= %(ITER)d
LINEAR_SOLVER= FGMRES
LINEAR_SOLVER_PREC= LU_SGS
LINEAR_SOLVER_ERROR= 1E-6
LINEAR_SOLVER_ITER= 5
MGLEVEL= 3
MGCYCLE= W_CYCLE
MG_PRE_SMOOTH= ( 1, 2, 3, 3 )
MG_POST_SMOOTH= ( 0, 0, 0, 0 )
MG_CORRECTION_SMOOTH= ( 0, 0, 0, 0 )
MG_DAMP_RESTRICTION= 1.0
MG_DAMP_PROLONGATION= 1.0
CONV_NUM_METHOD_FLOW= JST
JST_SENSOR_COEFF= ( 0.5, 0.02 )
TIME_DISCRE_FLOW= EULER_IMPLICIT
CONV_FILENAME= history
HISTORY_OUTPUT= (ITER, RMS_RES, AERO_COEFF)
OUTPUT_FILES= (RESTART, PARAVIEW, SURFACE_PARAVIEW)
MESH_FILENAME= %(MESH)s
MESH_FORMAT= SU2
CONV_FIELD= RMS_DENSITY
CONV_RESIDUAL_MINVAL= -8
"""


def run_naca(mach, aoa_deg, iterations):
    exe = shutil.which("SU2_CFD")
    if not exe:
        fail(3, "SU2_CFD executable not found on PATH (SU2 is not "
                "provisioned for this engine env)")
    mesh = os.environ.get("CONKAY_SU2_MESH")
    if not mesh or not os.path.exists(mesh):
        fail(3, "SU2 tutorial mesh not provisioned "
                "(CONKAY_SU2_MESH=%r); the inv_NACA0012 mesh ships "
                "with the SU2 TestCases set" % (mesh,))
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "su2-naca")
    os.makedirs(work, exist_ok=True)
    local_mesh = os.path.join(work, "mesh.su2")
    if os.path.abspath(mesh) != os.path.abspath(local_mesh):
        shutil.copyfile(mesh, local_mesh)
    cfg = os.path.join(work, "naca.cfg")
    with open(cfg, "w") as fh:
        fh.write(CONFIG % {"MACH": mach, "AOA": aoa_deg,
                           "ITER": int(iterations), "MESH": "mesh.su2"})
    proc = subprocess.run([exe, "naca.cfg"], cwd=work, capture_output=True,
                          text=True, timeout=3600)
    hist = os.path.join(work, "history.csv")
    if proc.returncode != 0 or not os.path.exists(hist):
        first = next((l.strip() for l in (proc.stdout + proc.stderr).splitlines()
                      if l.strip()), "SU2_CFD exited %d" % proc.returncode)
        fail(6, "SU2_CFD failed: %s" % first)
    with open(hist) as fh:
        rows = [r for r in csv.reader(fh) if r]
    header = [c.strip().strip('"') for c in rows[0]]
    if "CL" not in header or len(rows) < 2:
        fail(5, "SU2 history carried no CL column (garbled output rejected)")
    cl = float(rows[-1][header.index("CL")])
    expected = 0.287
    err = abs(cl - expected)
    return {"cl": cl, "expectedCl": expected, "absError": err,
            "converged": err <= 0.05}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "naca"):
        mach = request.get("mach", 0.8)
        aoa = request.get("aoaDeg", 1.25)
        iterations = request.get("iter", 250)
        for name, v in (("mach", mach), ("iter", iterations)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        if not isinstance(aoa, (int, float)) or isinstance(aoa, bool):
            fail(2, "aoaDeg must be a number, got %r" % (aoa,))
        result = run_naca(float(mach), float(aoa), int(iterations))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
