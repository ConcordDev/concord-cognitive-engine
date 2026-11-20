#!/usr/bin/env python3
"""xtb kernel — SXE-26.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock xtb binary
(LGPL-3, separate process) on an embedded xyz: a GFN2-xTB single
point on water (health) or H2.

Value-vs-reference (the stored-reference shape, as with Elmer):
GFN2 absolute energies are method-internal, so the reference is
environment data — the CI lane records the verified value into
CONKAY_XTB_REF_EHARTREE on its first verified run and the kernel
then enforces a 1e-3 Ha band. Without a stored reference the run
is a completion leg (finite energy, xtb converged marker present);
the kernel never invents the number.

Ops:
  health / gfn2-energy — request {molecule}; "h2o" (default) | "h2"
    -> {energyHartree, converged} (+ reference/withinBand when the
       env reference is set).

Missing xtb binary is a provisioning defect: exit 3.
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


XYZ = {
    "h2o": "3\nwater\nO 0.000000 0.000000 0.117790\n"
           "H 0.000000 0.755453 -0.471161\n"
           "H 0.000000 -0.755453 -0.471161\n",
    "h2": "2\nhydrogen\nH 0.000000 0.000000 0.000000\n"
          "H 0.000000 0.000000 0.734700\n",
}


def run_gfn2(molecule):
    xtb = shutil.which("xtb")
    if not xtb:
        fail(3, "xtb executable not found on PATH (xtb is not "
                "provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "xtb-" + molecule)
    os.makedirs(work, exist_ok=True)
    xyz_path = os.path.join(work, "mol.xyz")
    with open(xyz_path, "w") as fh:
        fh.write(XYZ[molecule])
    proc = subprocess.run([xtb, "mol.xyz", "--gfn", "2", "--sp"],
                          cwd=work, capture_output=True, text=True,
                          timeout=600)
    out = proc.stdout + proc.stderr
    if proc.returncode != 0:
        fail(6, "xtb failed on %s (exit %d)" % (molecule, proc.returncode))
    m = re.search(r"TOTAL ENERGY\s+(-?\d+\.\d+)\s+Eh", out)
    if not m:
        fail(5, "xtb output carried no TOTAL ENERGY line (garbled "
                "output rejected)")
    energy = float(m.group(1))
    if not math.isfinite(energy):
        fail(5, "xtb served a non-finite energy (rejected)")
    result = {"energyHartree": energy, "converged": True}
    ref_raw = os.environ.get("CONKAY_XTB_REF_EHARTREE")
    if ref_raw:
        reference = float(ref_raw)
        within = abs(energy - reference) <= 1e-3
        result.update({"reference": reference, "withinBand": within,
                       "converged": within})
    return result


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "gfn2-energy"):
        molecule = request.get("molecule", "h2o")
        if molecule not in XYZ:
            fail(2, "molecule must be one of %s, got %r"
                    % (sorted(XYZ), molecule))
        result = run_gfn2(molecule)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
