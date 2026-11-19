#!/usr/bin/env python3
"""ngspice circuit kernel — SXE-16 (ngspice; Xyce named in the doc).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver: it writes an RC
step-response netlist, runs `ngspice -b`, reads the wrdata output,
and serves v(out) at t = tau beside the exact closed form
V*(1 - e^-1) = 0.63212*V (band 2%: the tran grid + device models
are the only error sources). ngspice runs as a separate process;
nothing of it is imported here.

Ops:
  health / rc-step — request {rOhm, cF, vStep};
    defaults R=1000 ohm, C=1 uF (tau = 1 ms), V=1.

No ngspice on PATH is a provisioning defect: exit 3 naming it.
Unparseable wrdata is rejected (exit 5), never guessed.
"""
import json
import math
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


NETLIST = """RC step response (ConKay SXE-16 health)
V1 in 0 PULSE(0 %(V)r 0 1n 1n 1 2)
R1 in out %(R)r
C1 out 0 %(C)r
.tran %(STEP)r %(STOP)r
.control
run
wrdata %(OUT)s v(out)
.endc
.end
"""


def run_rc(r_ohm, c_f, v_step):
    ngspice = shutil.which("ngspice")
    if not ngspice:
        fail(3, "ngspice executable not found on PATH (ngspice is "
                "not provisioned for this engine env)")
    tau = r_ohm * c_f
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "ngspice-rc")
    os.makedirs(work, exist_ok=True)
    out_path = os.path.join(work, "rc.dat")
    netlist = NETLIST % {"V": v_step, "R": r_ohm, "C": c_f,
                         "STEP": tau / 50.0, "STOP": 3.0 * tau, "OUT": out_path}
    deck = os.path.join(work, "rc.cir")
    with open(deck, "w") as fh:
        fh.write(netlist)
    proc = subprocess.run([ngspice, "-b", deck], cwd=work, capture_output=True,
                          text=True, timeout=120)
    if proc.returncode != 0 or not os.path.exists(out_path):
        first = next((l.strip() for l in (proc.stderr or proc.stdout).splitlines()
                      if l.strip()), "ngspice exited %d" % proc.returncode)
        fail(6, "ngspice failed: %s" % first)
    rows = []
    with open(out_path) as fh:
        for line in fh:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    rows.append((float(parts[0]), float(parts[1])))
                except ValueError:
                    continue
    if not rows:
        fail(5, "ngspice wrdata held no numeric rows (garbled output rejected)")
    t_near, v_at_tau = min(rows, key=lambda rv: abs(rv[0] - tau))
    expected = v_step * (1.0 - math.exp(-1.0))
    rel = abs(v_at_tau - expected) / abs(expected) if expected else abs(v_at_tau)
    return {"tauS": tau, "vAtTau": v_at_tau, "expectedVAtTau": expected,
            "relError": rel, "converged": rel < 0.02}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "rc-step"):
        r_ohm = request.get("rOhm", 1000.0)
        c_f = request.get("cF", 1e-6)
        v_step = request.get("vStep", 1.0)
        for name, v in (("rOhm", r_ohm), ("cF", c_f), ("vStep", v_step)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_rc(float(r_ohm), float(c_f), float(v_step))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
