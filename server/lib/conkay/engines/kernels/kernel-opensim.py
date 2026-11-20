#!/usr/bin/env python3
"""OpenSim kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a single pendulum built
programmatically through the OpenSim API (one body, one pin
joint, gravity), integrated with the Manager for one measured
period. The period must match the small-angle closed form
2*pi*sqrt(L/g) within 5% (the release amplitude is 0.1 rad, so
the finite-amplitude correction is ~0.06%), and total mechanical
energy drift over the run must stay under 5%. The general op
takes the pendulum length by the same route.

Ops:
  health / pendulum — request {lengthM} (default 1.0)
    -> {periodS, expectedPeriodS, relError, energyDriftRel,
        converged}.

No opensim in the driver env is a provisioning defect: exit 3.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_pendulum(length_m):
    try:
        import opensim as osim
    except Exception as e:
        fail(3, "opensim import failed (%s) - the opensim driver "
                "env is not provisioned" % e)
    g = 9.80665
    model = osim.Model()
    model.setName("conkay_pendulum")
    model.setGravity(osim.Vec3(0, -g, 0))
    body = osim.Body("bob", 1.0, osim.Vec3(0, 0, 0),
                     osim.Inertia(0.001, 0.001, 0.001))
    model.addBody(body)
    joint = osim.PinJoint("pin", model.getGround(),
                          osim.Vec3(0, 0, 0), osim.Vec3(0, 0, 0),
                          body, osim.Vec3(0, length_m, 0),
                          osim.Vec3(0, 0, 0))
    model.addJoint(joint)
    state = model.initSystem()
    coord = model.updCoordinateSet().get(0)
    coord.setValue(state, 0.1)
    coord.setSpeedValue(state, 0.0)
    model.realizeAcceleration(state)
    e0 = model.calcKineticEnergy(state) + model.calcPotentialEnergy(state)
    expected_period = 2.0 * math.pi * math.sqrt(length_m / g)
    manager = osim.Manager(model)
    manager.setIntegratorAccuracy(1e-8)
    manager.initialize(state)
    samples = []
    t_prev = 0.0
    angle_prev = 0.1
    crossings = []
    steps = 2000
    for i in range(1, steps + 1):
        t = expected_period * 1.6 * i / steps
        state = manager.integrate(t)
        angle = coord.getValue(state)
        if angle_prev > 0 and angle <= 0:
            frac = angle_prev / (angle_prev - angle)
            crossings.append(t_prev + frac * (t - t_prev))
        angle_prev = angle
        t_prev = t
        samples.append(angle)
    model.realizeAcceleration(state)
    e1 = model.calcKineticEnergy(state) + model.calcPotentialEnergy(state)
    drift = abs(e1 - e0) / abs(e0) if e0 else 0.0
    if len(crossings) >= 2:
        period = crossings[1] - crossings[0]
    elif len(crossings) == 1:
        period = 2.0 * crossings[0]
    else:
        fail(5, "pendulum integration produced no zero crossing "
                "(garbled run rejected)")
    rel = abs(period - expected_period) / expected_period
    return {"periodS": period, "expectedPeriodS": expected_period,
            "relError": rel, "energyDriftRel": drift,
            "converged": rel <= 0.05 and drift <= 0.05}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "pendulum"):
        length_m = request.get("lengthM", 1.0)
        if not isinstance(length_m, (int, float)) \
                or isinstance(length_m, bool) or length_m <= 0:
            fail(2, "lengthM must be a positive number, got %r"
                    % (length_m,))
        result = run_pendulum(float(length_m))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
