#!/usr/bin/env python3
"""PyPSA kernel — SXE-19.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a one-bus, two-generator
dispatch whose optimum is a closed form — the cheap generator
(10/MWh, capped at 40 MW) saturates first, the dearer one
(20/MWh) takes the remainder. At the default 70 MW load the
optimum is exactly 40 + 30 MW at an objective of exactly
40*10 + 30*20 = 1000. The kernel computes the closed form itself
for any requested load and refuses to serve a solver result that
disagrees with it (band 1e-6 relative on the objective).

Ops:
  health — request {} (the 70 MW case)
  dispatch — request {loadMW} in [0, 90]
    -> {genCheapMW, genDearMW, objective, expectedObjective,
        relError, converged}.

No pypsa in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


CHEAP_CAP, CHEAP_COST, DEAR_COST = 40.0, 10.0, 20.0


def closed_form(load):
    cheap = min(CHEAP_CAP, load)
    dear = load - cheap
    return cheap, dear, cheap * CHEAP_COST + dear * DEAR_COST


def run_dispatch(load):
    try:
        import pypsa
    except Exception as e:
        fail(3, "pypsa import failed (%s) - the pypsa driver env "
                "is not provisioned" % e)
    n = pypsa.Network()
    n.add("Bus", "bus")
    n.add("Generator", "cheap", bus="bus", p_nom=CHEAP_CAP,
          marginal_cost=CHEAP_COST)
    n.add("Generator", "dear", bus="bus", p_nom=100.0,
          marginal_cost=DEAR_COST)
    n.add("Load", "load", bus="bus", p_set=load)
    status = n.optimize(solver_name="highs")
    if str(status[0]) not in ("ok", "optimal"):
        fail(6, "pypsa optimisation did not reach an optimum: %r"
                % (status,))
    gen = n.generators_t.p.iloc[0]
    cheap = float(gen["cheap"])
    dear = float(gen["dear"])
    objective = float(n.objective)
    e_cheap, e_dear, e_obj = closed_form(load)
    rel = abs(objective - e_obj) / e_obj if e_obj else abs(objective)
    ok = (rel <= 1e-6 and abs(cheap - e_cheap) <= 1e-6
          and abs(dear - e_dear) <= 1e-6)
    return {"genCheapMW": cheap, "genDearMW": dear,
            "objective": objective, "expectedObjective": e_obj,
            "relError": rel, "converged": ok}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "dispatch"):
        load = request.get("loadMW", 70)
        if not isinstance(load, (int, float)) or not (0 <= load <= 90):
            fail(2, "loadMW must be a number in [0, 90], got %r"
                    % (load,))
        result = run_dispatch(float(load))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
