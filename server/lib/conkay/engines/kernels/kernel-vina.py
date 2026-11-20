#!/usr/bin/env python3
"""AutoDock Vina kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock vina
binary (Apache-2, separate process). Health case (the plan's):
re-dock the ligand of a provisioned case back into its receptor
and measure the best mode's RMSD against the crystal pose —
RMSD < 2 A is the pass band, the standard redocking criterion.

The case is environment data (the lane provisions the AutoDock
Vina tutorial case, 1iep, or an equivalent published complex):
CONKAY_VINA_CASE_DIR must hold receptor.pdbqt, ligand.pdbqt (the
crystal pose), and case.json {"center": [x, y, z], "size":
[sx, sy, sz]}. No case dir is a provisioning defect: exit 3 —
the kernel never invents a docking case.

Ops:
  health / redock — request {}
    -> {bestAffinity, rmsdBest, converged}.

Missing vina is a provisioning defect: exit 3. A run whose output
carries no parseable mode table is rejected (exit 5).
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def parse_pdbqt_atoms(path):
    atoms = []
    with open(path, errors="replace") as fh:
        for line in fh:
            if line.startswith(("ATOM", "HETATM")):
                parts = line.split()
                try:
                    atoms.append((float(parts[5]), float(parts[6]),
                                  float(parts[7])))
                except (ValueError, IndexError):
                    continue
    return atoms


def rmsd(a, b):
    if len(a) != len(b) or not a:
        return None
    return math.sqrt(sum((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2
                         for (x1, y1, z1), (x2, y2, z2) in zip(a, b))
                     / len(a))


def run_redock(exhaustiveness=8):
    vina = shutil.which("vina")
    if not vina:
        fail(3, "vina executable not found on PATH (AutoDock Vina "
                "is not provisioned for this engine env)")
    case_dir = os.environ.get("CONKAY_VINA_CASE_DIR")
    if not case_dir or not os.path.isdir(case_dir):
        fail(3, "CONKAY_VINA_CASE_DIR=%r does not name a "
                "provisioned docking case (receptor.pdbqt, "
                "ligand.pdbqt, case.json)" % (case_dir,))
    receptor = os.path.join(case_dir, "receptor.pdbqt")
    ligand = os.path.join(case_dir, "ligand.pdbqt")
    case_json = os.path.join(case_dir, "case.json")
    for path in (receptor, ligand, case_json):
        if not os.path.exists(path):
            fail(3, "docking case is missing %s (provisioning "
                    "defect)" % os.path.basename(path))
    with open(case_json) as fh:
        case = json.load(fh)
    center = case["center"]
    size = case["size"]
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    out_path = os.path.join(scratch, "vina-out.pdbqt")
    cmd = [vina, "--receptor", receptor, "--ligand", ligand,
           "--center_x", str(center[0]), "--center_y", str(center[1]),
           "--center_z", str(center[2]),
           "--size_x", str(size[0]), "--size_y", str(size[1]),
           "--size_z", str(size[2]),
           "--exhaustiveness", str(int(exhaustiveness)),
           "--out", out_path]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          timeout=1800)
    out = proc.stdout + proc.stderr
    if proc.returncode != 0:
        fail(6, "vina failed (exit %d)" % proc.returncode)
    m = re.search(r"^\s*1\s+(-?\d+\.\d+)\s+", out, re.MULTILINE)
    if not m or not os.path.exists(out_path):
        fail(5, "vina output carried no mode table (garbled "
                "output rejected)")
    affinity = float(m.group(1))
    crystal = parse_pdbqt_atoms(ligand)
    docked = parse_pdbqt_atoms(out_path)
    value = rmsd(crystal, docked)
    if value is None:
        fail(5, "could not align docked pose atoms with the "
                "crystal pose (garbled output rejected)")
    return {"bestAffinity": affinity, "rmsdBest": value,
            "converged": value < 2.0}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_redock()
    elif op == "redock":
        exh = request.get("exhaustiveness", 8)
        if not isinstance(exh, int) or isinstance(exh, bool) or exh < 1:
            fail(2, "exhaustiveness must be a positive integer, "
                    "got %r" % (exh,))
        result = run_redock(exh)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
