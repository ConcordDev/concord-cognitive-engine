#!/usr/bin/env python3
"""Pinocchio rigid-body dynamics kernel — SXE-14 (Pinocchio half).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Builds a one-joint pendulum (revolute
about Y, point mass at the rod tip) with Pinocchio (BSD-2) and runs
RNEA at rest: the joint torque must equal the closed form
m*g*L*sin(angle) in magnitude. The kernel checks the magnitude
itself (rel tol 1e-6) and refuses (exit 5) rather than serve a
torque its own closed form contradicts.

Ops:
  health / rnea — request {massKg, lengthM, angleRad};
    defaults m=1 kg, L=1 m, angle=pi/2 (max torque).

No pinocchio in the driver env is a provisioning defect: exit 3
naming the import.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_rnea(mass_kg, length_m, angle_rad):
    try:
        import pinocchio as pin
        import numpy as np
    except Exception as e:
        fail(3, "pinocchio import failed (%s) — the pinocchio driver "
                "env is not provisioned" % e)
    model = pin.Model()
    model.name = "pendulum"
    model.gravity = pin.Motion(np.array([0.0, 0.0, -9.81]), np.zeros(3))
    joint_id = model.addJoint(0, pin.JointModelRevoluteUnaligned(0.0, 1.0, 0.0),
                              pin.SE3.Identity(), "pendulum_joint")
    inertia = pin.Inertia.FromSphere(mass_kg, 0.0)
    # Point mass at distance L from the joint, along the joint's -Z.
    placement = pin.SE3(np.eye(3), np.array([0.0, 0.0, -length_m]))
    model.appendBodyToJoint(joint_id, inertia, placement)
    data = model.createData()
    q = np.array([angle_rad])
    tau = pin.rnea(model, data, q, np.zeros(1), np.zeros(1))
    got = float(tau[0])
    expected = mass_kg * 9.81 * length_m * math.sin(angle_rad)
    rel = abs(abs(got) - expected) / expected if expected else abs(got)
    if rel >= 1e-6:
        fail(5, "RNEA torque integrity check failed: |tau| %r vs closed "
                "form %r (rel %.3g)" % (got, expected, rel))
    return {"torque": got, "expectedTorqueAbs": expected,
            "relError": rel, "converged": True}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "rnea"):
        mass_kg = request.get("massKg", 1.0)
        length_m = request.get("lengthM", 1.0)
        angle_rad = request.get("angleRad", math.pi / 2.0)
        for name, v in (("massKg", mass_kg), ("lengthM", length_m)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        if not isinstance(angle_rad, (int, float)) or isinstance(angle_rad, bool):
            fail(2, "angleRad must be a number, got %r" % (angle_rad,))
        result = run_rnea(float(mass_kg), float(length_m), float(angle_rad))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
