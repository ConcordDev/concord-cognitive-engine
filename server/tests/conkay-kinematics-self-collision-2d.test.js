// server/tests/conkay-kinematics-self-collision-2d.test.js
//
// Closed-form acceptance tests for kinematics.self-collision-2d.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selfCollisionCheck2D } from "../lib/conkay/physics/solvers/kinematics-self-collision-2d.js";

describe("kinematics.self-collision-2d — capsule vs capsule", () => {
  it("two distant bodies in space ⇒ ok", () => {
    const bodies = [
      { id: "A", parent: null, axis: [0, 0, 1], origin: [0, 0, 0], length: 0.5, radius: 0.05, q: 0 },
      { id: "B", parent: null, axis: [0, 0, 1], origin: [0, 0, 0], length: 0.5, radius: 0.05, q: 0 },
    ];
    const worldFrame = [
      { id: "A", positionW: [0, 0, 1] },                  // capsule A at (0,0,1)
      { id: "B", positionW: [0, 0.3, 1] },                // capsule B at (0,0.3,1), 30 cm away
    ];
    const r = selfCollisionCheck2D({ bodies, worldFrame });
    assert.equal(r.status, "ok");
    assert.equal(r.contacts.length, 1);
    assert.ok(r.contacts[0].gapM > 0.1, `gap should be > 0.1 m, got ${r.contacts[0].gapM}`);
  });

  it("two overlapping bodies ⇒ fail (colliding)", () => {
    const bodies = [
      { id: "A", parent: null, axis: [0, 0, 1], origin: [0, 0, 0], length: 0.5, radius: 0.05, q: 0 },
      { id: "B", parent: null, axis: [0, 0, 1], origin: [0, 0, 0], length: 0.5, radius: 0.05, q: 0 },
    ];
    const worldFrame = [
      { id: "A", positionW: [0, 0, 1] },
      { id: "B", positionW: [0, 0, 1] },                  // same place
    ];
    const r = selfCollisionCheck2D({ bodies, worldFrame });
    assert.equal(r.status, "fail");
    assert.ok(r.contacts[0].gapM < 0);                    // penetration
  });

  it("body just grazing another ⇒ warn if minClearance > 0", () => {
    const bodies = [
      { id: "A", parent: null, axis: [0, 0, 1], origin: [0, 0, 0], length: 0.5, radius: 0.05, q: 0 },
      { id: "B", parent: null, axis: [0, 0, 1], origin: [0, 0, 0], length: 0.5, radius: 0.05, q: 0 },
    ];
    const worldFrame = [
      { id: "A", positionW: [0, 0, 1] },
      { id: "B", positionW: [0, 0.105, 1] },              // 0.5 cm gap
    ];
    const r = selfCollisionCheck2D({ bodies, worldFrame, minClearanceM: 0.05, warnMarginM: 0.01 });
    // gap ≈ 0.005 < minClearance(0.05) − warnMargin(0.01) ⇒ warn
    assert.equal(r.status, "warn");
  });

  it("parent-child pair is skipped (no false positive at joint)", () => {
    const bodies = [
      { id: "thigh", parent: "hip", axis: [1, 0, 0], origin: [0, 0, 0], length: 0.43, radius: 0.05, q: 0 },
      { id: "shin", parent: "thigh", axis: [1, 0, 0], origin: [0, 0, -0.43], length: 0.43, radius: 0.05, q: 0 },
    ];
    const worldFrame = [
      { id: "thigh", positionW: [0, 0, 1] },
      { id: "shin", positionW: [0, 0, 0.55] },            // thigh tip extends 0.45 down to (0,0,0.55); shin starts there
    ];
    const r = selfCollisionCheck2D({ bodies, worldFrame });
    assert.equal(r.status, "ok");
    assert.equal(r.contacts.length, 0);                   // parent-child skip
  });

  it("missing bodies array ⇒ not_computed", () => {
    const r = selfCollisionCheck2D({});
    assert.equal(r.status, "not_computed");
  });

  it("sagittal humanoid legs crossing ⇒ knee hitting opposite foot check", () => {
    // A simple model: two legs, each with thigh + shin + foot. If knees cross, fail.
    const bodies = [
      { id: "L_thigh", parent: "L_hip", axis: [1, 0, 0], origin: [0, 0, 0], length: 0.43, radius: 0.05, q: 0 },
      { id: "L_shin", parent: "L_thigh", axis: [1, 0, 0], origin: [0, 0, -0.43], length: 0.43, radius: 0.05, q: 0 },
      { id: "R_thigh", parent: "R_hip", axis: [1, 0, 0], origin: [0, 0, 0], length: 0.43, radius: 0.05, q: 0 },
      { id: "R_shin", parent: "R_thigh", axis: [1, 0, 0], origin: [0, 0, -0.43], length: 0.43, radius: 0.05, q: 0 },
    ];
    // Crossing: L_shin in the right leg space (overlapping R_thigh in y).
    const worldFrame = [
      { id: "L_thigh", positionW: [0, 0, 1] },
      { id: "L_shin", positionW: [0, 0, 0.55] },
      { id: "R_thigh", positionW: [0, 0.1, 1] },
      { id: "R_shin", positionW: [0, 0.1, 0.55] },        // 0.1 m apart — too close
    ];
    const r = selfCollisionCheck2D({ bodies, worldFrame, minClearanceM: 0.05 });
    // With 0.1 m apart and 0.05 m min clearance ⇒ below_clearance but not colliding.
    assert.ok(["warn", "fail"].includes(r.status), `status should be warn or fail, got ${r.status}`);
    // Check that L_thigh vs R_shin pair is detected.
    const lrPair = r.contacts.find((c) => (c.i === "L_thigh" && c.j === "R_shin") || (c.i === "R_shin" && c.j === "L_thigh"));
    assert.ok(lrPair, `pair L_thigh vs R_shin should be checked`);
  });
});