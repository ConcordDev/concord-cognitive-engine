#!/usr/bin/env python3
"""OpenModelica kernel — SXE-15 (OpenModelica + MSL, process-only).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver: it writes a
minimal Modelica model of a driven inertia (the shape of
Modelica.Mechanics.Rotational.Examples.First reduced to its
governing equation J*der(w) = T), simulates it with `omc`
(outputFormat=csv), and serves w(tEnd) beside the exact closed
form T*tEnd/J. OpenModelica runs as a separate process
(OSMC-PL/GPL-3 discipline); nothing of it is imported here.

Ops:
  health / first — request {inertia, torque, tEnd};
    defaults J=1, T=1, tEnd=1 -> w(1) = 1 exactly (band 1e-3
    for solver tolerance).

No omc on PATH is a provisioning defect: exit 3 naming it. An
unparseable result CSV is rejected (exit 5), never guessed.
"""
import csv
import glob
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


MODEL = """model FirstEq
  parameter Real J = %(J)r;
  parameter Real T = %(T)r;
  Real w(start = 0, fixed = true);
equation
  J * der(w) = T;
end FirstEq;
"""


def run_first(inertia, torque, t_end):
    omc = shutil.which("omc")
    if not omc:
        fail(3, "omc executable not found on PATH (OpenModelica is "
                "not provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "openmodelica-first")
    os.makedirs(work, exist_ok=True)
    with open(os.path.join(work, "FirstEq.mo"), "w") as fh:
        fh.write(MODEL % {"J": inertia, "T": torque})
    with open(os.path.join(work, "run.mos"), "w") as fh:
        fh.write('loadFile("FirstEq.mo");\n'
                 'simulate(FirstEq, stopTime=%r, numberOfIntervals=100, '
                 'outputFormat="csv");\n' % t_end)
    proc = subprocess.run([omc, "run.mos"], cwd=work, capture_output=True,
                          text=True, timeout=300)
    if proc.returncode != 0:
        first = next((l.strip() for l in proc.stderr.splitlines() if l.strip()),
                     "omc exited %d" % proc.returncode)
        fail(6, "omc failed: %s" % first)
    csvs = glob.glob(os.path.join(work, "FirstEq_res.csv"))
    if not csvs:
        fail(5, "omc produced no result CSV (garbled output rejected)")
    with open(csvs[0]) as fh:
        rows = list(csv.reader(fh))
    header, data = rows[0], [r for r in rows[1:] if r]
    if "w" not in header or not data:
        fail(5, "result CSV lacks the w column (garbled output rejected)")
    w_final = float(data[-1][header.index("w")])
    expected = torque * t_end / inertia
    rel = abs(w_final - expected) / abs(expected) if expected else abs(w_final)
    return {"wFinal": w_final, "expectedW": expected,
            "relError": rel, "converged": rel < 1e-3}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "first"):
        inertia = request.get("inertia", 1.0)
        torque = request.get("torque", 1.0)
        t_end = request.get("tEnd", 1.0)
        for name, v in (("inertia", inertia), ("tEnd", t_end)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        if not isinstance(torque, (int, float)) or isinstance(torque, bool):
            fail(2, "torque must be a number, got %r" % (torque,))
        result = run_first(float(inertia), float(torque), float(t_end))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
