#!/usr/bin/env python3
"""Elmer FEM kernel — SXE-10.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver for Elmer's OWN
shipped test case (mgdyn_steady_coil — the plan's health case): it
copies the case from the provisioned Elmer test tree (env
CONKAY_ELMER_TESTS), runs `ElmerSolver` on it (GPL-2/LGPL,
separate process), and checks the run's own acceptance shape: the
solver completes and its saved data holds finite values.

Value-vs-reference (named substitution, recorded in the engine
doc): the shipped case's reference value is environment data, not
a kernel constant — the CI lane records it on its first verified
run into env CONKAY_ELMER_REFERENCE and, when that env is set,
this kernel compares the case's saved scalar against it (band
5%). Without a stored reference the run is a completion leg only;
the kernel never invents the number.

Ops:
  health / coil — request {caseName}; default "mgdyn_steady_coil".

Missing ElmerSolver or the test tree is a provisioning defect:
exit 3 naming it. A run with no parseable saved data is rejected
(exit 5), never guessed.
"""
import glob
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


def run_coil(case_name):
    solver = shutil.which("ElmerSolver")
    if not solver:
        fail(3, "ElmerSolver executable not found on PATH (Elmer is "
                "not provisioned for this engine env)")
    tests_dir = os.environ.get("CONKAY_ELMER_TESTS")
    case_dirs = []
    if tests_dir:
        case_dirs = [d for d in glob.glob(os.path.join(tests_dir, "**", case_name),
                                          recursive=True) if os.path.isdir(d)]
    if not case_dirs:
        fail(3, "Elmer shipped test case %r not found under "
                "CONKAY_ELMER_TESTS=%r - the Elmer test tree is not "
                "provisioned" % (case_name, tests_dir))
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "elmer-" + case_name)
    if os.path.exists(work):
        shutil.rmtree(work)
    shutil.copytree(case_dirs[0], work)
    sifs = sorted(glob.glob(os.path.join(work, "*.sif")))
    if not sifs:
        fail(3, "Elmer test case %r carries no .sif file (provisioning "
                "defect)" % case_name)
    proc = subprocess.run([solver, os.path.basename(sifs[0])], cwd=work,
                          capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        fail(6, "ElmerSolver failed on %s (exit %d)"
                % (case_name, proc.returncode))
    if re.search(r"\bERROR\b", proc.stdout + proc.stderr):
        fail(6, "ElmerSolver reported ERROR on %s" % case_name)
    dats = sorted(glob.glob(os.path.join(work, "**", "*.dat"), recursive=True))
    values = []
    for path in dats:
        with open(path, errors="replace") as fh:
            for tok in re.findall(r"-?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?",
                                  fh.read()):
                try:
                    v = float(tok)
                except ValueError:
                    continue
                if math.isfinite(v):
                    values.append(v)
    if not values:
        fail(5, "Elmer run produced no finite saved data (garbled "
                "output rejected)")
    scalar = values[-1]
    result = {"case": case_name, "scalar": scalar, "converged": True}
    ref_raw = os.environ.get("CONKAY_ELMER_REFERENCE")
    if ref_raw:
        reference = float(ref_raw)
        within = abs(scalar - reference) / abs(reference) <= 0.05
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
    if op in ("health", "coil"):
        case_name = request.get("caseName", "mgdyn_steady_coil")
        if not isinstance(case_name, str) or not case_name:
            fail(2, "caseName must be a non-empty string, got %r" % (case_name,))
        result = run_coil(case_name)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
