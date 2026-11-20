#!/usr/bin/env python3
"""climlab kernel — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: climlab's energy-balance
model stepped to equilibrium. The pass conditions are the model's
own physics invariants, checked in the kernel: at equilibrium the
state must stop moving (max |dTs| over one further step < 0.01 K —
the energy budget is closed, since the EBM's only dynamics are
the budget) and the global-mean surface temperature must sit in
the physical band for an Earth-like EBM (270-300 K). No stored
temperature is asserted — an EBM's equilibrium value depends on
its parameterisation, and this kernel invents none. The general
op scales the solar constant by the same route.

Ops:
  health / ebm — request {solarFactor} (default 1.0)
    -> {globalMeanTsK, maxTendencyK, converged}.

No climlab in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_ebm(solar_factor):
    try:
        import numpy as np
        import climlab
    except Exception as e:
        fail(3, "climlab import failed (%s) - the climlab driver "
                "env is not provisioned" % e)
    model = climlab.EBM()
    if solar_factor != 1.0:
        model.param["S0"] = model.param["S0"] * float(solar_factor)
    for _ in range(1500):
        model.step_forward()
    before = np.array(model.state.Ts, dtype=float)
    model.step_forward()
    after = np.array(model.state.Ts, dtype=float)
    tendency = float(np.max(np.abs(after - before)))
    ts = float(np.mean(after))
    ok = tendency < 0.01 and 270.0 <= ts <= 300.0
    return {"globalMeanTsK": ts, "maxTendencyK": tendency,
            "converged": ok}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "ebm"):
        factor = request.get("solarFactor", 1.0)
        if not isinstance(factor, (int, float)) \
                or isinstance(factor, bool) or factor <= 0:
            fail(2, "solarFactor must be a positive number, got "
                    "%r" % (factor,))
        result = run_ebm(float(factor))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
