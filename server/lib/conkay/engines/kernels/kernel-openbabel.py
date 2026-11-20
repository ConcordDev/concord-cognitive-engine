#!/usr/bin/env python3
"""Open Babel kernel — SXE-26.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock obabel CLI
(GPL-2, separate process). Health case: ethanol (CCO) — obabel's
report must name formula C2H6O and a mass matching the value
computed independently in the kernel from standard atomic weights
(46.069; band 0.01). The general op converts any SMILES to its
formula + mass by the same route.

Ops:
  health — request {}
    -> {formula, mass, expectedMass, absError, converged}.
  convert — request {smiles}
    -> {formula, mass}.

Missing obabel is a provisioning defect: exit 3. Output with no
parseable FORMULA/MASS is rejected (exit 5), never guessed.
"""
import json
import re
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


WEIGHTS = {"H": 1.008, "C": 12.011, "N": 14.007, "O": 15.999,
           "S": 32.06, "P": 30.974, "F": 18.998, "Cl": 35.45,
           "Br": 79.904}


def expected_mass(formula):
    total = 0.0
    for elem, count in re.findall(r"([A-Z][a-z]?)(\d*)", formula):
        if not elem:
            continue
        if elem not in WEIGHTS:
            return None
        total += WEIGHTS[elem] * (int(count) if count else 1)
    return total


def run_convert(smiles):
    obabel = shutil.which("obabel")
    if not obabel:
        fail(3, "obabel executable not found on PATH (Open Babel "
                "is not provisioned for this engine env)")
    proc = subprocess.run([obabel, "-:" + smiles, "-oreport"],
                          capture_output=True, text=True, timeout=300)
    out = proc.stdout + proc.stderr
    if proc.returncode != 0:
        fail(6, "obabel failed on %r (exit %d)" % (smiles, proc.returncode))
    mf = re.search(r"FORMULA:\s*(\S+)", out)
    mm = re.search(r"MASS:\s*(\d+\.\d+)", out)
    if not mf or not mm:
        fail(5, "obabel report carried no FORMULA/MASS (garbled "
                "output rejected)")
    return mf.group(1), float(mm.group(1))


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        formula, mass = run_convert("CCO")
        expected = expected_mass(formula)
        ok = formula == "C2H6O" and expected is not None \
            and abs(mass - expected) <= 0.01
        result = {"formula": formula, "mass": mass,
                  "expectedMass": expected if expected is not None else -1.0,
                  "absError": abs(mass - expected) if expected is not None else -1.0,
                  "converged": ok}
    elif op == "convert":
        smiles = request.get("smiles")
        if not isinstance(smiles, str) or not smiles:
            fail(2, "smiles must be a non-empty string, got %r" % (smiles,))
        formula, mass = run_convert(smiles)
        result = {"formula": formula, "mass": mass}
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
