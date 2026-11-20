#!/usr/bin/env python3
"""COBRApy kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (two-tier, the pycalphad
shape):

- DEFAULT: a toy core network built in the kernel — glucose
  uptake (bounded at 10) feeding biomass at a fixed 0.5 yield with
  a maintenance drain of 1 — whose FBA optimum is the closed form
  0.5 * 10 - 1 = 4.0 exactly (band 1e-6). No external model file
  is needed, so the health leg is deterministic offline.
- If the lane provisions a real model (CONKAY_COBRA_MODEL, e.g.
  e_coli_core JSON) AND its published growth reference
  (CONKAY_COBRA_REF_GROWTH, 0.873922 for e_coli_core under the
  COBRApy documentation's default bounds), the health op runs
  that model instead and enforces a 1% band against the stored
  reference. The kernel never invents the published number.

Ops:
  health — request {}
    -> {growthRate, expectedGrowthRate, relError, converged}
       (toy model, or the provisioned model when the env pair
       is set).
  fba — request {model}: "toy" (default) | "provisioned"
    -> same result shape. "provisioned" without the env pair
       is a provisioning defect: exit 3.

No cobra in the driver env is a provisioning defect: exit 3.
"""
import json
import os
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def build_toy(cobra):
    model = cobra.Model("conkay_toy_core")
    glc = cobra.Metabolite("glc", compartment="c")
    bio = cobra.Metabolite("bio", compartment="c")
    uptake = cobra.Reaction("UPTAKE")
    uptake.lower_bound = 0.0
    uptake.upper_bound = 10.0
    uptake.add_metabolites({glc: 1.0})
    growth = cobra.Reaction("GROWTH")
    growth.lower_bound = 0.0
    growth.upper_bound = 1000.0
    growth.add_metabolites({glc: -2.0, bio: 1.0})
    drain = cobra.Reaction("MAINT")
    drain.lower_bound = 1.0
    drain.upper_bound = 1.0
    drain.add_metabolites({glc: -1.0})
    model.add_reactions([uptake, growth, drain])
    model.objective = "GROWTH"
    return model


def run_fba(choice=None):
    try:
        import cobra
    except Exception as e:
        fail(3, "cobra import failed (%s) - the cobrapy driver "
                "env is not provisioned" % e)
    model_path = os.environ.get("CONKAY_COBRA_MODEL")
    ref_raw = os.environ.get("CONKAY_COBRA_REF_GROWTH")
    if choice is None:
        choice = "provisioned" if (model_path and ref_raw) else "toy"
    if choice == "provisioned":
        if not (model_path and ref_raw):
            fail(3, "the provisioned-model leg needs "
                    "CONKAY_COBRA_MODEL + CONKAY_COBRA_REF_GROWTH "
                    "(neither is set for this engine env)")
        model = cobra.io.load_json_model(model_path)
        expected = float(ref_raw)
        band = 0.01
    else:
        model = build_toy(cobra)
        expected = 4.0
        band = 1e-6
    solution = model.optimize()
    if solution.status != "optimal":
        fail(6, "FBA did not reach an optimum (status %s)"
                % solution.status)
    growth = float(solution.objective_value)
    rel = abs(growth - expected) / expected
    return {"growthRate": growth, "expectedGrowthRate": expected,
            "relError": rel, "converged": rel <= band}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_fba()
    elif op == "fba":
        choice = request.get("model", "toy")
        if choice not in ("toy", "provisioned"):
            fail(2, "model must be \"toy\" or \"provisioned\", "
                    "got %r" % (choice,))
        result = run_fba(choice)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
