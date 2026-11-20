#!/usr/bin/env python3
"""RDKit kernel — SXE-26.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: ethanol (CCO) — RDKit's
average molecular weight vs the value computed independently in
the kernel from the formula C2H6O and standard atomic weights
(2*12.011 + 6*1.008 + 15.999 = 46.069; band 0.01). The general op
serves descriptors for any SMILES the kernel can parse; an
unparseable SMILES is a schema refusal (exit 2), never a guess.

Ops:
  health — request {}
    -> {molWt, expectedMolWt, absError, converged}.
  descriptors — request {smiles}
    -> {molWt, formula}.

No rdkit in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def load_rdkit():
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, rdMolDescriptors
    except Exception as e:
        fail(3, "rdkit import failed (%s) - the rdkit driver env "
                "is not provisioned" % e)
    return Chem, Descriptors, rdMolDescriptors


def run_health():
    Chem, Descriptors, _ = load_rdkit()
    mol = Chem.MolFromSmiles("CCO")
    if mol is None:
        fail(5, "RDKit refused its own health SMILES (garbled "
                "install rejected)")
    wt = float(Descriptors.MolWt(mol))
    expected = 2 * 12.011 + 6 * 1.008 + 15.999
    return {"molWt": wt, "expectedMolWt": expected,
            "absError": abs(wt - expected),
            "converged": abs(wt - expected) <= 0.01}


def run_descriptors(smiles):
    Chem, Descriptors, rdMolDescriptors = load_rdkit()
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        fail(2, "smiles %r is not parseable by RDKit" % (smiles,))
    return {"molWt": float(Descriptors.MolWt(mol)),
            "formula": rdMolDescriptors.CalcMolFormula(mol)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_health()
    elif op == "descriptors":
        smiles = request.get("smiles")
        if not isinstance(smiles, str) or not smiles:
            fail(2, "smiles must be a non-empty string, got %r" % (smiles,))
        result = run_descriptors(smiles)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
