#!/usr/bin/env python3
"""OpenDSS kernel (via OpenDSSDirect / dss-python) — SXE-19.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a two-bus single-phase
feeder (7.2 kV source, one R+jX line, one constant-PQ load) whose
load-bus voltage has an independent solution the kernel computes
itself by fixed-point iteration of V = V1 - Z * conj(S / V) — a
different method from OpenDSS's own solver, so agreement (band
0.5% on |V|) is a genuine cross-check, not a self-comparison.

Ops:
  health — request {} (the 400 kW case)
  power-flow — request {loadKw} in [50, 900]
    -> {voltageKv, expectedVoltageKv, relError, converged}.

Circuit (per-phase equivalent): V1 = 7200 V; line R = 1.2 ohm,
X = 1.9 ohm; load pf 0.95 lagging.

No dss module in the driver env is a provisioning defect: exit 3.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


V1 = 7200.0
R_OHM, X_OHM = 1.2, 1.9
PF = 0.95


def expected_voltage(load_kw):
    p = load_kw * 1000.0
    q = p * math.tan(math.acos(PF))
    s = complex(p, q)
    z = complex(R_OHM, X_OHM)
    v = complex(V1, 0.0)
    for _ in range(200):
        nxt = V1 - z * (s / v).conjugate()
        if abs(nxt - v) < 1e-9:
            v = nxt
            break
        v = nxt
    return abs(v) / 1000.0


def run_flow(load_kw):
    try:
        import opendssdirect as DSS
    except Exception as e:
        fail(3, "opendssdirect import failed (%s) - the "
                "opendss driver env is not provisioned" % e)
    q_kvar = load_kw * math.tan(math.acos(PF))
    cmds = [
        "Clear",
        "New Circuit.kernel2bus basekv=7.2 pu=1.0 phases=1",
        "New Line.feeder bus1=sourcebus bus2=loadbus phases=1 "
        "r1=%.4f x1=%.4f length=1 units=km" % (R_OHM, X_OHM),
        "New Load.load bus1=loadbus phases=1 kv=7.2 kw=%.3f "
        "kvar=%.3f model=1" % (load_kw, q_kvar),
        "Set voltagebases=[7.2]",
        "CalcVoltageBases",
        "Solve",
    ]
    for c in cmds:
        DSS.Text.Command(c)
    if not DSS.Solution.Converged():
        return {"voltageKv": 0.0,
                "expectedVoltageKv": expected_voltage(load_kw),
                "relError": 1.0, "converged": False}
    DSS.Circuit.SetActiveBus("loadbus")
    vmag = DSS.Bus.VMagAngle()[0] / 1000.0
    exp = expected_voltage(load_kw)
    rel = abs(vmag - exp) / exp
    return {"voltageKv": vmag, "expectedVoltageKv": exp,
            "relError": rel, "converged": bool(rel <= 0.005)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "power-flow"):
        load = request.get("loadKw", 400)
        if not isinstance(load, (int, float)) or not (50 <= load <= 900):
            fail(2, "loadKw must be a number in [50, 900], got %r"
                    % (load,))
        result = run_flow(float(load))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
