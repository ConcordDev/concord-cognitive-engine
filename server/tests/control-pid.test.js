// Engine N5 — control theory (PID feedback). Pins the pure step (P/I/D terms +
// anti-windup), the stateful controller, and convergence to a setpoint (the
// "does this actuated loop hold its target" stability check).
//
// Run: node --test tests/control-pid.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pidStep, createPIDController, simulateToSetpoint } from "../lib/control/pid.js";

describe("pidStep", () => {
  it("pure-P: output = kp·error", () => {
    const r = pidStep({ kp: 2, ki: 0, kd: 0 }, 10, 4, {}, 1);
    assert.equal(r.error, 6);
    assert.equal(r.output, 12); // 2 × 6
  });

  it("integral accumulates and clamps (anti-windup)", () => {
    let s = { integral: 0, prevError: 0 };
    for (let i = 0; i < 100; i++) s = pidStep({ kp: 0, ki: 1, kd: 0 }, 10, 0, s, 1, { iMax: 5 });
    assert.equal(s.integral, 5); // clamped, not 1000
  });

  it("derivative responds to the rate of error change", () => {
    const r = pidStep({ kp: 0, ki: 0, kd: 1 }, 10, 0, { integral: 0, prevError: 6 }, 1);
    // error now 10, prev 6 → derivative 4 → output 4
    assert.equal(r.output, 4);
  });
});

describe("stateful controller + convergence", () => {
  it("a stateful controller carries integral/prevError across updates", () => {
    const c = createPIDController({ kp: 1, ki: 0.5, kd: 0 }, 10);
    const u1 = c.update(0, 1);
    const u2 = c.update(0, 1);
    assert.ok(u2 > u1); // integral builds → output grows while error persists
  });

  it("a tuned PID settles a first-order plant at the setpoint", () => {
    const r = simulateToSetpoint({ kp: 0.8, ki: 0.2, kd: 0.05 }, 10, { steps: 300, dt: 0.1, x0: 0, tol: 0.1 });
    assert.equal(r.settled, true);
    assert.ok(Math.abs(r.finalValue - 10) < 0.1);
  });

  it("error monotonically shrinks under a stable P controller", () => {
    const r = simulateToSetpoint({ kp: 0.3, ki: 0, kd: 0 }, 5, { steps: 50, dt: 0.1, x0: 0 });
    assert.ok(Math.abs(5 - r.trajectory[10]) > Math.abs(5 - r.trajectory[40])); // converging
  });
});
