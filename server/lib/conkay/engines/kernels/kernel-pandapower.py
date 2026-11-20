#!/usr/bin/env python3
"""pandapower kernel — SXE-19.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): the IEEE
14-bus power flow vs the published solution — pandapower's
built-in case14 network is run and every bus voltage magnitude is
compared against the standard published Vm profile embedded
below; the run passes when the largest deviation is within
0.005 pu (the published profile is rounded to 3 decimals, and
pandapower reproduces it to ~1e-3).

Ops:
  health — request {}
    -> {maxVmError, converged}.
  load-flow — request {scaleLoad} (default 1.0): every load is
    scaled, the flow re-run
    -> {maxVmPu, minVmPu, totalLossMW, converged}.

No pandapower in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


# Published IEEE 14-bus voltage magnitudes (pu), buses 1..14.
PUBLISHED_VM = [1.060, 1.045, 1.010, 1.019, 1.020, 1.070, 1.062,
                1.090, 1.056, 1.051, 1.057, 1.055, 1.050, 1.036]
BAND = 0.005


def load_net(pp, pn):
    return pn.case14()


def run_health():
    try:
        import pandapower as pp
        import pandapower.networks as pn
    except Exception as e:
        fail(3, "pandapower import failed (%s) - the pandapower "
                "driver env is not provisioned" % e)
    net = load_net(pp, pn)
    pp.runpp(net)
    vm = [float(v) for v in net.res_bus.vm_pu]
    if len(vm) != len(PUBLISHED_VM):
        fail(6, "case14 served %d buses, expected %d"
                % (len(vm), len(PUBLISHED_VM)))
    err = max(abs(a - b) for a, b in zip(vm, PUBLISHED_VM))
    return {"maxVmError": err, "converged": bool(err <= BAND)}


def run_scaled(scale):
    try:
        import pandapower as pp
        import pandapower.networks as pn
    except Exception as e:
        fail(3, "pandapower import failed (%s) - the pandapower "
                "driver env is not provisioned" % e)
    net = load_net(pp, pn)
    net.load.p_mw = net.load.p_mw * scale
    net.load.q_mvar = net.load.q_mvar * scale
    try:
        pp.runpp(net)
        ok = True
    except Exception:
        ok = False
    if not ok:
        return {"maxVmPu": 0.0, "minVmPu": 0.0, "totalLossMW": 0.0,
                "converged": False}
    vm = net.res_bus.vm_pu
    losses = float(net.res_line.pl_mw.sum()
                   + net.res_trafo.pl_mw.sum())
    return {"maxVmPu": float(vm.max()), "minVmPu": float(vm.min()),
            "totalLossMW": losses, "converged": True}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_health()
    elif op == "load-flow":
        scale = request.get("scaleLoad", 1.0)
        if not isinstance(scale, (int, float)) or not (0.1 <= scale <= 2.0):
            fail(2, "scaleLoad must be a number in [0.1, 2.0], "
                    "got %r" % (scale,))
        result = run_scaled(float(scale))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
