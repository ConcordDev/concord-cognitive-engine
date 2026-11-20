#!/usr/bin/env python3
"""Quantum ESPRESSO kernel — SXE-26 (the plan §4 folded leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock pw.x binary
(GPL-2, separate process) on an embedded silicon bulk SCF deck
(2-atom diamond cell, deliberately small cutoffs and k-grid: a
smoke case, not a production calculation).

Value-vs-reference (the stored-reference shape, as with Elmer):
the lane records the verified total energy into
CONKAY_QE_REF_RY on its first verified run and the kernel then
enforces a 0.5% band. In every case the run must carry pw.x's own
"convergence has been achieved" marker; without a stored
reference the run is a completion leg and no number is invented.

Ops:
  health / scf — request {}
    -> {energyRy, converged} (+ reference/withinBand when set).

Missing pw.x is a provisioning defect: exit 3.
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


def find_tool(name):
    """PATH first, then the sibling of the running interpreter —
    the SXE-00 env-provisioning shape: a tool installed into the
    kernel's own driver env (a pip/conda console entry point)
    sits beside its python even when the ambient PATH does not
    carry the env's bin (first-live correction, 2026-11-19)."""
    exe = shutil.which(name)
    if exe:
        return exe
    sibling = os.path.join(
        os.path.dirname(os.path.abspath(sys.executable)), name)
    if os.path.isfile(sibling) and os.access(sibling, os.X_OK):
        return sibling
    return None


DECK = """&CONTROL
  calculation = 'scf', prefix = 'si', outdir = './out',
  pseudo_dir = './pseudo', verbosity = 'low'
/
&SYSTEM
  ibrav = 2, celldm(1) = 10.262, nat = 2, ntyp = 1,
  ecutwfc = %ECUT%, ecutrho = 80.0,
  occupations = 'smearing', smearing = 'gaussian', degauss = 0.01
/
&ELECTRONS
  conv_thr = 1.0d-8
/
ATOMIC_SPECIES
  Si 28.0855 Si.pz-n-rrkjus_psl.1.0.0.UPF
ATOMIC_POSITIONS alat
  Si 0.00 0.00 0.00
  Si 0.25 0.25 0.25
K_POINTS automatic
  4 4 4 0 0 0
"""


def run_scf(ecut_wfc=20.0):
    pw = find_tool("pw.x")
    if not pw:
        fail(3, "pw.x executable not found on PATH (Quantum "
                "ESPRESSO is not provisioned for this engine env)")
    pseudo_src = os.environ.get("CONKAY_QE_PSEUDO")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "qe-si")
    os.makedirs(os.path.join(work, "pseudo"), exist_ok=True)
    os.makedirs(os.path.join(work, "out"), exist_ok=True)
    if pseudo_src:
        dst = os.path.join(work, "pseudo",
                           "Si.pz-n-rrkjus_psl.1.0.0.UPF")
        if os.path.exists(pseudo_src) and not os.path.exists(dst):
            shutil.copyfile(pseudo_src, dst)
    deck_path = os.path.join(work, "si.scf.in")
    with open(deck_path, "w") as fh:
        fh.write(DECK.replace("%ECUT%", repr(float(ecut_wfc))))
    with open(deck_path) as fh:
        proc = subprocess.run([pw], stdin=fh, cwd=work,
                              capture_output=True, text=True,
                              timeout=1800)
    out = proc.stdout + proc.stderr
    if "convergence has been achieved" not in out:
        fail(6, "pw.x did not report SCF convergence on the "
                "silicon deck")
    m = re.search(r"!\s+total energy\s+=\s+(-?\d+\.\d+)\s+Ry", out)
    if not m:
        fail(5, "pw.x output carried no total energy line "
                "(garbled output rejected)")
    energy = float(m.group(1))
    if not math.isfinite(energy):
        fail(5, "pw.x served a non-finite energy (rejected)")
    result = {"energyRy": energy, "converged": True}
    ref_raw = os.environ.get("CONKAY_QE_REF_RY")
    if ref_raw:
        reference = float(ref_raw)
        within = abs(energy - reference) / abs(reference) <= 0.005
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
    if op == "health":
        result = run_scf()
    elif op == "scf":
        ecut = request.get("ecutWfc", 20.0)
        if not isinstance(ecut, (int, float)) \
                or isinstance(ecut, bool) or ecut <= 0:
            fail(2, "ecutWfc must be a positive number, got %r"
                    % (ecut,))
        result = run_scf(float(ecut))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
