// Contract tests for server/domains/robotics.js — pure-compute
// calculators plus the STATE-backed interactive control surface
// (fleet, telemetry, missions, kinematics, path planning, sensor
// logging, teleop). Every macro must return { ok } and never throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRoboticsActions from "../domains/robotics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`robotics.${name}`);
  if (!fn) throw new Error(`robotics.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerRoboticsActions(register); });

// Fresh STATE per test so robots/missions/logs don't leak between cases.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "robo_user_a" }, userId: "robo_user_a" };

describe("robotics — pure-compute calculators", () => {
  it("kinematicsCalc analyzes a joint chain", () => {
    const r = call("kinematicsCalc", ctxA, {}, { data: { joints: [
      { type: "revolute", angle: 30, length: 120 },
      { type: "revolute", angle: -20, length: 100 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.degreesOfFreedom, 2);
    assert.equal(r.result.maxReach, "220mm");
  });

  it("pathPlan computes total distance over waypoints", () => {
    const r = call("pathPlan", ctxA, {}, { data: { waypoints: [
      { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDistance, 5);
  });

  it("sensorFusion produces a weighted-average estimate", () => {
    const r = call("sensorFusion", ctxA, {}, { data: { sensors: [
      { name: "a", value: 10, confidence: 0.9, weight: 1 },
      { name: "b", value: 20, confidence: 0.9, weight: 1 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sensorCount, 2);
    assert.ok(r.result.fusedValue > 10 && r.result.fusedValue < 20);
  });

  it("batteryLife estimates runtime from draw model", () => {
    const r = call("batteryLife", ctxA, {}, { data: { batteryCapacityWh: 100, motorDrawW: 20, sensorDrawW: 5, computeDrawW: 5 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPowerDraw, "30 W");
  });
});

describe("robotics — fleet management", () => {
  it("fleetList starts empty", () => {
    const r = call("fleetList", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 0);
  });

  it("fleetRegister rejects a missing name", () => {
    const r = call("fleetRegister", ctxA, { type: "arm" });
    assert.equal(r.ok, false);
  });

  it("fleetRegister adds a robot and fleetList sees it", () => {
    const reg = call("fleetRegister", ctxA, { name: "Arm-1", type: "arm" });
    assert.equal(reg.ok, true);
    assert.equal(reg.result.robot.name, "Arm-1");
    const list = call("fleetList", ctxA);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.online, 1);
  });

  it("fleetUpdate changes status and bumps errorCount on error", () => {
    const reg = call("fleetRegister", ctxA, { name: "Arm-2", type: "arm" });
    const id = reg.result.robot.id;
    const upd = call("fleetUpdate", ctxA, { robotId: id, status: "error" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.robot.status, "error");
    assert.equal(upd.result.robot.errorCount, 1);
  });

  it("fleetRemove deregisters a robot", () => {
    const reg = call("fleetRegister", ctxA, { name: "Arm-3", type: "arm" });
    const id = reg.result.robot.id;
    const rem = call("fleetRemove", ctxA, { robotId: id });
    assert.equal(rem.ok, true);
    assert.equal(call("fleetList", ctxA).result.total, 0);
  });
});

describe("robotics — telemetry", () => {
  it("telemetry rejects an unknown robot", () => {
    const r = call("telemetry", ctxA, { robotId: "nope" });
    assert.equal(r.ok, false);
  });

  it("telemetry produces joints, sensors, faults for a real robot", () => {
    const reg = call("fleetRegister", ctxA, { name: "T-1", type: "arm" });
    const r = call("telemetry", ctxA, { robotId: reg.result.robot.id, tick: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.dof, 6);
    assert.equal(r.result.joints.length, 6);
    assert.ok(["nominal", "degraded", "critical"].includes(r.result.health));
    assert.ok(Array.isArray(r.result.faults));
  });
});

describe("robotics — kinematic chain", () => {
  it("forwardKinematics computes the end effector", () => {
    const r = call("forwardKinematics", ctxA, { links: [100, 100], angles: [0, 0] });
    assert.equal(r.ok, true);
    assert.equal(r.result.endEffector.x, 200);
    assert.equal(r.result.dof, 2);
  });

  it("forwardKinematics rejects an empty links array", () => {
    assert.equal(call("forwardKinematics", ctxA, { links: [] }).ok, false);
  });

  it("inverseKinematics converges to a reachable target via CCD", () => {
    const r = call("inverseKinematics", ctxA, { links: [100, 100, 100], targetX: 150, targetY: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "CCD");
    assert.equal(r.result.reachable, true);
    assert.ok(r.result.error < 5);
  });

  it("inverseKinematics flags an out-of-reach target", () => {
    const r = call("inverseKinematics", ctxA, { links: [50, 50], targetX: 900, targetY: 900 });
    assert.equal(r.ok, true);
    assert.equal(r.result.reachable, false);
  });
});

describe("robotics — grid path planning", () => {
  it("gridPlan finds an A* path on an open grid", () => {
    const r = call("gridPlan", ctxA, { width: 10, height: 10, startX: 0, startY: 0, goalX: 9, goalY: 9 });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.cost, 18);
  });

  it("gridPlan routes around obstacles", () => {
    const obstacles = [];
    for (let y = 0; y < 9; y++) obstacles.push({ x: 5, y });
    const r = call("gridPlan", ctxA, { width: 10, height: 10, startX: 0, startY: 0, goalX: 9, goalY: 0, obstacles });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.ok(r.result.cost > 9);
  });

  it("gridPlan rejects a blocked start cell", () => {
    const r = call("gridPlan", ctxA, { width: 5, height: 5, startX: 0, startY: 0, obstacles: [{ x: 0, y: 0 }] });
    assert.equal(r.ok, false);
  });
});

describe("robotics — mission sequencer", () => {
  it("missionCreate rejects an empty step list", () => {
    assert.equal(call("missionCreate", ctxA, { name: "M", steps: [] }).ok, false);
  });

  it("missionCreate queues a multi-step program", () => {
    const r = call("missionCreate", ctxA, { name: "Pick & Place", steps: ["MOVE", "GRIP", "PLACE"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.mission.steps.length, 3);
    assert.equal(r.result.mission.status, "queued");
  });

  it("missionAdvance steps a mission to completion", () => {
    const c = call("missionCreate", ctxA, { name: "Two-step", steps: ["A", "B"] });
    const id = c.result.mission.id;
    let r = call("missionAdvance", ctxA, { missionId: id, op: "step" });
    assert.equal(r.ok, true);
    assert.equal(r.result.mission.status, "running");
    r = call("missionAdvance", ctxA, { missionId: id, op: "step" });
    assert.equal(r.result.mission.status, "complete");
    assert.equal(r.result.progress.percent, 100);
  });

  it("missionAdvance reset returns steps to pending", () => {
    const c = call("missionCreate", ctxA, { name: "Reset-me", steps: ["A"] });
    const id = c.result.mission.id;
    call("missionAdvance", ctxA, { missionId: id, op: "step" });
    const r = call("missionAdvance", ctxA, { missionId: id, op: "reset" });
    assert.equal(r.result.mission.status, "queued");
    assert.equal(r.result.mission.currentStep, 0);
  });

  it("missionList and missionRemove work end-to-end", () => {
    const c = call("missionCreate", ctxA, { name: "Del-me", steps: ["A"] });
    assert.equal(call("missionList", ctxA).result.total, 1);
    const rem = call("missionRemove", ctxA, { missionId: c.result.mission.id });
    assert.equal(rem.ok, true);
    assert.equal(call("missionList", ctxA).result.total, 0);
  });
});

describe("robotics — sensor logging + playback", () => {
  it("sensorLog appends samples and sensorPlayback reads them back", () => {
    const reg = call("fleetRegister", ctxA, { name: "S-1", type: "mobile" });
    const id = reg.result.robot.id;
    call("sensorLog", ctxA, { robotId: id, channel: "imu", value: 1 });
    call("sensorLog", ctxA, { robotId: id, channel: "imu", value: 3 });
    const pb = call("sensorPlayback", ctxA, { robotId: id, channel: "imu" });
    assert.equal(pb.ok, true);
    assert.equal(pb.result.stats.count, 2);
    assert.equal(pb.result.stats.mean, 2);
  });

  it("sensorClear wipes a robot's log", () => {
    const reg = call("fleetRegister", ctxA, { name: "S-2", type: "mobile" });
    const id = reg.result.robot.id;
    call("sensorLog", ctxA, { robotId: id, channel: "imu", value: 1 });
    const cl = call("sensorClear", ctxA, { robotId: id });
    assert.equal(cl.ok, true);
    assert.equal(call("sensorPlayback", ctxA, { robotId: id }).result.stats.count, 0);
  });
});

describe("robotics — teleoperation", () => {
  it("teleop integrates the robot pose on a drive command", () => {
    const reg = call("fleetRegister", ctxA, { name: "Tele-1", type: "mobile" });
    const id = reg.result.robot.id;
    const r = call("teleop", ctxA, { robotId: id, command: "forward", step: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.position.y, 2);
  });

  it("teleop home resets the pose to origin", () => {
    const reg = call("fleetRegister", ctxA, { name: "Tele-2", type: "mobile" });
    const id = reg.result.robot.id;
    call("teleop", ctxA, { robotId: id, command: "right", step: 5 });
    const r = call("teleop", ctxA, { robotId: id, command: "home" });
    assert.equal(r.result.position.x, 0);
    assert.equal(r.result.position.y, 0);
  });

  it("teleop rejects an unknown command", () => {
    const reg = call("fleetRegister", ctxA, { name: "Tele-3", type: "mobile" });
    const r = call("teleop", ctxA, { robotId: reg.result.robot.id, command: "teleport" });
    assert.equal(r.ok, false);
  });
});
