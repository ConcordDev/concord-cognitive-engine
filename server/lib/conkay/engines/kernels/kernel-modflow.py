#!/usr/bin/env python3
"""MODFLOW 6 kernel (via FloPy) — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a one-layer confined
aquifer strip (21 cells, K = 10 m/day) with fixed heads at both
ends. The steady head profile of a homogeneous confined strip is
exactly linear, so the middle cell's head must equal the mean of
the boundary heads (band 2% of the head drop) — a closed form the
kernel computes itself, not a stored number. The general op takes
the two boundary heads by the same route.

The mf6 binary is provisioned by the lane (CONKAY_MF6_BIN or the
FloPy get-modflow location). No binary is a provisioning defect:
exit 3.

Ops:
  health / aquifer — request {headLeft, headRight} (defaults 10, 0)
    -> {headMid, expectedHeadMid, relError, converged}.

No flopy in the driver env is a provisioning defect: exit 3.
"""
import json
import os
import shutil
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_aquifer(head_left, head_right):
    try:
        import flopy
        import numpy as np
    except Exception as e:
        fail(3, "flopy import failed (%s) - the modflow driver "
                "env is not provisioned" % e)
    exe = os.environ.get("CONKAY_MF6_BIN") or shutil.which("mf6")
    if not exe or not os.path.exists(exe):
        fail(3, "mf6 binary not found (CONKAY_MF6_BIN unset and no "
                "mf6 on PATH) - MODFLOW 6 is not provisioned for "
                "this engine env")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "mf6-aquifer")
    os.makedirs(work, exist_ok=True)
    ncol = 21
    sim = flopy.mf6.MFSimulation(sim_name="conkay", version="mf6",
                                 exe_name=exe, sim_ws=work)
    tdis = flopy.mf6.ModflowTdis(sim, nper=1,
                                 perioddata=[(1.0, 1, 1.0)])
    ims = flopy.mf6.ModflowIms(sim, complexity="SIMPLE")
    gwf = flopy.mf6.ModflowGwf(sim, modelname="aquifer",
                               save_flows=True)
    dis = flopy.mf6.ModflowGwfdis(gwf, nlay=1, nrow=1, ncol=ncol,
                                  delr=50.0, delc=50.0, top=20.0,
                                  botm=0.0)
    ic = flopy.mf6.ModflowGwfic(gwf, strt=(head_left + head_right) / 2.0)
    npf = flopy.mf6.ModflowGwfnpf(gwf, k=10.0)
    chd_left = [[(0, 0, 0), head_left]]
    chd_right = [[(0, 0, ncol - 1), head_right]]
    chd = flopy.mf6.ModflowGwfchd(
        gwf, stress_period_data=chd_left + chd_right,
        save_flows=False)
    oc = flopy.mf6.ModflowGwfoc(
        gwf, head_filerecord="aquifer.hds",
        saverecord=[("HEAD", "LAST")])
    sim.write_simulation(silent=True)
    success, _ = sim.run_simulation(silent=True)
    if not success:
        fail(6, "mf6 did not complete the aquifer simulation")
    hds_path = os.path.join(work, "aquifer.hds")
    if not os.path.exists(hds_path):
        fail(5, "mf6 produced no head file (garbled output "
                "rejected)")
    hds = flopy.utils.HeadFile(hds_path)
    heads = hds.get_data(totim=1.0)[0, 0, :]
    head_mid = float(heads[ncol // 2])
    expected = (head_left + head_right) / 2.0
    drop = abs(head_left - head_right) or 1.0
    rel = abs(head_mid - expected) / drop
    return {"headMid": head_mid, "expectedHeadMid": expected,
            "relError": rel, "converged": bool(rel <= 0.02)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "aquifer"):
        head_left = request.get("headLeft", 10.0)
        head_right = request.get("headRight", 0.0)
        for name, val in (("headLeft", head_left),
                          ("headRight", head_right)):
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                fail(2, "%s must be a number, got %r" % (name, val))
        result = run_aquifer(float(head_left), float(head_right))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
