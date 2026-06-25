// server/tests/robotics-persistence.test.js
//
// Robotics persistence (#27) — persists REAL computed runs + mints DTUs, and the
// actuator adapter degrades HONESTLY (no robot → no_actuator, never a faked
// move). Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { recordRun, listRuns, getRun } from "../lib/robotics-persistence.js";
import { actuate, hasActuator, setActuator } from "../lib/robotics/actuator-adapter.js";
import registerRobolabMacros from "../domains/robolab.js";

describe("Robotics persistence (#27)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerRobolabMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("persists a real run and mints a DTU from it", () => {
    const result = { degreesOfFreedom: 6, maxReach: "600mm", workspace: "full-6DOF" };
    const r = recordRun(db, { userId: "u1", robotId: "arm1", kind: "kinematics", input: { joints: 6 }, result, mintDtu: true });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId, "DTU minted");
    const dtu = db.prepare("SELECT lens_id, creator_id, metadata_json FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(dtu.lens_id, "robotics");
    assert.equal(JSON.parse(dtu.metadata_json).kind, "robotics_run");
    const run = getRun(db, r.runId);
    assert.equal(run.result.degreesOfFreedom, 6, "real result round-trips");
  });

  it("lists runs newest-first without minting when not asked", () => {
    recordRun(db, { userId: "u1", robotId: "arm1", kind: "path_plan", result: { totalDistance: 120 } });
    const runs = listRuns(db, "u1");
    assert.ok(runs.length >= 2);
    assert.equal(runs[0].kind, "path_plan", "newest first");
    assert.equal(runs[0].dtuId, null, "no DTU when mintDtu is false");
  });

  it("the actuator adapter reports unavailable honestly with no robot attached", async () => {
    assert.equal(hasActuator(), false);
    const a = await actuate({ robotId: "arm1", command: { joint: 1, angle: 30 } });
    assert.equal(a.ok, false);
    assert.equal(a.reason, "no_actuator", "honest: no fake move");
  });

  it("forwards to a real driver once one is registered", async () => {
    setActuator(async ({ command }) => ({ moved: true, echo: command }));
    assert.equal(hasActuator(), true);
    const a = await actuate({ robotId: "arm1", command: { joint: 2, angle: 45 } });
    assert.equal(a.ok, true);
    assert.equal(a.moved, true);
    setActuator(null); // reset
  });

  it("robolab macros round-trip", async () => {
    const rec = await macros.get("robolab.record_run")({ db, actor: { userId: "u2" } }, { kind: "battery", result: { estimatedRuntime: "90 minutes" }, mintDtu: false });
    assert.equal(rec.ok, true);
    const list = await macros.get("robolab.runs")({ db, actor: { userId: "u2" } }, {});
    assert.equal(list.runs.length, 1);
    const act = await macros.get("robolab.actuate")({}, { robotId: "x", command: {} });
    assert.equal(act.hasActuator, false);
    assert.equal(act.reason, "no_actuator");
  });
});
