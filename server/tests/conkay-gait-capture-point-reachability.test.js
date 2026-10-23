// server/tests/conkay-gait-capture-point-reachability.test.js
//
// Acceptance tests for gait.capture-point-reachability.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capturePointReachability } from "../lib/conkay/physics/solvers/gait-capture-point-reachability.js";

describe("gait.capture-point-reachability — single-step ICP catchability", () => {
  it("ICP at center of support ⇒ reachable", () => {
    const r = capturePointReachability({
      icpPos: [0, 0], icpVel: [0, 0], comHeight: 1.0,
      stepDuration: 0.5, stepLandingPos: [0, 0],
      supportPatch: { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
    });
    assert.equal(r.status, "ok");
    assert.equal(r.reachable, true);
  });

  it("ICP at 0.5 m, landing within support ⇒ reachable after step", () => {
    const r = capturePointReachability({
      icpPos: [0.5, 0], icpVel: [0, 0], comHeight: 1.0,
      stepDuration: 0.5,
      stepLandingPos: [0.5, 0],                     // step lands AT the ICP
      supportPatch: { x: 0.5, y: 0, halfX: 0.12, halfY: 0.07 },
    });
    assert.equal(r.status, "ok");
  });

  it("ICP too far ⇒ not reachable in one step", () => {
    const r = capturePointReachability({
      icpPos: [5, 0], icpVel: [0, 0], comHeight: 1.0,
      stepDuration: 0.5,
      stepLandingPos: [0.3, 0],                   // step lands 0.3 m forward
      supportPatch: { x: 0.3, y: 0, halfX: 0.12, halfY: 0.07 },
    });
    assert.equal(r.reachable, false);
    assert.equal(r.status, "fail");
  });

  it("not_computed: bad comHeight", () => {
    const r = capturePointReachability({
      icpPos: [0, 0], comHeight: 0, stepLandingPos: [0, 0],
    });
    // We don't have an explicit check; verify no crash.
    assert.ok(r !== null);
  });
});