// Phase-2 component-exact-shape behavioral test for server/domains/robotics.js.
//
// This is NOT a duplicate of robotics-domain-parity.test.js (which pins the
// macro return-shape contract). This test drives each pure-compute calculator
// with the EXACT inner-data object the RoboticsActionPanel component sends
// (callMacro(action, { artifact: { data } }) — the {artifact:{data}} wrapper is
// auto-peeled at the dispatch chokepoint by server/lib/lens-input-normalize.js,
// so here we pass the peeled `{ data: {...} }` artifact directly to the 3-arg
// registerLensAction(ctx, artifact, params) signature) and asserts the EXACT
// fields the component renders off `r.result`, with REAL computed values.
//
// Field-alignment audited 2026-06-28 (RoboticsActionPanel.tsx):
//   kinematicsCalc → renders degreesOfFreedom, maxReach, workspace, type,
//                    joints[].{joint,type,angle,length}
//   pathPlan       → renders waypoints, totalDistance, estimatedTime, collisionCheck
//   sensorFusion   → renders sensorCount, fusedValue, fusedConfidence, method,
//                    sensors[].{sensor,value,confidence}
//   batteryLife    → renders batteryCapacity, estimatedRuntime, safeRuntime,
//                    totalPowerDraw, recommendation
// Plus the KinematicsStudio (forwardKinematics/inverseKinematics) and PathPlanner
// (gridPlan) component-exact fields. Every asserted field is one a component
// actually reads — no fabricated fields.
//
// Hermetic: no server boot, no network, no LLM, no DB. Calls the registered
// handlers directly via a 3-arg dispatch shim.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRoboticsActions from "../domains/robotics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// Mirror the real 3-arg dispatch: (ctx, artifact, params). `artifact` carries
// `.data` (already peeled from the component's {artifact:{data}} envelope).
function dispatch(name, { ctx = ctxA, data = {}, params = {} } = {}) {
  const fn = ACTIONS.get(`robotics.${name}`);
  if (!fn) throw new Error(`robotics.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => { registerRoboticsActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "robo_macros_user" }, userId: "robo_macros_user" };

// ───────────────────────────────────────────────────────────────────────────
// kinematicsCalc — the component sends artifact.data.joints (array) and renders
// degreesOfFreedom / maxReach / workspace / type + joints[].{joint,type,angle,length}.
// ───────────────────────────────────────────────────────────────────────────
describe("robotics.kinematicsCalc — component-exact", () => {
  it("computes DOF, reach and per-joint shape the card renders", () => {
    // EXACT inner-data the panel's actKin sends: { joints }.
    const r = dispatch("kinematicsCalc", { data: { joints: [
      { type: "revolute", angle: 30, length: 120, minAngle: -90, maxAngle: 90 },
      { type: "prismatic", angle: -20, length: 100 },
      { type: "revolute", angle: 10, length: 80 },
    ] } });
    assert.equal(r.ok, true);
    // Exact rendered fields with real values.
    assert.equal(r.result.degreesOfFreedom, 3);
    assert.equal(r.result.maxReach, "300mm");       // 120+100+80
    assert.equal(r.result.workspace, "3-DOF limited");
    assert.equal(r.result.type, "SCARA-like");      // 3..5 DOF
    // joints[] exact sub-fields the card lists (J{joint} {type} {angle}° / {length}mm).
    assert.deepEqual(r.result.joints[0], { joint: 1, type: "revolute", angle: 30, length: 120, range: [-90, 90] });
    assert.equal(r.result.joints[1].angle, -20);
    assert.equal(r.result.joints[1].range[0], -180);  // default min when omitted
  });

  it("classifies a 6-DOF chain as articulated / full-6DOF", () => {
    const joints = Array.from({ length: 6 }, () => ({ type: "revolute", angle: 0, length: 50 }));
    const r = dispatch("kinematicsCalc", { data: { joints } });
    assert.equal(r.result.degreesOfFreedom, 6);
    assert.equal(r.result.maxReach, "300mm");
    assert.equal(r.result.workspace, "full-6DOF");
    assert.equal(r.result.type, "articulated");
  });

  it("EMPTY: no joints returns an honest message (the panel's guard branch)", () => {
    const r = dispatch("kinematicsCalc", { data: {} });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add joint parameters/i);
  });

  it("fail-CLOSED: a poisoned non-finite length never leaks Infinity", () => {
    const r = dispatch("kinematicsCalc", { data: { joints: [
      { type: "revolute", angle: "Infinity", length: Infinity },
      { type: "revolute", angle: NaN, length: "1e400" },
    ] } });
    assert.equal(r.ok, true);
    // maxReach must be a finite "<n>mm" string — defaults applied, not Infinity.
    assert.equal(r.result.maxReach, "200mm"); // both lengths fell back to 100
    assert.ok(Number.isFinite(r.result.joints[0].length));
    assert.ok(Number.isFinite(r.result.joints[0].angle));
    assert.equal(r.result.joints[0].length, 100);
    assert.equal(r.result.joints[0].angle, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// pathPlan — component sends artifact.data.waypoints, renders waypoints /
// totalDistance / estimatedTime / collisionCheck.
// ───────────────────────────────────────────────────────────────────────────
describe("robotics.pathPlan — component-exact", () => {
  it("computes total 3D distance the path card renders", () => {
    // (0,0,0)->(3,4,0) = 5, ->(3,4,12) = 12  →  total 17.
    const r = dispatch("pathPlan", { data: { waypoints: [
      { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 12 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.waypoints, 3);
    assert.equal(r.result.totalDistance, 17);
    assert.equal(r.result.estimatedTime, "0.2s at 100mm/s");
    assert.equal(r.result.collisionCheck, "Use simulation to verify clearance");
    assert.deepEqual(r.result.segments[0], { from: 1, to: 2, distance: 5 });
    assert.equal(r.result.segments[1].distance, 12);
  });

  it("EMPTY: a single waypoint returns the panel's guard message", () => {
    const r = dispatch("pathPlan", { data: { waypoints: [{ x: 0, y: 0, z: 0 }] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2 waypoints/i);
  });

  it("fail-CLOSED: a poisoned non-finite coord yields a finite totalDistance", () => {
    const r = dispatch("pathPlan", { data: { waypoints: [
      { x: 0, y: 0, z: 0 }, { x: Infinity, y: "NaN", z: null },
    ] } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalDistance));
    assert.equal(r.result.totalDistance, 0); // poisoned coords default to 0,0,0
  });
});

// ───────────────────────────────────────────────────────────────────────────
// sensorFusion — component sends artifact.data.sensors, renders sensorCount /
// fusedValue / fusedConfidence / method + sensors[].{sensor,value,confidence}.
// ───────────────────────────────────────────────────────────────────────────
describe("robotics.sensorFusion — component-exact", () => {
  it("produces the weighted-average estimate the fusion card renders", () => {
    // totalWeight = 2*0.9 + 1*0.5 = 2.3; num = 10*2*0.9 + 20*1*0.5 = 28; fused = 12.174.
    const r = dispatch("sensorFusion", { data: { sensors: [
      { name: "gps", value: 10, confidence: 0.9, weight: 2 },
      { name: "imu", value: 20, confidence: 0.5, weight: 1 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sensorCount, 2);
    assert.equal(r.result.fusedValue, 12.174);
    assert.equal(r.result.fusedConfidence, 77); // min(1, 1.4/2*1.1)=0.77 → 77
    assert.equal(r.result.method, "weighted-average");
    // sensors[] exact sub-fields the card lists ({sensor}: {value} (c={confidence})).
    assert.deepEqual(r.result.sensors[0], { sensor: "gps", value: 10, confidence: 0.9, weight: 2 });
  });

  it("falls back to the sensor type when no name is given", () => {
    const r = dispatch("sensorFusion", { data: { sensors: [{ type: "lidar", value: 5 }] } });
    assert.equal(r.result.sensors[0].sensor, "lidar");
    assert.equal(r.result.sensors[0].confidence, 0.8); // default confidence
    assert.equal(r.result.sensors[0].weight, 1);        // default weight
  });

  it("EMPTY: no sensors returns the panel's guard message", () => {
    const r = dispatch("sensorFusion", { data: { sensors: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add sensor data/i);
  });

  it("fail-CLOSED: a poisoned non-finite reading yields a finite fusedValue", () => {
    const r = dispatch("sensorFusion", { data: { sensors: [
      { name: "x", value: Infinity, confidence: 0.9, weight: 1 },
    ] } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.fusedValue));
    assert.equal(r.result.fusedValue, 0); // poisoned value defaults to 0
  });
});

// ───────────────────────────────────────────────────────────────────────────
// batteryLife — component sends artifact.data.{batteryCapacityWh,motorDrawW,
// sensorDrawW,computeDrawW}, renders batteryCapacity / estimatedRuntime /
// safeRuntime / totalPowerDraw / recommendation.
// ───────────────────────────────────────────────────────────────────────────
describe("robotics.batteryLife — component-exact", () => {
  it("estimates runtime + safe budget the battery card renders", () => {
    // 100 Wh / (20+5+10=35 W) = 2.857 h → 171 min; safe = 137 min.
    const r = dispatch("batteryLife", { data: {
      batteryCapacityWh: 100, motorDrawW: 20, sensorDrawW: 5, computeDrawW: 10,
    } });
    assert.equal(r.ok, true);
    assert.equal(r.result.batteryCapacity, "100 Wh");
    assert.equal(r.result.totalPowerDraw, "35 W");
    assert.equal(r.result.estimatedRuntime, "171 minutes");
    assert.equal(r.result.safeRuntime, "137 minutes (80% reserve)");
    assert.equal(r.result.recommendation, "Adequate runtime");
    assert.deepEqual(r.result.breakdown, { motors: "20W", sensors: "5W", compute: "10W" });
  });

  it("flags an undersized battery", () => {
    // 10 Wh / 100 W = 0.1 h < 0.5 → undersized.
    const r = dispatch("batteryLife", { data: {
      batteryCapacityWh: 10, motorDrawW: 80, sensorDrawW: 10, computeDrawW: 10,
    } });
    assert.equal(r.result.totalPowerDraw, "100 W");
    assert.equal(r.result.recommendation, "Battery undersized for application");
  });

  it("fail-CLOSED: a poisoned non-finite draw never leaks Infinity", () => {
    // The component's actBat already gates on Number.isFinite client-side; this
    // pins the server to ALSO fail closed so a crafted POST can't poison the result.
    const r = dispatch("batteryLife", { data: {
      batteryCapacityWh: "NaN", motorDrawW: Infinity, sensorDrawW: "x", computeDrawW: null,
    } });
    assert.equal(r.ok, true);
    // all four fell back to finite defaults: 50 Wh / (20+5+10=35 W).
    assert.equal(r.result.totalPowerDraw, "35 W");
    assert.equal(r.result.batteryCapacity, "50 Wh");
    // estimatedRuntime is a finite "<n> minutes" string, NOT "Infinity"/"NaN".
    assert.match(r.result.estimatedRuntime, /^\d+ minutes$/);
    assert.ok(!/Infinity|NaN/.test(r.result.estimatedRuntime));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// KinematicsStudio component — forwardKinematics / inverseKinematics.
// Sends { links, angles } / { links, targetX, targetY }; renders
// endEffector.{x,y}, orientation, extension, maxReach (FK) and reachable,
// converged, error, iterations, angles (IK).
// ───────────────────────────────────────────────────────────────────────────
describe("robotics.forwardKinematics — KinematicsStudio-exact", () => {
  it("computes the end effector + reach the FK card renders", () => {
    const r = dispatch("forwardKinematics", { params: { links: [100, 100], angles: [0, 0] } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.endEffector, { x: 200, y: 0 });
    assert.equal(r.result.orientation, 0);
    assert.equal(r.result.maxReach, 200);
    assert.equal(r.result.extension, "100%");
    assert.equal(r.result.dof, 2);
  });

  it("a right-angle bend lands the effector off-axis", () => {
    const r = dispatch("forwardKinematics", { params: { links: [100, 100], angles: [0, 90] } });
    assert.equal(r.result.endEffector.x, 100);
    assert.equal(r.result.endEffector.y, 100);
    assert.equal(r.result.orientation, 90);
  });

  it("validation-rejection: an empty links array is rejected", () => {
    const r = dispatch("forwardKinematics", { params: { links: [] } });
    assert.equal(r.ok, false);
    assert.match(r.error, /links/i);
  });
});

describe("robotics.inverseKinematics — KinematicsStudio-exact", () => {
  it("CCD converges to a reachable target", () => {
    const r = dispatch("inverseKinematics", { params: { links: [100, 100, 100], targetX: 150, targetY: 50 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "CCD");
    assert.equal(r.result.reachable, true);
    assert.equal(r.result.converged, true);
    assert.ok(r.result.error < 1);
    assert.ok(r.result.iterations >= 1 && r.result.iterations <= 100);
    assert.equal(r.result.angles.length, 3);
    assert.ok(r.result.angles.every((a) => Number.isFinite(a)));
  });

  it("flags an out-of-reach target as unreachable", () => {
    const r = dispatch("inverseKinematics", { params: { links: [50, 50], targetX: 900, targetY: 900 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.reachable, false);
  });

  it("validation-rejection: missing links is rejected", () => {
    assert.equal(dispatch("inverseKinematics", { params: {} }).ok, false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PathPlanner component — gridPlan. Sends { width, height, startX, startY,
// goalX, goalY, obstacles }; renders found, length, cost, expansions,
// obstacleCount.
// ───────────────────────────────────────────────────────────────────────────
describe("robotics.gridPlan — PathPlanner-exact", () => {
  it("finds an A* path on an open grid with the exact rendered fields", () => {
    const r = dispatch("gridPlan", { params: { width: 10, height: 10, startX: 0, startY: 0, goalX: 9, goalY: 9 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.cost, 18);              // Manhattan optimum
    assert.equal(r.result.length, 19);            // cells incl. endpoints
    assert.equal(r.result.obstacleCount, 0);
    assert.ok(r.result.expansions > 0);
    assert.equal(r.result.algorithm, "A* (4-connected)");
  });

  it("routes around an obstacle wall (cost grows)", () => {
    const obstacles = [];
    for (let y = 0; y < 9; y++) obstacles.push({ x: 5, y });
    const r = dispatch("gridPlan", { params: { width: 10, height: 10, startX: 0, startY: 0, goalX: 9, goalY: 0, obstacles } });
    assert.equal(r.result.found, true);
    assert.ok(r.result.cost > 9);
    assert.equal(r.result.obstacleCount, 9);
  });

  it("validation-rejection: a blocked start cell is rejected", () => {
    const r = dispatch("gridPlan", { params: { width: 5, height: 5, startX: 0, startY: 0, obstacles: [{ x: 0, y: 0 }] } });
    assert.equal(r.ok, false);
    assert.match(r.error, /blocked/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Degrade-graceful: every calculator returns a plain { ok } envelope and never
// throws, even on a wholly-absent artifact / hostile shapes.
// ───────────────────────────────────────────────────────────────────────────
describe("robotics — degrade-graceful (never throws)", () => {
  for (const name of ["kinematicsCalc", "pathPlan", "sensorFusion", "batteryLife"]) {
    it(`${name} tolerates a missing artifact.data`, () => {
      const fn = ACTIONS.get(`robotics.${name}`);
      const r = fn(ctxA, { id: null, meta: {} }, {}); // no .data at all
      assert.equal(typeof r, "object");
      assert.equal(r.ok, true); // honest empty-shape message, not a throw
    });
    it(`${name} tolerates a non-array collection`, () => {
      const r = dispatch(name, { data: { joints: "x", waypoints: 5, sensors: null } });
      assert.equal(typeof r.ok, "boolean");
    });
  }
});
