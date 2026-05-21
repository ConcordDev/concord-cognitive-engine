// Contract tests for server/domains/defense.js — the C2 substrate
// (COP map, mission planner, asset readiness rollup, threat board,
// personnel roster, logistics supply chain, secure comms log) plus the
// pure-compute helpers. usaspending-dod-contracts network path is
// stubbed; every macro asserts the { ok } envelope contract.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDefenseActions from "../domains/defense.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`defense.${name}`);
  if (!fn) throw new Error(`defense.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerDefenseActions(register); });

beforeEach(() => {
  // Fresh per-test STATE so per-user maps don't bleed across cases.
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

/* ── pure-compute helpers ─────────────────────────────────────────── */

describe("defense pure-compute helpers", () => {
  it("threatAssessment sorts by risk and flags critical", () => {
    const r = call("threatAssessment", ctxA, {
      data: { threats: [
        { name: "Low risk", likelihood: 0.2, impact: 0.2 },
        { name: "High risk", likelihood: 0.9, impact: 0.9 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.threats[0].threat, "High risk");
    assert.equal(r.result.critical, 1);
  });

  it("readinessScore computes weighted overall + status", () => {
    const r = call("readinessScore", ctxA, {
      data: { personnelReady: 90, personnelTotal: 100, equipmentOperational: 90, equipmentTotal: 100, trainingCompletionPercent: 90, suppliesPercent: 90 },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.overallReadiness, 90);
    assert.equal(r.result.status, "combat-ready");
  });

  it("incidentResponse returns a protocol for the severity", () => {
    const r = call("incidentResponse", ctxA, { data: { type: "breach", severity: "critical" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.escalationLevel, "Command level");
    assert.ok(r.result.immediateActions.length > 0);
  });

  it("resourceAllocation prioritizes critical missions", () => {
    const r = call("resourceAllocation", ctxA, {
      data: {
        resources: [1, 2, 3],
        missions: [
          { name: "Low", priority: "low", resourcesNeeded: 2 },
          { name: "Crit", priority: "critical", resourcesNeeded: 2 },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.allocations[0].mission, "Crit");
  });
});

/* ── usaspending (network stubbed) ────────────────────────────────── */

describe("defense.usaspending-dod-contracts", () => {
  it("rejects empty keyword", async () => {
    const r = await call("usaspending-dod-contracts", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("shapes a real USAspending response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [{ "Award ID": "A1", "Recipient Name": "Lockheed", "Award Amount": 5_000_000 }],
        page_metadata: { total: 1 },
      }),
    });
    const r = await call("usaspending-dod-contracts", ctxA, { keyword: "F-35" });
    assert.equal(r.ok, true);
    assert.equal(r.result.results[0].recipient, "Lockheed");
    assert.equal(r.result.source, "usaspending.gov");
  });

  it("surfaces network failure", async () => {
    const r = await call("usaspending-dod-contracts", ctxA, { keyword: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

/* ── Common Operating Picture ─────────────────────────────────────── */

describe("defense COP map (cop-add / cop-map / cop-remove)", () => {
  it("rejects bad kind / coords", () => {
    assert.equal(call("cop-add", ctxA, { kind: "bogus", label: "x", lat: 0, lon: 0 }).ok, false);
    assert.equal(call("cop-add", ctxA, { kind: "asset", label: "", lat: 0, lon: 0 }).ok, false);
    assert.equal(call("cop-add", ctxA, { kind: "asset", label: "x", lat: 999, lon: 0 }).ok, false);
    assert.equal(call("cop-add", ctxA, { kind: "asset", label: "x", lat: 0, lon: 999 }).ok, false);
  });

  it("plots a marker and reads it back", () => {
    const add = call("cop-add", ctxA, { kind: "operation", label: "Op Vigil", lat: 38.9, lon: -77.0, affiliation: "friendly" });
    assert.equal(add.ok, true);
    const map = call("cop-map", ctxA, {});
    assert.equal(map.ok, true);
    assert.equal(map.result.count, 1);
    assert.equal(map.result.markers[0].label, "Op Vigil");
    assert.equal(map.result.byKind.operation, 1);
  });

  it("surfaces geolocated assets and threats on the COP", () => {
    call("asset-upsert", ctxA, { designation: "Tank-1", lat: 10, lon: 10 });
    call("threat-add", ctxA, { name: "Hostile-1", lat: 20, lon: 20 });
    const map = call("cop-map", ctxA, {});
    assert.equal(map.result.byKind.asset, 1);
    assert.equal(map.result.byKind.threat, 1);
  });

  it("removes a COP marker", () => {
    const add = call("cop-add", ctxA, { kind: "asset", label: "tmp", lat: 1, lon: 1 });
    const rm = call("cop-remove", ctxA, { id: add.result.marker.id });
    assert.equal(rm.ok, true);
    assert.equal(call("cop-map", ctxA, {}).result.count, 0);
  });

  it("isolates COP markers per user", () => {
    call("cop-add", ctxA, { kind: "asset", label: "a-only", lat: 1, lon: 1 });
    assert.equal(call("cop-map", ctxB, {}).result.count, 0);
  });
});

/* ── Mission planner ──────────────────────────────────────────────── */

describe("defense mission planner (mission-task-*)", () => {
  it("rejects empty task name", () => {
    assert.equal(call("mission-task-add", ctxA, { name: "" }).ok, false);
  });

  it("adds tasks and schedules dependencies on the critical path", () => {
    const a = call("mission-task-add", ctxA, { name: "Recon", phase: "shaping", durationHours: 10 });
    assert.equal(a.ok, true);
    const b = call("mission-task-add", ctxA, { name: "Assault", phase: "decisive", durationHours: 5, dependsOn: [a.result.task.id] });
    assert.equal(b.ok, true);
    const plan = call("mission-plan", ctxA, {});
    assert.equal(plan.ok, true);
    const assault = plan.result.tasks.find((t) => t.name === "Assault");
    assert.equal(assault.earliestStart, 10);
    assert.ok(plan.result.criticalPath.includes(assault.id));
  });

  it("updates task status and reports completion", () => {
    const a = call("mission-task-add", ctxA, { name: "Task", durationHours: 4 });
    const up = call("mission-task-update", ctxA, { id: a.result.task.id, status: "complete" });
    assert.equal(up.ok, true);
    assert.equal(call("mission-plan", ctxA, {}).result.completionPct, 100);
  });

  it("rejects invalid status", () => {
    const a = call("mission-task-add", ctxA, { name: "Task" });
    assert.equal(call("mission-task-update", ctxA, { id: a.result.task.id, status: "bogus" }).ok, false);
  });

  it("deletes a task and strips dangling deps", () => {
    const a = call("mission-task-add", ctxA, { name: "Dep" });
    const b = call("mission-task-add", ctxA, { name: "User", dependsOn: [a.result.task.id] });
    call("mission-task-delete", ctxA, { id: a.result.task.id });
    const plan = call("mission-plan", ctxA, {});
    const user = plan.result.tasks.find((t) => t.id === b.result.task.id);
    assert.equal(user.dependsOn.length, 0);
  });
});

/* ── Asset readiness rollup ───────────────────────────────────────── */

describe("defense asset readiness (asset-*)", () => {
  it("rejects empty designation", () => {
    assert.equal(call("asset-upsert", ctxA, { designation: "" }).ok, false);
  });

  it("upserts assets and computes a fleet rollup", () => {
    call("asset-upsert", ctxA, { designation: "A1", status: "operational", readiness: 90 });
    call("asset-upsert", ctxA, { designation: "A2", status: "maintenance", readiness: 40 });
    const r = call("asset-rollup", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.fleetReadiness, 65);
    assert.equal(r.result.lowReadiness.length, 1);
    assert.equal(r.result.lowReadiness[0].designation, "A2");
  });

  it("edits an existing asset by id", () => {
    const a = call("asset-upsert", ctxA, { designation: "Edit", readiness: 50 });
    const up = call("asset-upsert", ctxA, { id: a.result.asset.id, designation: "Edit", readiness: 95 });
    assert.equal(up.result.asset.readiness, 95);
    assert.equal(call("asset-rollup", ctxA, {}).result.total, 1);
  });

  it("deletes an asset", () => {
    const a = call("asset-upsert", ctxA, { designation: "Doomed" });
    assert.equal(call("asset-delete", ctxA, { id: a.result.asset.id }).ok, true);
    assert.equal(call("asset-rollup", ctxA, {}).result.total, 0);
  });
});

/* ── Threat tracking board ────────────────────────────────────────── */

describe("defense threat board (threat-*)", () => {
  it("adds a threat to the watchlist", () => {
    const r = call("threat-add", ctxA, { name: "APT-X", severity: "medium" });
    assert.equal(r.ok, true);
    assert.equal(r.result.threat.status, "watching");
  });

  it("escalates and de-escalates severity", () => {
    const a = call("threat-add", ctxA, { name: "T", severity: "low" });
    const up = call("threat-escalate", ctxA, { id: a.result.threat.id, direction: "up" });
    assert.equal(up.result.threat.severity, "medium");
    const down = call("threat-escalate", ctxA, { id: a.result.threat.id, direction: "down" });
    assert.equal(down.result.threat.severity, "low");
  });

  it("threat-update changes status without touching severity", () => {
    const a = call("threat-add", ctxA, { name: "T", severity: "high" });
    const up = call("threat-update", ctxA, { id: a.result.threat.id, status: "engaged" });
    assert.equal(up.ok, true);
    assert.equal(up.result.threat.status, "engaged");
    assert.equal(up.result.threat.severity, "high");
  });

  it("threat-update rejects invalid status", () => {
    const a = call("threat-add", ctxA, { name: "T" });
    assert.equal(call("threat-update", ctxA, { id: a.result.threat.id, status: "bogus" }).ok, false);
  });

  it("threat-board sorts critical first and counts severity", () => {
    call("threat-add", ctxA, { name: "Lo", severity: "low" });
    call("threat-add", ctxA, { name: "Crit", severity: "critical" });
    const b = call("threat-board", ctxA, {});
    assert.equal(b.ok, true);
    assert.equal(b.result.threats[0].severity, "critical");
    assert.equal(b.result.bySeverity.critical, 1);
  });

  it("deletes a threat", () => {
    const a = call("threat-add", ctxA, { name: "Gone" });
    assert.equal(call("threat-delete", ctxA, { id: a.result.threat.id }).ok, true);
    assert.equal(call("threat-board", ctxA, {}).result.total, 0);
  });
});

/* ── Personnel roster ─────────────────────────────────────────────── */

describe("defense personnel roster (personnel-*)", () => {
  it("rejects empty name", () => {
    assert.equal(call("personnel-upsert", ctxA, { name: "" }).ok, false);
  });

  it("upserts personnel and rolls up availability", () => {
    call("personnel-upsert", ctxA, { name: "Sgt Doe", availability: "available", assignment: "Gate" });
    call("personnel-upsert", ctxA, { name: "Pvt Roe", availability: "deployed" });
    const r = call("personnel-roster", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.deployable, 1);
    assert.equal(r.result.unassigned.length, 1);
  });

  it("deletes a personnel record", () => {
    const p = call("personnel-upsert", ctxA, { name: "Temp" });
    assert.equal(call("personnel-delete", ctxA, { id: p.result.person.id }).ok, true);
    assert.equal(call("personnel-roster", ctxA, {}).result.total, 0);
  });
});

/* ── Logistics supply chain ───────────────────────────────────────── */

describe("defense logistics (supply-*)", () => {
  it("rejects bad item / quantity", () => {
    assert.equal(call("supply-request", ctxA, { item: "", quantity: 5 }).ok, false);
    assert.equal(call("supply-request", ctxA, { item: "ammo", quantity: -1 }).ok, false);
  });

  it("creates a request and advances it through the flow", () => {
    const req = call("supply-request", ctxA, { item: "5.56mm", quantity: 1000, category: "ammunition", priority: "urgent" });
    assert.equal(req.ok, true);
    assert.equal(req.result.request.status, "requested");
    const adv = call("supply-advance", ctxA, { id: req.result.request.id });
    assert.equal(adv.result.request.status, "approved");
  });

  it("supply-advance honors explicit cancel", () => {
    const req = call("supply-request", ctxA, { item: "fuel", quantity: 200 });
    const c = call("supply-advance", ctxA, { id: req.result.request.id, status: "cancelled" });
    assert.equal(c.result.request.status, "cancelled");
  });

  it("supply-board sorts by priority and computes fulfillment", () => {
    const a = call("supply-request", ctxA, { item: "rations", quantity: 50, priority: "routine" });
    call("supply-request", ctxA, { item: "medkits", quantity: 10, priority: "flash" });
    call("supply-advance", ctxA, { id: a.result.request.id, status: "delivered" });
    const b = call("supply-board", ctxA, {});
    assert.equal(b.ok, true);
    assert.equal(b.result.requests[0].priority, "flash");
    assert.equal(b.result.fulfillmentPct, 50);
  });

  it("deletes a request", () => {
    const req = call("supply-request", ctxA, { item: "parts", quantity: 3 });
    assert.equal(call("supply-delete", ctxA, { id: req.result.request.id }).ok, true);
    assert.equal(call("supply-board", ctxA, {}).result.total, 0);
  });
});

/* ── Secure comms log ─────────────────────────────────────────────── */

describe("defense secure comms (comms-*)", () => {
  it("rejects empty channel / body", () => {
    assert.equal(call("comms-post", ctxA, { channel: "", body: "x" }).ok, false);
    assert.equal(call("comms-post", ctxA, { channel: "ops", body: "" }).ok, false);
  });

  it("posts a message and reads the log", () => {
    const p = call("comms-post", ctxA, { channel: "ops", body: "Sitrep nominal", classification: "secret", precedence: "priority" });
    assert.equal(p.ok, true);
    const log = call("comms-log", ctxA, {});
    assert.equal(log.ok, true);
    assert.equal(log.result.total, 1);
    assert.equal(log.result.unacknowledged, 1);
    assert.deepEqual(log.result.channels, ["ops"]);
  });

  it("acknowledges a message", () => {
    const p = call("comms-post", ctxA, { channel: "ops", body: "Ack me" });
    const ack = call("comms-ack", ctxA, { id: p.result.message.id });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.message.acknowledged, true);
    assert.equal(call("comms-log", ctxA, {}).result.unacknowledged, 0);
  });

  it("filters the log by channel", () => {
    call("comms-post", ctxA, { channel: "alpha", body: "a" });
    call("comms-post", ctxA, { channel: "bravo", body: "b" });
    const filtered = call("comms-log", ctxA, { channel: "alpha" });
    assert.equal(filtered.result.total, 1);
    assert.equal(filtered.result.messages[0].channel, "alpha");
  });

  it("deletes a message", () => {
    const p = call("comms-post", ctxA, { channel: "ops", body: "Gone" });
    assert.equal(call("comms-delete", ctxA, { id: p.result.message.id }).ok, true);
    assert.equal(call("comms-log", ctxA, {}).result.total, 0);
  });
});
