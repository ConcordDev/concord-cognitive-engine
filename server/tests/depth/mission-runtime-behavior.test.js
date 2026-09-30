// server/tests/depth/mission-runtime-behavior.test.js
//
// P0 — Mission Task Runtime behavioral tests. Real SQLite durability +
// mocked F0 dispatch (no live Python organs required).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import {
  createMission,
  getMission,
  listMissions,
  tickMission,
  pauseMission,
  abandonMission,
  findDueMissions,
  countActiveMissions,
  runtimeOverview,
  spawnAutonomousMissions,
} from "../../lib/mission-runtime.js";
import { subscribe, _reset as resetBus } from "../../lib/runtime/event-bus.js";
import { isToolAllowed } from "../../lib/mission-templates.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upExec(db);
  return db;
}

function mockDispatch(results = {}) {
  const calls = [];
  const dispatchMCP = async (tool, args, ctx) => {
    calls.push({ tool, args, ctx });
    if (results[tool]) return results[tool];
    return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
  };
  return { dispatchMCP, calls };
}

describe("mission-templates safety", () => {
  it("blocks research_invoke for autonomous sources", () => {
    assert.equal(isToolAllowed("research_invoke", "proactive"), false);
    assert.equal(isToolAllowed("research_invoke", "operator"), true);
  });

  it("allows sentinel_sweep for heartbeat source", () => {
    assert.equal(isToolAllowed("sentinel_sweep", "heartbeat"), true);
  });
});

describe("createMission durability", () => {
  let db;
  beforeEach(() => { db = setupDb(); resetBus(); });

  it("creates a fleet_health mission with persisted steps", () => {
    const events = [];
    subscribe("agent.task.created", (e) => events.push(e));

    const r = createMission(db, { template: "fleet_health", source: "operator", userId: "u1" });
    assert.equal(r.ok, true);
    assert.ok(r.missionId.startsWith("mis_"));
    assert.equal(r.totalSteps, 4);

    const m = getMission(db, r.missionId);
    assert.equal(m.status, "pending");
    assert.equal(m.template, "fleet_health");
    assert.equal(m.steps_plan.length, 4);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.missionId, r.missionId);
  });

  it("rejects forbidden tools for proactive source", () => {
    const r = createMission(db, {
      source: "proactive",
      steps: [{ tool: "research_invoke", args: {} }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "tool_not_allowed");
  });

  it("rejects unknown template", () => {
    const r = createMission(db, { template: "nonexistent" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_template");
  });
});

describe("tickMission through F0 dispatch", () => {
  let db;
  beforeEach(() => { db = setupDb(); resetBus(); });

  it("executes steps sequentially and completes mission", async () => {
    const { dispatchMCP, calls } = mockDispatch();
    const created = createMission(db, { template: "fleet_health", source: "scheduled", userId: "system" });
    assert.equal(created.ok, true);

    let last;
    for (let i = 0; i < 5; i++) {
      last = await tickMission({ db, missionId: created.missionId, dispatchMCP });
      if (last.status === "completed") break;
    }

    assert.equal(last.status, "completed");
    const missionTools = calls.filter((c) => !["trace_recent", "dila_dispatch"].includes(c.tool));
    assert.equal(missionTools.length, 4);
    assert.equal(missionTools[0].tool, "concordia_assemble");
    assert.equal(missionTools[3].tool, "economic_check");

    const m = getMission(db, created.missionId);
    assert.equal(m.status, "completed");
    assert.equal(m.step_log.length, 4);
    assert.equal(m.step_log.every((s) => s.status === "completed"), true);
  });

  it("marks mission failed when dispatch returns error after recovery exhausted", async () => {
    const prev = process.env.CONCORD_MISSION_RECOVERY;
    process.env.CONCORD_MISSION_RECOVERY = "0";
    const { dispatchMCP } = mockDispatch({
      incident_list: { ok: true, decision: "ALLOW", result: { ok: false, reason: "organ_down" } },
    });
    const created = createMission(db, { template: "watch_detect", source: "sentinel" });
    assert.equal(created.ok, true);

    await tickMission({ db, missionId: created.missionId, dispatchMCP });
    const failTick = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(failTick.status, "failed");

    const m = getMission(db, created.missionId);
    assert.equal(m.status, "failed");
    assert.ok(m.error_reason.includes("incident_list"));
    if (prev === undefined) delete process.env.CONCORD_MISSION_RECOVERY;
    else process.env.CONCORD_MISSION_RECOVERY = prev;
  });

  it("pause stops ticking", async () => {
    const { dispatchMCP } = mockDispatch();
    const created = createMission(db, { template: "fleet_health", source: "operator" });
    await tickMission({ db, missionId: created.missionId, dispatchMCP });
    pauseMission(db, created.missionId);
    const r = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(r.reason, "paused");
  });
});

describe("autonomous spawn", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("spawns fleet_health on fleet cycle counter", async () => {
    const { dispatchMCP } = mockDispatch({
      sentinel_sweep: { ok: true, result: { observation: { alert_level: "none" } } },
      proactive_list_predictions: { ok: true, result: { observation: { predictions: [] } } },
      initiative_list: { ok: true, result: { observation: { initiatives: [] } } },
    });

    db.prepare(`UPDATE mission_runtime_state SET fleet_cycle_counter = 19 WHERE id = 1`).run();
    const r = await spawnAutonomousMissions({ db, dispatchMCP });
    assert.equal(r.ok, true);
    assert.equal(r.spawned, 1);
    assert.equal(r.missions[0].template, "fleet_health");
    assert.equal(countActiveMissions(db), 1);
  });

  it("spawns watch_detect on sentinel warn", async () => {
    const { dispatchMCP } = mockDispatch({
      sentinel_sweep: { ok: true, result: { observation: { alert_level: "warn" } } },
    });
    db.prepare(`UPDATE mission_runtime_state SET fleet_cycle_counter = 5 WHERE id = 1`).run();
    const r = await spawnAutonomousMissions({ db, dispatchMCP });
    assert.ok(r.spawned >= 1);
    const watch = r.missions.find((m) => m.template === "watch_detect");
    assert.ok(watch);
  });

  it("respects max concurrent cap", async () => {
    const { dispatchMCP } = mockDispatch();
    for (let i = 0; i < 6; i++) {
      createMission(db, { template: "fleet_health", source: "operator", sourceRef: `x${i}` });
    }
    const r = await spawnAutonomousMissions({ db, dispatchMCP });
    assert.equal(r.spawned, 0);
    assert.equal(r.reason, "at_capacity");
  });
});

describe("runtime overview + list", () => {
  it("reports mission counts by status", () => {
    const db = setupDb();
    createMission(db, { template: "fleet_health", source: "operator" });
    const ov = runtimeOverview(db);
    assert.equal(ov.ok, true);
    assert.ok(ov.templates.includes("fleet_health"));
    assert.equal(ov.active, 1);
    assert.equal(listMissions(db).length, 1);
  });

  it("findDueMissions returns pending missions", () => {
    const db = setupDb();
    createMission(db, { template: "fleet_health", source: "operator" });
    const due = findDueMissions(db);
    assert.equal(due.length, 1);
  });

  it("abandon is terminal", () => {
    const db = setupDb();
    const c = createMission(db, { template: "fleet_health", source: "operator" });
    abandonMission(db, c.missionId);
    const m = getMission(db, c.missionId);
    assert.equal(m.status, "abandoned");
  });
});
