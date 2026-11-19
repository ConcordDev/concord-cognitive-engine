#!/usr/bin/env python3
"""PyBaMM battery kernel — SXE-25.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): an SPM 1C
discharge that completes, with the discharged capacity within the
parameter set's nominal. The kernel runs PyBaMM's lithium-ion SPM
with the Chen2020 parameter set (BSD-3), discharges at 1C until
2.5 V via an Experiment, and reads the nominal capacity FROM the
parameter values it solved with — the comparison is against the
parameter set's own nominal, never a hard-coded amp-hour figure
(band 8%: an SPM at 1C to 2.5 V does not deliver every nominal
amp-hour, and the band names that honestly).

Ops:
  health / discharge — request {cRate}; default 1C.

No pybamm in the driver env is a provisioning defect: exit 3
naming the import. A simulation that errors or terminates early
without a discharge capacity raises (exit 6 / 5) rather than
serving a partial number.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_discharge(c_rate):
    try:
        import pybamm
    except Exception as e:
        fail(3, "pybamm import failed (%s) - the pybamm driver env "
                "is not provisioned" % e)
    model = pybamm.lithium_ion.SPM()
    pv = pybamm.ParameterValues("Chen2020")
    try:
        nominal = float(pv["Nominal cell capacity [A.h]"])
    except Exception as e:
        fail(5, "Chen2020 parameter set carries no nominal capacity "
                "(%s); refusing to compare against a guessed figure" % e)
    experiment = pybamm.Experiment(
        ["Discharge at %gC until 2.5 V" % c_rate])
    sim = pybamm.Simulation(model, parameter_values=pv,
                            experiment=experiment)
    try:
        sol = sim.solve()
    except Exception as e:
        fail(6, "PyBaMM SPM discharge failed: %s" % e)
    try:
        cap = float(sol["Discharge capacity [A.h]"].data[-1])
    except Exception as e:
        fail(5, "PyBaMM solution carried no discharge capacity (%s); "
                "garbled output rejected" % e)
    rel = abs(cap - nominal) / nominal
    return {"capacityAh": cap, "nominalAh": nominal, "relDeviation": rel,
            "converged": rel <= 0.08}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "discharge"):
        c_rate = request.get("cRate", 1.0)
        if not isinstance(c_rate, (int, float)) or isinstance(c_rate, bool) \
                or c_rate <= 0:
            fail(2, "cRate must be a positive number, got %r" % (c_rate,))
        result = run_discharge(float(c_rate))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
