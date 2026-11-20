#!/usr/bin/env python3
"""PySCF kernel — SXE-26.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): H2O RHF/STO-3G
total energy vs the NIST CCCBDB published value for that level of
theory (-75.9839 Ha; band 0.005 Ha covers geometry-convention
variation at the CCCBDB reference geometry, which is embedded
below). The second molecule, H2 (-1.1167 Ha, CCCBDB), rides the
same op. The kernel refuses to serve an energy whose own SCF did
not converge.

Ops:
  health / rhf-energy — request {molecule}; "h2o" (default) | "h2"
    -> {energyHartree, expectedHartree, absError, converged}.

No pyscf in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


MOLECULES = {
    "h2o": ("O 0.000000 0.000000 0.117790; "
            "H 0.000000 0.755453 -0.471161; "
            "H 0.000000 -0.755453 -0.471161", -75.9839),
    "h2": ("H 0.000000 0.000000 0.000000; "
           "H 0.000000 0.000000 0.734700", -1.1167),
}


def run_rhf(molecule):
    try:
        from pyscf import gto, scf
    except Exception as e:
        fail(3, "pyscf import failed (%s) - the pyscf driver env "
                "is not provisioned" % e)
    atom, expected = MOLECULES[molecule]
    mol = gto.M(atom=atom, basis="sto-3g", verbose=0)
    mf = scf.RHF(mol).run()
    energy = float(mf.e_tot)
    ok = bool(mf.converged) and abs(energy - expected) <= 0.005
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
