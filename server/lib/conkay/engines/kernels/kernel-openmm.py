#!/usr/bin/env python3
"""OpenMM kernel - SXE-27.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a single particle bound
by an isotropic harmonic potential, integrated with Verlet on
the CPU platform; the oscillation period is measured from x(t)
zero crossings and compared against the closed form
T = 2*pi*sqrt(m/k) computed in-kernel (band 2%).

Ops:
  health - request {} (the default spring)
  oscillator - request {springK} in kJ/(mol nm^2), [100, 5000]
    -> {periodPs, expectedPeriodPs, relError, converged}.

No openmm in the driver env is a provisioning defect: exit 3.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


MASS = 39.948  # argon, daltons


def run_oscillator(k_kj):
    try:
        import openmm
        from openmm import unit
    except Exception as e:
        fail(3, "openmm import failed (%s) - the openmm driver "
                "env is not provisioned" % e)
    system = openmm.System()
    system.addParticle(MASS)
    force = openmm.CustomExternalForce("0.5*k*(x*x+y*y+z*z)")
    force.addGlobalParameter("k", float(k_kj))
    force.addParticle(0, [])
    system.addForce(force)
    integ = openmm.VerletIntegrator(0.001)  # 0.001 ps timestep
    sim = openmm.app.Simulation(openmm.Topology(), system, integ,
                                openmm.Platform.getPlatformByName("CPU"))
    ctx = sim.context
    x0 = 0.1  # nm displacement
    ctx.setPositions([openmm.Vec3(x0, 0, 0)])
    ctx.setVelocitiesToTemperature(0)
    # Closed form: omega = sqrt(k/m); with k in kJ/(mol nm^2) and
    # m in daltons, k/m is in nm^2/ps^2 (OpenMM's unit identity),
    # so omega is in ps^-1.
    omega = math.sqrt(k_kj / MASS)
    expected = 2 * math.pi / omega
    steps_per_check = 10
    prev_x = x0
    crossings = []
    t = 0.0
    target = 3.5 * expected
    while t < target:
        integ.step(steps_per_check)
        t += steps_per_check * 0.001
        pos = ctx.getState(getPositions=True).getPositions(asNumpy=True)
        x = float(pos[0][0] / unit.nanometer)
        if prev_x > 0 and x <= 0:
            crossings.append(t)
        prev_x = x
    if len(crossings) < 2:
        fail(6, "openmm oscillator produced fewer than two zero "
                "crossings in %.1f ps" % target)
    period = (crossings[-1] - crossings[0]) / (len(crossings) - 1)
    rel = abs(period - expected) / expected
    return {"periodPs": period, "expectedPeriodPs": expected,
            "relError": rel, "converged": bool(rel <= 0.02)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "oscillator"):
        k = request.get("springK", 1000)
        if not isinstance(k, (int, float)) or not (100 <= k <= 5000):
            fail(2, "springK must be a number in [100, 5000], "
                    "got %r" % (k,))
        result = run_oscillator(float(k))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
