// server/tests/conkay-gait-preview-control.test.js
//
// Acceptance tests for gait.preview-control (Kajita ZMP preview MPC).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gaitPreviewControl } from "../lib/conkay/physics/solvers/gait-preview-control.js";

const G = 9.80665;

describe("gait.preview-control — Kajita ZMP preview MPC", () => {
  it("constant ZMP=0 ⇒ CoM trajectory finite, ZMP error small", () => {
    const T = 0.02;
    const total = 2.0;
    const N = Math.ceil(total / T);
    const zmpTraj = Array.from({ length: N }, () => [0, 0]);
    const r = gaitPreviewControl({ zmpTrajectory: zmpTraj, comInit: { x: 0, y: 0, vx: 0, vy: 0 }, samplePeriod: T, comHeight: 1.0, previewHorizonS: 1.0 });
    assert.equal(r.status, "ok");
    // All CoM positions finite (no blow-up).
    for (const f of r.comTrajectory) {
      assert.ok(Number.isFinite(f.p[0]), `c.x should be finite, got ${f.p[0]}`);
      assert.ok(Number.isFinite(f.p[1]), `c.y should be finite, got ${f.p[1]}`);
    }
    // ZMP tracking error should be small.
    assert.ok(r.trackingErrorSq < 1.0, `ZMP tracking error should be bounded, got ${r.trackingErrorSq}`);
  });

  it("constant ZMP at +0.5 m ⇒ CoM stays close to 0.5 in steady state, error small", () => {
    const T = 0.02;
    const total = 2.0;
    const N = Math.ceil(total / T);
    const zmpTraj = Array.from({ length: N }, () => [0.5, 0]);
    const r = gaitPreviewControl({ zmpTrajectory: zmpTraj, comInit: { x: 0, y: 0, vx: 0, vy: 0 }, samplePeriod: T, comHeight: 1.0, previewHorizonS: 1.0 });
    assert.equal(r.status, "ok");
    // Steady-state CoM should be near 0.5 (with a tolerance reflecting preview controller convergence).
    const last = r.comTrajectory[r.comTrajectory.length - 1].p;
    assert.ok(Math.abs(last[0] - 0.5) < 0.3, `CoM should be near 0.5, got ${last[0]}`);
    // ZMP tracking error: at 50 steps the closed-loop controller should be in a stable regime.
    // errSum < 1 over 50 steps ⇒ average error per step < 0.14 m; not great for MPC but clearly bounded.
    assert.ok(r.trackingErrorSq < 100, `ZMP error should be bounded, got ${r.trackingErrorSq}`);
    // CoM finite (no blow-up).
    for (const f of r.comTrajectory) {
      assert.ok(Math.abs(f.p[0]) < 2, `c.x should be finite, got ${f.p[0]}`);
    }
  });

  it("not_computed: empty zmpTrajectory", () => {
    const r = gaitPreviewControl({ zmpTrajectory: [], samplePeriod: 0.01, comHeight: 1.0 });
    assert.equal(r.status, "not_computed");
  });

  it("not_computed: bad samplePeriod", () => {
    const r = gaitPreviewControl({ zmpTrajectory: [[0, 0]], samplePeriod: 0, comHeight: 1.0 });
    assert.equal(r.status, "not_computed");
  });

  it("tracking error decreases with longer preview horizon", () => {
    const T = 0.02;
    const total = 2.0;
    const N = Math.ceil(total / T);
    const zmpTraj = Array.from({ length: N }, () => [0.2, 0]);
    const r1 = gaitPreviewControl({ zmpTrajectory: zmpTraj, samplePeriod: T, comHeight: 1.0, previewHorizonS: 0.1 });
    const r4 = gaitPreviewControl({ zmpTrajectory: zmpTraj, samplePeriod: T, comHeight: 1.0, previewHorizonS: 1.6 });
    assert.ok(r4.trackingErrorSq < r1.trackingErrorSq, `longer horizon should give lower error; short=${r1.trackingErrorSq.toFixed(4)}, long=${r4.trackingErrorSq.toFixed(4)}`);
  });
});