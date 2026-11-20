#!/usr/bin/env python3
"""libRoadRunner kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a one-species decay SBML
model (A -> nothing, first-order rate k) integrated by
RoadRunner; the final concentration must match the closed form
x0 * exp(-k * t) computed independently in the kernel (band 1e-3
relative — the integrator's own tolerance is set tighter). The
general op takes the decay parameters by the same route.

Ops:
  health / decay — request {x0, k, tEnd} (defaults 10, 0.3, 5)
    -> {xFinal, expectedXFinal, relError, converged}.

No roadrunner in the driver env is a provisioning defect: exit 3.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


SBML = """<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version1/core" level="3" version="1">
  <model id="decay" name="first-order decay">
    <listOfCompartments>
      <compartment id="cell" size="1" constant="true"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="A" compartment="cell" initialAmount="%X0%"
               hasOnlySubstanceUnits="false" boundaryCondition="false"
               constant="false"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="k" value="%K%" constant="true"/>
    </listOfParameters>
    <listOfReactions>
      <reaction id="decay" reversible="false">
        <listOfReactants>
          <speciesReference species="A" stoichiometry="1" constant="true"/>
        </listOfReactants>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><times/><ci>k</ci><ci>A</ci></apply>
          </math>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>
"""


def run_decay(x0, k, t_end):
    try:
        import roadrunner as rr
    except Exception as e:
        fail(3, "roadrunner import failed (%s) - the roadrunner "
                "driver env is not provisioned" % e)
    sbml = SBML.replace("%X0%", repr(float(x0))).replace("%K%", repr(float(k)))
    model = rr.RoadRunner(sbml)
    model.integrator.absolute_tolerance = 1e-9
    model.integrator.relative_tolerance = 1e-9
    result = model.simulate(0.0, float(t_end), 2)
    # Columns are [time, A] for this one-species model.
    x_final = float(result[-1][1])
    expected = x0 * math.exp(-k * t_end)
    rel = abs(x_final - expected) / expected
    return {"xFinal": x_final, "expectedXFinal": expected,
            "relError": rel, "converged": rel <= 1e-3}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "decay"):
        x0 = request.get("x0", 10.0)
        k = request.get("k", 0.3)
        t_end = request.get("tEnd", 5.0)
        for name, val in (("x0", x0), ("k", k), ("tEnd", t_end)):
            if not isinstance(val, (int, float)) or isinstance(val, bool) \
                    or val <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, val))
        result = run_decay(float(x0), float(k), float(t_end))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
