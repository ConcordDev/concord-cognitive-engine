#!/usr/bin/env python3
"""EPANET kernel — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the EPANET toolkit
shared library (US EPA public domain) through ctypes — the
library runs inside this child kernel process only.

Health case: a single-pipe network written by the kernel —
reservoir at head 100 m, one 1000 m / 300 mm / C=100 pipe, one
junction demanding the request's flow. EPANET's junction head
must match the closed-form Hazen-Williams headloss computed
independently in the kernel:
  hf = 10.67 * L * Q^1.852 / (C^1.852 * d^4.87)   (SI)
  head = 100 - hf                                 (band 1%).

The library is environment data: CONKAY_EPANET_LIB names the
provisioned libepanet path. Absent library is a provisioning
defect: exit 3.

Ops:
  health / pipe — request {demandM3s} (default 0.05)
    -> {headM, expectedHeadM, relError, converged}.
"""
import ctypes
import json
import math
import os
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


INP = """[TITLE]
ConKay EPANET health case - single pipe

[JUNCTIONS]
;ID               Elev        Demand
J1                0           %DEMAND_LPS%

[RESERVOIRS]
;ID               Head
R1                100

[PIPES]
;ID               Node1            Node2            Length   Diameter Roughness
P1                R1               J1               1000     300      100

[COORDINATES]
J1                1.0              0.0
R1                0.0              0.0

[OPTIONS]
Units             LPS
Headloss          H-W

[END]
"""

EN_NODECOUNT = 0
EN_HEAD = 11
EN_NODEINDEX = 1


def run_pipe(demand_m3s):
    lib_path = os.environ.get("CONKAY_EPANET_LIB")
    if not lib_path or not os.path.exists(lib_path):
        fail(3, "CONKAY_EPANET_LIB=%r does not name a provisioned "
                "EPANET toolkit library" % (lib_path,))
    try:
        lib = ctypes.CDLL(lib_path)
    except OSError as e:
        fail(3, "EPANET toolkit library failed to load (%s)" % e)
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "epanet-health")
    os.makedirs(work, exist_ok=True)
    inp_path = os.path.join(work, "health.inp")
    rpt_path = os.path.join(work, "health.rpt")
    out_path = os.path.join(work, "health.bin")
    with open(inp_path, "w") as fh:
        fh.write(INP.replace("%DEMAND_LPS%", repr(demand_m3s * 1000.0)))
    project = ctypes.c_void_p()
    err = lib.EN_createproject(ctypes.byref(project))
    if err:
        fail(6, "EN_createproject failed (err %d)" % err)
    try:
        err = lib.EN_open(project, inp_path.encode(), rpt_path.encode(),
                          out_path.encode())
        if err:
            fail(6, "EN_open failed (err %d)" % err)
        err = lib.EN_solveH(project)
        if err:
            fail(6, "EN_solveH failed (err %d)" % err)
        index = ctypes.c_int(0)
        err = lib.EN_getnodeindex(project, b"J1",
                                  ctypes.byref(index))
        if err:
            fail(6, "EN_getnodeindex failed (err %d)" % err)
        value = ctypes.c_double(0.0)
        err = lib.EN_getnodevalue(project, index, EN_HEAD,
                                  ctypes.byref(value))
        if err:
            fail(6, "EN_getnodevalue failed (err %d)" % err)
        head = float(value.value)
    finally:
        lib.EN_close(project)
        lib.EN_deleteproject(project)
    q = demand_m3s
    hf = 10.67 * 1000.0 * q ** 1.852 / (100.0 ** 1.852 * 0.3 ** 4.87)
    expected = 100.0 - hf
    rel = abs(head - expected) / expected
    return {"headM": head, "expectedHeadM": expected,
            "relError": rel, "converged": rel <= 0.01}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "pipe"):
        demand = request.get("demandM3s", 0.05)
        if not isinstance(demand, (int, float)) \
                or isinstance(demand, bool) or demand <= 0:
            fail(2, "demandM3s must be a positive number, got %r"
                    % (demand,))
        result = run_pipe(float(demand))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
