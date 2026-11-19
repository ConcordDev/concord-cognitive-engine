#!/usr/bin/env python3
"""Project Chrono multibody kernel — SXE-14 (Chrono half).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Drives PyChrono across the process
boundary (BSD-3): a single pendulum released from a small angle,
integrated by Chrono's NSC system; the measured period (zero
crossings of the tip's horizontal offset) is served beside the
closed-form small-angle period with the first-order amplitude
correction T = 2*pi*sqrt(L/g) * (1 + theta0^2/16). The suite's
band is 2%.

Ops:
  health / pendulum — request {lengthM, gravity, angleRad};
    defaults L=1 m, g=9.81, theta0=0.2 rad.

No pychrono in the driver env is a provisioning defect: exit 3
naming the import. A period outside the band is served with
converged=false (the framework maps that to NOT_COMPUTED
engine_not_converged) — never silently "fixed".
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_pendulum(length_m, gravity, angle_rad):
    try:
        import pychrono as chrono
    except Exception as e:
        fail(3, "pychrono import failed (%s) — the chrono driver env "
                "is not provisioned" % e)
    system = chrono.ChSystemNSC()
    system.Set_G_acc(chrono.ChVector3d(0, -gravity, 0))
    ground = chrono.ChBody()
    ground.SetFixed(True)
    system.Add(ground)
    rod = chrono.ChBody()
    rod.SetMass(1.0)
    rod.SetInertiaXX(chrono.ChVector3d(0.01, 0.01, length_m * length_m / 3.0))
    # Rod hangs along -Y from the pivot at the origin; its centre of
    # mass sits at L/2. Release it rotated by angle_rad about Z.
    rot = chrono.ChQuaterniond()
    rot.SetFromAngleAxis(angle_rad, chrono.ChVector3d(0, 0, 1))
    com_local = chrono.ChVector3d(0, -length_m / 2.0, 0)
    rod.SetPos(rot.Rotate(com_local))
    rod.SetRot(rot)
    system.Add(rod)
    joint = chrono.ChLinkLockRevolute()
    joint.Initialize(rod, ground, chrono.ChFramed(chrono.ChVector3d(0, 0, 0),
                                                  chrono.ChQuaterniond(1, 0, 0, 0)))
    system.Add(joint)

    def tip_x():
        tip = rod.TransformPointLocalToParent(chrono.ChVector3d(0, -length_m, 0))
        return tip.x

    dt = 1e-3
    t, prev_x, crossings = 0.0, tip_x(), []
    t_max = 12.0 * 2.0 * math.pi * math.sqrt(length_m / gravity)
    while t < t_max and len(crossings) < 5:
        system.DoStepDynamics(dt)
        t += dt
        x = tip_x()
        if prev_x < 0 <= x or prev_x > 0 >= x:
            crossings.append(t)
        prev_x = x
    if len(crossings) < 4:
        fail(5, "pendulum integration produced %d zero crossings "
                "(expected >= 4); refusing to serve a period" % len(crossings))
    # Successive same-direction crossings are 2 crossings apart.
    periods = [crossings[i + 2] - crossings[i] for i in range(len(crossings) - 2)]
    period = sum(periods) / len(periods)
    expected = 2.0 * math.pi * math.sqrt(length_m / gravity) * (1.0 + angle_rad ** 2 / 16.0)
    rel = abs(period - expected) / expected
    return {"periodS": period, "expectedPeriodS": expected,
            "relError": rel, "converged": rel < 0.02}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "pendulum"):
        length_m = request.get("lengthM", 1.0)
        gravity = request.get("gravity", 9.81)
        angle_rad = request.get("angleRad", 0.2)
        for name, v in (("lengthM", length_m), ("gravity", gravity), ("angleRad", angle_rad)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_pendulum(float(length_m), float(gravity), float(angle_rad))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
