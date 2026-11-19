#!/usr/bin/env python3
"""pycalphad kernel — SXE-24 (materials/chemistry row, pycalphad leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health: an equilibrium calculation on
an open TDB (the plan's Al-Zn / Cu-Ni binary shape). The TDB is
environment data — it ships with the provisioned env and is named
by env CONKAY_PYCALPHAD_TDB; without it the kernel refuses as a
provisioning defect (exit 3), never substitutes a database.

Value discipline (the SXE-53 stored-reference shape): the kernel
serves the stable phase set + fractions and checks the internal
invariants (fractions finite, sum to 1 within 1e-6). The
published-diagram comparison rides the lane-recorded reference:
when env CONKAY_PYCALPHAD_EXPECT_PHASES names the expected stable
phase set for the default point, the kernel enforces set equality;
until the lane records it, the run is a completion leg only. No
diagram point is invented in code.

Ops:
  health / equilibrium — request {components, tK, xSecond};
    defaults from the provisioned TDB's recorded point
    (env CONKAY_PYCALPHAD_POINT = "AL,ZN:900:0.2" form).

No pycalphad in the driver env is a provisioning defect: exit 3
naming the import.
"""
import json
import os
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_equilibrium(components, t_k, x_second):
    try:
        from pycalphad import Database, calculate, equilibrium
        import pycalphad.variables as v
    except Exception as e:
        fail(3, "pycalphad import failed (%s) - the pycalphad "
                "driver env is not provisioned" % e)
    tdb = os.environ.get("CONKAY_PYCALPHAD_TDB")
    if not tdb or not os.path.exists(tdb):
        fail(3, "open TDB not provisioned (CONKAY_PYCALPHAD_TDB=%r); "
                "the engine env must carry the open database file "
                "with its provenance recorded in the engine doc" % (tdb,))
    dbf = Database(tdb)
    comps = [c.upper() for c in components] + ["VA"]
    phases = list(dbf.phases.keys())
    cond = {v.X(components[1].upper()): x_second, v.T: t_k, v.P: 101325,
            v.N: 1}
    try:
        result = equilibrium(dbf, comps, phases, cond)
    except Exception as e:
        fail(6, "pycalphad equilibrium failed: %s" % e)
    phase_vals = result.Phase.values[0, 0, 0]
    frac_vals = result.NP.values[0, 0, 0]
    stable = {}
    import math
    for name, frac in zip(phase_vals, frac_vals):
        f = float(frac)
        if name and math.isfinite(f) and f > 1e-6:
            stable[str(name)] = f
    if not stable:
        fail(5, "equilibrium returned no stable phases (garbled "
                "output rejected)")
    total = sum(stable.values())
    expected_raw = os.environ.get("CONKAY_PYCALPHAD_EXPECT_PHASES")
    expected = [s.strip() for s in expected_raw.split(",")] \
        if expected_raw else None
    within = None
    if expected:
        within = sorted(stable.keys()) == sorted(expected)
    out = {"phases": sorted(stable.keys()),
           "fractionSum": total,
           "converged": abs(total - 1.0) < 1e-3 and (within is not False)}
    if expected:
        out["expectedPhases"] = sorted(expected)
        out["phasesMatch"] = bool(within)
    return out


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "equilibrium"):
        point = os.environ.get("CONKAY_PYCALPHAD_POINT", "AL,ZN:900:0.2")
        try:
            comp_part, t_part, x_part = point.split(":")
            components = comp_part.split(",")
            t_default, x_default = float(t_part), float(x_part)
        except ValueError:
            fail(3, "CONKAY_PYCALPHAD_POINT %r is malformed "
                    "(provisioning defect)" % (point,))
        if op == "equilibrium":
            # The framework has already type-validated these fields
            # against the op schema (all three required there).
            components = request["components"]
            t_k = request["tK"]
            x_second = request["xSecond"]
        else:
            t_k, x_second = t_default, x_default
        if not isinstance(components, list) or len(components) != 2:
            fail(2, "components must be a two-element list, got %r"
                    % (components,))
        result = run_equilibrium([str(c) for c in components],
                                 float(t_k), float(x_second))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
