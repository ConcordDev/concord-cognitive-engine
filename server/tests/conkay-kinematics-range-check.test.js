// server/tests/conkay-kinematics-range-check.test.js
//
// Closed-form acceptance tests for kinematics.range-check.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rangeCheckTrajectory, rangeCheckSingle } from "../lib/conkay/physics/solvers/kinematics-range-check.js";

describe("kinematics.range-check — joint range enforcement", () => {
  it("single pose: well within limits ⇒ ok", () => {
    const r = rangeCheckSingle({
      pose: { thigh: 0.5, shin: 0.3, foot: 0.0 },
      limits: {
        thigh: { min: -1.5, max: 1.5 },
        shin: { min: 0.0, max: 2.5 },
        foot: { min: -0.5, max: 0.5 },
      },
    });
    assert.equal(r.status, "ok");
    assert.equal(r.frames[0].perJoint.length, 3);
  });

  it("single pose: q outside [min, max] ⇒ fail", () => {
    const r = rangeCheckSingle({
      pose: { thigh: 2.0 },                              // outside [-1.5, 1.5]
      limits: { thigh: { min: -1.5, max: 1.5 } },
    });
    assert.equal(r.status, "fail");
    assert.ok(r.frames[0].perJoint[0].status === "fail");
  });

  it("warn margin: q within 5° of limit ⇒ warn", () => {
    const r = rangeCheckSingle({
      pose: { thigh: 1.5 - 3 * Math.PI / 180 },          // 3° from max
      limits: { thigh: { min: -1.5, max: 1.5 } },
      warnMarginDeg: 5,
    });
    assert.equal(r.status, "warn");
    assert.ok(r.aggregate.warnCount.byType.inRange >= 1);
  });

  it("speed limit: |qdot| > maxSpeedRadps ⇒ fail", () => {
    const r = rangeCheckSingle({
      pose: { thigh: { q: 0.0, qdot: 5.0 } },
      limits: { thigh: { min: -1.5, max: 1.5, maxSpeedRadps: 3.0 } },
    });
    assert.equal(r.status, "fail");
  });

  it("acceleration limit: |qddot| > maxAccRadps2 ⇒ fail", () => {
    const r = rangeCheckSingle({
      pose: { thigh: { q: 0.0, qdot: 1.0, qddot: 8.0 } },
      limits: { thigh: { min: -1.5, max: 1.5, maxSpeedRadps: 3.0, maxAccRadps2: 5.0 } },
    });
    assert.equal(r.status, "fail");
  });

  it("not_computed: missing limits ⇒ not_computed", () => {
    const r = rangeCheckSingle({ pose: { thigh: 0.0 }, limits: null });
    assert.equal(r.status, "not_computed");
  });

  it("not_computed: missing q ⇒ perJoint reports not_computed, status remains aggregate from others", () => {
    const r = rangeCheckSingle({
      pose: { thigh: 0.0 },                              // shin q missing
      limits: { thigh: { min: -1.5, max: 1.5 }, shin: { min: 0, max: 2.5 } },
    });
    assert.equal(r.status, "ok");                         // thigh ok, shin not_computed ⇒ aggregate is ok
    const shin = r.frames[0].perJoint.find((j) => j.linkId === "shin");
    assert.equal(shin.status, "not_computed");
  });

  it("trajectory: 5 frames, all within limits ⇒ ok", () => {
    const frames = [];
    for (let i = 0; i < 5; i += 1) frames.push({ thigh: 0.5, shin: 0.3 });
    const r = rangeCheckTrajectory({ joints: frames, limits: { thigh: { min: -1.5, max: 1.5 }, shin: { min: 0, max: 2.5 } } });
    assert.equal(r.status, "ok");
    assert.equal(r.frames.length, 5);
  });

  it("trajectory: one frame violates limit ⇒ aggregate fail", () => {
    const frames = [
      { thigh: 0.0 }, { thigh: 0.5 }, { thigh: 1.0 },
      { thigh: 1.5 },                                  // at edge (inside)
      { thigh: 2.0 },                                  // violated
    ];
    const r = rangeCheckTrajectory({ joints: frames, limits: { thigh: { min: -1.5, max: 1.5 } } });
    assert.equal(r.status, "fail");
  });
});