# server/lib/conkay/chem/cantera_kernel.py
#
# The Cantera chemistry kernel: one JSON request on stdin, one JSON result on
# stdout (the cad/*.py protocol; run through cad/kernel-queue.js runPythonKernel,
# so it is a child process and never blocks the event loop).
#
# Ops:
#   "equilibrium"  adiabatic constant-pressure (HP) chemical equilibrium of a
#                  fuel/oxidizer mixture -> adiabatic flame temperature, final
#                  pressure, the major products (top 8 mole fractions > 1e-4).
#   "ignition"     0-D homogeneous ignition at constant pressure
#                  (IdealGasConstPressureReactor + ReactorNet) -> ignition delay
#                  at max dT/dt, the T0+400 K criterion beside it, final T.
#   "flame_speed"  1-D unstretched premixed laminar flame (FreeFlame),
#                  mixture-averaged transport, coarse refine criteria
#                  (ratio 3, slope 0.07, curve 0.14) -> S_L, grid points.
#
# Mechanisms: the two Cantera data files this solver is validated against
# (gri30.yaml for natural gas / CH4, h2o2.yaml for H2); both ship with Cantera.
# A fuel species absent from the mechanism is an error, never a guess.
#
# Every result carries: cantera version, mechanism, an echo of the inputs and a
# warnings array. Errors come back as { "ok": false, "error": "..." } — never a
# traceback only (the cantera import itself is guarded so a Python without
# cantera reports "cantera import failed: ..." as JSON).
#
# Validation: tests/conkay-reacting-chemistry.test.js against Turns (adiabatic
# flame temperatures), Kwon & Faeth 2001 / Burke et al. 2012 (H2/air flame speed).

import json
import sys

try:
    import cantera as ct
except Exception as _e:  # noqa: BLE001 - reported to the caller as JSON, not a traceback
    ct = None
    _IMPORT_ERROR = f"cantera import failed: {type(_e).__name__}: {_e}"
else:
    _IMPORT_ERROR = None

SCRIPT_VERSION = "1.0.0"
MECHANISMS = ("gri30.yaml", "h2o2.yaml")
DEFAULT_OXIDIZER = "O2:1, N2:3.76"
MAX_IGNITION_STEPS = 20000
# Coarse refine criteria: a screening solve (fast, a few % of the converged grid).
FLAME_REFINE = {"ratio": 3.0, "slope": 0.07, "curve": 0.14}


def _require_positive(req, key, unit):
    v = req.get(key)
    if not isinstance(v, (int, float)) or not v > 0:
        raise ValueError(f"{key} ({unit}) must be a positive number, got {v!r}")
    return float(v)


def _mechanism(req):
    m = req.get("mechanism")
    if m not in MECHANISMS:
        raise ValueError(f"mechanism {m!r} is not one of {', '.join(MECHANISMS)} (the two Cantera data files validated here)")
    return m


def mixture(req):
    """A Solution at (T0, P0) with the fuel/oxidizer set at phi. Returns (gas, inputs echo)."""
    mechanism = _mechanism(req)
    fuel = req.get("fuel")
    if not isinstance(fuel, str) or not fuel.strip():
        raise ValueError('fuel must be a species name or composition string (e.g. "CH4")')
    oxidizer = req.get("oxidizer") or DEFAULT_OXIDIZER
    phi = _require_positive(req, "phi", "equivalence ratio")
    T0 = _require_positive(req, "T0", "K")
    P0 = _require_positive(req, "P0", "Pa")
    gas = ct.Solution(mechanism)
    gas.TP = T0, P0
    gas.set_equivalence_ratio(phi, fuel, oxidizer)
    inputs = {
        "mechanism": mechanism, "fuel": fuel.strip(), "oxidizer": oxidizer,
        "phi": phi, "T0": T0, "P0": P0,
    }
    return gas, inputs


def _base(op, req, inputs, warnings):
    return {
        "ok": True, "op": op, "kernel": SCRIPT_VERSION,
        "cantera": ct.__version__, "mechanism": inputs["mechanism"],
        "inputs": inputs, "warnings": warnings,
    }


def op_equilibrium(req):
    mode = req.get("mode", "HP")
    if mode != "HP":
        raise ValueError(f'mode {mode!r} is not supported (only "HP": adiabatic, constant pressure)')
    gas, inputs = mixture(req)
    warnings = []
    gas.equilibrate(mode)
    T_ad, P = float(gas.T), float(gas.P)
    if T_ad <= inputs["T0"] + 1.0:
        warnings.append(f"equilibrium temperature {T_ad:.1f} K did not rise above the initial temperature: no exothermic reaction for these inputs")
    products = sorted(zip(gas.species_names, gas.X), key=lambda kv: -kv[1])
    major = [{"species": s, "X": round(float(x), 6)} for s, x in products if x > 1e-4][:8]
    out = _base("equilibrium", req, inputs, warnings)
    out.update({"T_ad": round(T_ad, 2), "P": round(P, 1), "mode": mode, "products": major})
    return out


def op_ignition(req):
    gas, inputs = mixture(req)
    t_end = float(req.get("tEnd", 0.05))
    if not 0 < t_end <= 10.0:
        raise ValueError(f"tEnd ({t_end} s) must be positive and short (<= 10 s)")
    reactor = ct.IdealGasConstPressureReactor(gas)
    net = ct.ReactorNet([reactor])
    times, temps = [], []
    t = 0.0
    steps = 0
    while t < t_end and steps < MAX_IGNITION_STEPS:
        t = net.step()
        times.append(t)
        temps.append(float(reactor.T))
        steps += 1
    if steps >= MAX_IGNITION_STEPS and t < t_end:
        raise RuntimeError(f"integration reached the {MAX_IGNITION_STEPS}-step cap at t={t:.6g} s before tEnd={t_end} s (reduce tEnd)")
    if len(temps) < 3:
        raise RuntimeError(f"integration produced {len(temps)} steps before tEnd={t_end} s")
    warnings = []
    rise = temps[-1] - temps[0]
    if rise < 100.0:
        raise RuntimeError(f"no ignition within tEnd={t_end} s (final temperature rise {rise:.1f} K)")
    # dT/dt by centered differences (one-sided at the ends)
    rates = [(temps[1] - temps[0]) / (times[1] - times[0])] if len(times) > 1 else []
    for i in range(1, len(times) - 1):
        rates.append((temps[i + 1] - temps[i - 1]) / (times[i + 1] - times[i - 1]))
    if len(times) > 1:
        rates.append((temps[-1] - temps[-2]) / (times[-1] - times[-2]))
    i_max = max(range(len(rates)), key=lambda i: rates[i])
    if i_max == len(rates) - 1:
        warnings.append("dT/dt is largest at the last step: ignition had not finished within tEnd, the delay is an upper bound only")
    tau_t400 = next((times[i] for i, T in enumerate(temps) if T >= temps[0] + 400.0), None)
    inputs = {**inputs, "tEnd": t_end}
    out = _base("ignition", req, inputs, warnings)
    out.update({
        "ignitionDelay": times[i_max],
        "ignitionDelayT400": tau_t400,
        "maxdTdt": rates[i_max],
        "TFinal": round(temps[-1], 1),
        "steps": steps,
        "reachedTEnd": t >= t_end,
    })
    return out


def op_flame_speed(req):
    gas, inputs = mixture(req)
    width = float(req.get("width", 0.03))
    if not 0.001 <= width <= 1.0:
        raise ValueError(f"width ({width} m) must be between 0.001 m and 1 m")
    flame = ct.FreeFlame(gas, width=width)
    flame.transport_model = "mixture-averaged"
    flame.set_refine_criteria(**FLAME_REFINE)
    flame.solve(loglevel=0)
    warnings = [
        "coarse refine criteria (ratio 3, slope 0.07, curve 0.14): a screening solve; the converged-grid flame speed can differ by a few percent",
    ]
    inputs = {**inputs, "width": width}
    out = _base("flame_speed", req, inputs, warnings)
    out.update({
        "S_L": round(float(flame.velocity[0]), 5),
        "gridPoints": len(flame.grid),
        "T_max": round(float(flame.T[-1]), 1),
    })
    return out


OPS = {"equilibrium": op_equilibrium, "ignition": op_ignition, "flame_speed": op_flame_speed}


def main():
    if ct is None:
        print(json.dumps({"ok": False, "error": _IMPORT_ERROR, "cantera": None}))
        return
    req = json.loads(sys.stdin.read())
    op = req.get("op") if isinstance(req, dict) else None
    if op not in OPS:
        print(json.dumps({"ok": False, "error": f"unknown op {op!r}: expected one of {', '.join(OPS)}"}))
        return
    print(json.dumps(OPS[op](req)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - reported to the caller as a failed kernel run
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))