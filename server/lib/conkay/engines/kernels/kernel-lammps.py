#!/usr/bin/env python3
"""LAMMPS kernel - SXE-27.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. GPL-2 code driven as a separate
process (nothing imported). Health case (the plan's): Lennard-
Jones argon under NVE - a 256-atom FCC melt equilibrated in LJ
units, then run microcanonically; the acceptance is the plan's
energy-drift bound: |E_end - E_start| / |E_start| <= 1% over the
production run, read from the thermo log the kernel parses.

Ops:
  health - request {} (1000 production steps)
  nve-run - request {steps} in [100, 5000]
    -> {initialEnergy, finalEnergy, relDrift, converged}.

No lammps binary on PATH is a provisioning defect: exit 3.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


DECK = """units lj
atom_style atomic
boundary p p p
lattice fcc 0.8442
region box block 0 4 0 4 0 4
create_box 1 box
create_atoms 1 box
mass 1 1.0
velocity all create 1.0 87287 dist gaussian
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
neighbor 0.3 bin
neigh_modify every 20 delay 0 check no
fix eq all nvt temp 1.0 1.0 0.1
run 500
unfix eq
fix nve all nve
thermo_style custom step etotal
thermo 100
run %(steps)d
"""


def run_nve(steps):
    exe = shutil.which("lmp") or shutil.which("lammps")
    if not exe:
        fail(3, "lammps executable (lmp) not found on PATH - the "
                "lammps driver env is not provisioned")
    with tempfile.TemporaryDirectory(prefix="conkay-lammps-") as td:
        deck_path = os.path.join(td, "in.lj")
        log_path = os.path.join(td, "log.lammps")
        with open(deck_path, "w") as fh:
            fh.write(DECK % {"steps": steps})
        proc = subprocess.run([exe, "-in", deck_path, "-log", log_path],
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0 or not os.path.exists(log_path):
            fail(6, "lammps run failed (rc=%s): %s"
                    % (proc.returncode, (proc.stderr or "")[:200]))
        log = open(log_path).read()
    rows = re.findall(r"^\s*(\d+)\s+(-?[0-9.]+)\s*$", log, re.M)
    series = [(int(s), float(e)) for s, e in rows]
    if len(series) < 2:
        fail(6, "lammps log carried no etotal series")
    e0, e1 = series[0][1], series[-1][1]
    if e0 == 0:
        fail(6, "lammps served a zero initial total energy")
    drift = abs(e1 - e0) / abs(e0)
    return {"initialEnergy": e0, "finalEnergy": e1,
            "relDrift": drift, "converged": bool(drift <= 0.01)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "nve-run"):
        steps = request.get("steps", 1000)
        if not isinstance(steps, int) or not (100 <= steps <= 5000):
            fail(2, "steps must be an integer in [100, 5000], "
                    "got %r" % (steps,))
        result = run_nve(steps)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
