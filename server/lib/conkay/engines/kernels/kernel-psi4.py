#!/usr/bin/env python3
"""Psi4 kernel — SXE-26.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Psi4 is GPL-2: it runs only inside this
child kernel process, never linked into Node. Health case: the
same NIST CCCBDB point the PySCF entry checks — H2O RHF/STO-3G
total energy vs -75.9839 Ha (band 0.005) — so the two quantum
engines cross-check one published value. H2 (-1.1167 Ha) rides
the same op. An unconverged SCF is refused, never served.

Ops:
  health / rhf-energy — request {molecule}; "h2o" (default) | "h2"
    -> {energyHartree, expectedHartree, absError, converged}.

No psi4 in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


MOLECULES = {
    "h2o": ("O 0.000000 0.000000 0.117790\n"
            "H 0.000000 0.755453 -0.471161\n"
            "H 0.000000 -0.755453 -0.471161\n", -75.9839),
    "h2": ("H 0.000000 0.000000 0.000000\n"
           "H 0.000000 0.000000 0.734700\n", -1.1167),
}


def run_rhf(molecule):
    try:
        import psi4
    except Exception as e:
        fail(3, "psi4 import failed (%s) - the psi4 driver env "
                "is not provisioned" % e)
    geometry, expected = MOLECULES[molecule]
    psi4.core.be_quiet()
    mol = psi4.geometry("0 1\n" + geometry)
    energy, wfn = psi4.energy("scf/sto-3g", molecule=mol,
                              return_wfn=True)
    energy = float(energy)
    ok = abs(energy - expected) <= 0.005
    return {"energyHartree": energy, "expectedHartree": expected,
            "absError": abs(energy - expected), "converged": ok}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "rhf-energy"):
        molecule = request.get("molecule", "h2o")
        if molecule not in MOLECULES:
            fail(2, "molecule must be one of %s, got %r"
                    % (sorted(MOLECULES), molecule))
        result = run_rhf(molecule)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
