// server/tests/conkay-gait-swing-collision-check.test.js
//
// Acceptance tests for gait.swing-collision-check.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { swingCollisionCheck } from "../lib/conkay/physics/solvers/gait-swing-collision-check.js";

describe("gait.swing-collision-check — swing-foot vs stance-leg", () => {
  it("swing foot clears the laterally-offset stance leg ⇒ ok or warn", () => {
    const traj = [];
    for (let i = 0; i < 12; i += 1) {
      const u = i / 11;
      // Forward stride in +x from x=−0.30 (behind the stance leg) to x=+0.30.
      // The foot lifts high enough (z ≥ 0.98, above the stance thigh top at
      // z=0.92) while it passes over the leg column at x=0.
      const x = -0.30 + 0.60 * u;
      const z = 0.94 + 0.10 * Math.sin(u * Math.PI);
      traj.push({ t: i * 0.05, pos: [x, 0, z] });
    }
    // Stance leg is a vertical (z-aligned) column at x = 0, top at z = 0.92.
    const stanceLegBodies = [
      { id: "stance_shin", endA: [0, 0, 0.10], endB: [0, 0, 0.50], radius: 0.045 },
      { id: "stance_thigh", endA: [0, 0, 0.50], endB: [0, 0, 0.92], radius: 0.055 },
    ];
    const r = swingCollisionCheck({ swingFootTrajectory: traj, stanceLegBodies, swingFootRadius: 0.035, swingFootLength: 0.235, minClearanceM: 0.02 });
    assert.ok(["ok", "warn"].includes(r.status), `expected ok or warn, got ${r.status}, minGap=${r.minClearanceM.toFixed(4)}`);
  });

  it("swing foot PENETRATES stance leg ⇒ fail", () => {
    const traj = [];
    for (let i = 0; i < 5; i += 1) {
      traj.push({ t: i * 0.05, pos: [0, 0, 0.55] });       // foot inside stance leg at z=0.55
    }
    const stanceLegBodies = [
      { id: "stance_thigh", endA: [0, 0, 0.4], endB: [0, 0, 0.85], radius: 0.05 },
    ];
    const r = swingCollisionCheck({ swingFootTrajectory: traj, stanceLegBodies, swingFootRadius: 0.05 });
    assert.equal(r.status, "fail");
  });

  it("not_computed: missing trajectory", () => {
    const r = swingCollisionCheck({ stanceLegBodies: [{ id: "x", endA: [0, 0, 0], endB: [0, 0, 1], radius: 0.05 }] });
    assert.equal(r.status, "not_computed");
  });
});