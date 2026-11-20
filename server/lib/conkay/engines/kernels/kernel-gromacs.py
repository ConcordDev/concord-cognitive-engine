#!/usr/bin/env python3
"""GROMACS kernel - SXE-27.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. LGPL-2.1 code driven as a separate
process (nothing imported). Health case (the plan's): the
GROMACS lysozyme tutorial's energy minimisation converges. The
tutorial's post-pdb2gmx state (structure, topology, mdp) is a
provisioned case: the lane assembles it once into
CONKAY_GROMACS_CASE_DIR (case.gro, case.top, em.mdp) from the
official tutorial files; the kernel runs grompp + mdrun and
reads the minimisation outcome from the mdrun log - convergence
means mdrun completed AND the log reports the Fmax criterion
met (or, when the lane has recorded CONKAY_GROMACS_REF_EPOT
from a verified run, the final potential energy sits within
10% of it).

Ops:
  health - request {} (the provisioned case)
  minimize - request {caseDir} (overrides the env case dir)
    -> {potentialEnergy, converged}.

Absent case or binary is a provisioning defect: exit 3.
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


def run_minimize(case_dir):
    exe = shutil.which("gmx")
    if not exe:
        fail(3, "gmx executable not found on PATH - the gromacs "
                "driver env is not provisioned")
    if not case_dir or not os.path.isdir(case_dir):
        fail(3, "gromacs case dir not provisioned "
                "(CONKAY_GROMACS_CASE_DIR unset or missing)")
    for name in ("case.gro", "case.top", "em.mdp"):
        if not os.path.exists(os.path.join(case_dir, name)):
            fail(3, "gromacs case dir %s lacks %s" % (case_dir, name))
    with tempfile.TemporaryDirectory(prefix="conkay-gromacs-") as td:
        tpr = os.path.join(td, "em.tpr")
        gp = subprocess.run(
            [exe, "grompp", "-f", os.path.join(case_dir, "em.mdp"),
             "-c", os.path.join(case_dir, "case.gro"),
             "-p", os.path.join(case_dir, "case.top"),
             "-o", tpr, "-maxwarn", "1"],
            capture_output=True, text=True, timeout=300,
            cwd=case_dir)
        if gp.returncode != 0:
            fail(6, "gmx grompp failed (rc=%s): %s"
                    % (gp.returncode, (gp.stderr or "")[-300:]))
        md = subprocess.run(
            [exe, "mdrun", "-s", tpr, "-deffnm", os.path.join(td, "em"),
             "-ntomp", "2"],
            capture_output=True, text=True, timeout=900)
        log_path = os.path.join(td, "em.log")
        if md.returncode != 0 or not os.path.exists(log_path):
            fail(6, "gmx mdrun failed (rc=%s): %s"
                    % (md.returncode, (md.stderr or "")[-300:]))
        log = open(log_path).read()
    m = re.findall(r"Potential Energy\s*=\s*(-?[0-9.]+)", log)
    if not m:
        fail(6, "gromacs log carried no potential energy")
    epot = float(m[-1])
    # Steepest-descent EM stops either at the Fmax criterion (the
    # log's 'converged to Fmax' line) or by exhausting its step
    # budget; only the first is convergence.
    converged = "converged to Fmax" in log
    ref = os.environ.get("CONKAY_GROMACS_REF_EPOT")
    if ref is not None:
        converged = bool(converged
                         and abs(epot - float(ref)) <= 0.10 * abs(float(ref)))
    return {"potentialEnergy": epot, "converged": bool(converged)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "minimize"):
        case_dir = request.get("caseDir") or os.environ.get(
            "CONKAY_GROMACS_CASE_DIR")
        result = run_minimize(case_dir)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
