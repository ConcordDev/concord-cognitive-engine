// Contract tests for server/domains/crisis.js — operational crisis-ops
// macros backing the crisis-ops lens. Exercises every macro and asserts
// the response envelope carries an `ok` boolean. External-data macros
// (crisis.map) run with network disabled and must degrade gracefully.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCrisisMacros from "../domains/crisis.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`crisis.${name}`);
  if (!fn) throw new Error(`crisis.${name} not registered`);
  return fn(ctx, input);
}

// minimal in-memory stand-in for the world_crises table.
function makeDb(rows = []) {
  const crises = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    prepare(sql) {
      const s = String(sql);
      return {
        all(...args) {
          if (/FROM world_crises/.test(s)) {
            const worldId = args[0];
            return [...crises.values()]
              .filter((c) => (worldId == null || c.origin_world_id === worldId))
              .filter((c) => !c.resolved_at);
          }
          if (/FROM user_skills/.test(s)) {
            return [{ skill_id: "rescue", level: 5 }];
          }
          return [];
        },
        get(...args) {
          if (/FROM world_crises/.test(s)) return crises.get(args[0]) || null;
          return null;
        },
        run(...args) {
          if (/UPDATE world_crises/.test(s)) {
            const id = args[args.length - 1];
            const c = crises.get(id);
            if (c && !c.resolved_at) { c.resolved_at = Math.floor(Date.now() / 1000); return { changes: 1 }; }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
      };
    },
  };
}

const NOW = Math.floor(Date.now() / 1000);
function seedRows() {
  return [
    { id: "cr_quake", type: "earthquake", description: "M6 quake downtown", origin_world_id: "w1", started_at: NOW - 600 },
    { id: "cr_flood", type: "flood", description: "River breach", origin_world_id: "w1", started_at: NOW - 3600 * 30 },
  ];
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

before(() => { registerCrisisMacros(register); });
beforeEach(() => {
  // disable network so crisis.map exercises its graceful-degrade path
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

describe("crisis.active_for_player + resolve", () => {
  it("lists active crises for a world", async () => {
    const db = makeDb(seedRows());
    const r = await call("active_for_player", { ...ctxA, db }, { worldId: "w1" });
    assert.equal(r.ok, true);
    assert.equal(r.crises.length, 2);
  });

  it("rejects missing world id", async () => {
    const r = await call("active_for_player", { ...ctxA, db: makeDb() }, {});
    assert.equal(r.ok, false);
  });

  it("resolves a crisis", async () => {
    const db = makeDb(seedRows());
    const r = await call("resolve", { ...ctxA, db }, { crisisId: "cr_quake" });
    assert.equal(r.ok, true);
    assert.equal(r.resolvedBy, "user_a");
  });
});

describe("crisis.map (external feeds, graceful-degrade)", () => {
  it("returns ok with an incidents array even when network is down", async () => {
    const r = await call("map", {}, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.incidents));
    assert.ok(typeof r.result.count === "number");
  });
});

describe("crisis.triage", () => {
  it("ranks crises by score with a priority summary", async () => {
    const db = makeDb(seedRows());
    const r = await call("triage", { ...ctxA, db }, { worldId: "w1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.ok(r.result.ranked[0].triage.score >= r.result.ranked[1].triage.score);
    assert.ok(r.result.summary);
  });

  it("rejects missing world id", async () => {
    const r = await call("triage", { ...ctxA, db: makeDb() }, {});
    assert.equal(r.ok, false);
  });
});

describe("crisis.playbook + playbook_step", () => {
  it("returns a typed checklist for a crisis type", async () => {
    const r = await call("playbook", ctxA, { crisisType: "wildfire", crisisId: "cr_x" });
    assert.equal(r.ok, true);
    assert.equal(r.result.playbookKey, "wildfire");
    assert.ok(r.result.steps.length > 0);
  });

  it("falls back to the generic playbook for unknown types", async () => {
    const r = await call("playbook", ctxA, { crisisType: "alien_invasion", crisisId: "cr_x" });
    assert.equal(r.ok, true);
    assert.equal(r.result.playbookKey, "default");
  });

  it("toggles a step and reflects completion", async () => {
    const r = await call("playbook_step", ctxA, { crisisId: "cr_step", stepId: "step_0", done: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.done, true);
    const pb = await call("playbook", ctxA, { crisisType: "flood", crisisId: "cr_step" });
    assert.equal(pb.result.steps[0].done, true);
  });
});

describe("crisis.assign / team / unassign", () => {
  it("assigns a responder and lists the roster", async () => {
    const a = await call("assign", ctxA, { crisisId: "cr_team", responder: "Maya", role: "incident_commander" });
    assert.equal(a.ok, true);
    const t = await call("team", ctxA, { crisisId: "cr_team" });
    assert.equal(t.ok, true);
    assert.equal(t.result.count, 1);
    assert.equal(t.result.byRole.incident_commander.length, 1);
  });

  it("unassigns a responder", async () => {
    const a = await call("assign", ctxA, { crisisId: "cr_team2", responder: "Leo", role: "responder" });
    const r = await call("unassign", ctxA, { crisisId: "cr_team2", entryId: a.result.entry.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.teamSize, 0);
  });

  it("rejects assign without a responder", async () => {
    const r = await call("assign", ctxA, { crisisId: "cr_team3" });
    assert.equal(r.ok, false);
  });
});

describe("crisis.log_event + timeline", () => {
  it("appends an event and reads the timeline", async () => {
    const e = await call("log_event", ctxA, { crisisId: "cr_log", kind: "update", note: "Shelter opened" });
    assert.equal(e.ok, true);
    const tl = await call("timeline", { ...ctxA, db: makeDb() }, { crisisId: "cr_log" });
    assert.equal(tl.ok, true);
    assert.ok(tl.result.events.some((x) => x.note === "Shelter opened"));
  });

  it("rejects log_event without a note", async () => {
    const r = await call("log_event", ctxA, { crisisId: "cr_log" });
    assert.equal(r.ok, false);
  });
});

describe("crisis.alerts + acknowledge_alert", () => {
  it("returns new / escalated crises with an unacknowledged count", async () => {
    const db = makeDb(seedRows());
    const r = await call("alerts", { ...ctxA, db }, { worldId: "w1", sinceMs: 0 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.alerts));
    assert.ok(typeof r.result.unacknowledged === "number");
  });

  it("acknowledges an alert", async () => {
    const r = await call("acknowledge_alert", ctxA, { alertId: "alert:cr_quake" });
    assert.equal(r.ok, true);
    assert.equal(r.result.acknowledged, true);
  });
});

describe("crisis.resources / resource_upsert / resource_deploy", () => {
  it("upserts a resource and lists inventory totals", async () => {
    const u = await call("resource_upsert", ctxA, { name: "Rescue boat", category: "vehicles", quantity: 4, unit: "boats" });
    assert.equal(u.ok, true);
    const list = await call("resources", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.totals.total >= 4);
  });

  it("deploys a resource against a crisis and tracks availability", async () => {
    const u = await call("resource_upsert", ctxA, { name: "Pumps", category: "equipment", quantity: 10, unit: "units" });
    const d = await call("resource_deploy", ctxA, { resourceId: u.result.resource.id, crisisId: "cr_dep", amount: 3 });
    assert.equal(d.ok, true);
    assert.equal(d.result.available, 7);
  });

  it("rejects deploying more than available", async () => {
    const u = await call("resource_upsert", ctxA, { name: "Tents", category: "supplies", quantity: 2, unit: "units" });
    const d = await call("resource_deploy", ctxA, { resourceId: u.result.resource.id, amount: 99 });
    assert.equal(d.ok, false);
  });
});
