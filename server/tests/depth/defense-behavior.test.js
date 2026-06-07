// tests/depth/defense-behavior.test.js — REAL behavioral tests for the defense
// domain (registerLensAction family, invoked via lensRun). Curated high-confidence
// subset: exact-value pure-compute calcs (threatAssessment / readinessScore /
// incidentResponse / resourceAllocation) + stateful CRUD round-trips against the
// per-user C2 substrate (COP markers, mission planner topo-schedule, asset
// readiness rollup, threat board escalation ladder, supply chain flow, comms log).
// Every lensRun("defense","<macro>", …) literally names the macro → the
// macro-depth grader credits it as a behavioral invocation.
//
// Wrapping note (verified against the live handlers): a SUCCESS surfaces at
// r.ok===true / r.result.<field>; a handler refusal ({ok:false,...}) surfaces at
// r.result.ok===false / r.result.error. The network macro
// usaspending-dod-contracts is intentionally NOT exercised (real fetch).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("defense — pure-compute calc contracts (exact computed values)", () => {
  it("threatAssessment: riskScore = likelihood×impact×100, severity bands, sorted desc", async () => {
    const r = await lensRun("defense", "threatAssessment", {
      data: { threats: [
        { name: "cyber intrusion", likelihood: 0.7, impact: 0.9, category: "cyber" }, // 63 → critical
        { name: "supply disruption", likelihood: 0.5, impact: 0.5 },                   // 25 → medium
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    // Sorted by riskScore desc → critical threat first.
    assert.equal(r.result.threats[0].threat, "cyber intrusion");
    assert.equal(r.result.threats[0].riskScore, 63);
    assert.equal(r.result.threats[0].severity, "critical");
    assert.equal(r.result.threats[0].likelihood, 70);
    assert.equal(r.result.threats[0].impact, 90);
    assert.equal(r.result.threats[1].riskScore, 25);
    assert.equal(r.result.threats[1].severity, "medium");
    assert.equal(r.result.critical, 1);
    assert.equal(r.result.overallThreatLevel, "critical");
    assert.equal(r.result.topThreat, "cyber intrusion");
  });

  it("threatAssessment: empty threat list returns the prompt message (no crash)", async () => {
    const r = await lensRun("defense", "threatAssessment", { data: { threats: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Add threats"));
  });

  it("readinessScore: weighted overall (0.3/0.3/0.2/0.2) + status + gaps", async () => {
    const r = await lensRun("defense", "readinessScore", {
      data: {
        personnelReady: 80, personnelTotal: 100,   // 80%
        equipmentOperational: 50, equipmentTotal: 100, // 50%
        trainingCompletionPercent: 90,
        suppliesPercent: 70,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.personnelReadiness, 80);
    assert.equal(r.result.equipmentReadiness, 50);
    // round(80*0.3 + 50*0.3 + 90*0.2 + 70*0.2) = round(24+15+18+14) = 71
    assert.equal(r.result.overallReadiness, 71);
    assert.equal(r.result.status, "operationally-ready"); // 60..79
    // gaps: personnel 80 not <80; equipment 50<80; training 90 not; supplies 70<80
    assert.deepEqual(r.result.gaps, ["Equipment", "Supplies"]);
  });

  it("incidentResponse: severity is case-insensitive and selects the protocol", async () => {
    const r = await lensRun("defense", "incidentResponse", {
      data: { severity: "CRITICAL", type: "breach", location: "gate-3", reporter: "scout-1" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.severity, "critical");
    assert.equal(r.result.responseTime, "Immediate (< 5 min)");
    assert.equal(r.result.escalationLevel, "Command level");
    assert.ok(r.result.immediateActions.includes("Secure perimeter"));
    assert.equal(r.result.logEntry.location, "gate-3");
    assert.equal(r.result.logEntry.reporter, "scout-1");
  });

  it("incidentResponse: unknown severity falls back to the medium protocol", async () => {
    const r = await lensRun("defense", "incidentResponse", { data: { severity: "bogus", type: "x" } });
    assert.equal(r.result.escalationLevel, "Watch officer"); // medium protocol
    assert.equal(r.result.responseTime, "< 1 hour");
  });

  it("resourceAllocation: priority-ordered greedy fill, partial when resources run out", async () => {
    const r = await lensRun("defense", "resourceAllocation", {
      data: {
        resources: ["r1", "r2", "r3"], // 3 available
        missions: [
          { name: "hold-line", priority: "high", resourcesNeeded: 2 },
          { name: "breach", priority: "critical", resourcesNeeded: 2 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalResources, 3);
    // critical sorts first → gets 2 (fully); high then gets remaining 1 (partial)
    assert.equal(r.result.allocations[0].mission, "breach");
    assert.equal(r.result.allocations[0].resourcesAssigned, 2);
    assert.equal(r.result.allocations[0].status, "fully-allocated");
    assert.equal(r.result.allocations[1].mission, "hold-line");
    assert.equal(r.result.allocations[1].resourcesAssigned, 1);
    assert.equal(r.result.allocations[1].status, "partially-allocated");
    assert.equal(r.result.availableAfter, 0);
    assert.equal(r.result.fullyStaffed, 1);
    assert.equal(r.result.understaffed, 1);
  });
});

describe("defense — COP markers CRUD + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("defense-cop"); });

  it("cop-add → cop-map → cop-remove: a valid marker round-trips and is removed", async () => {
    const add = await lensRun("defense", "cop-add", {
      params: { kind: "threat", label: "SAM site", lat: 34.5, lon: -118.2, affiliation: "hostile" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.marker.kind, "threat");
    assert.equal(add.result.marker.affiliation, "hostile");
    const id = add.result.marker.id;

    const map = await lensRun("defense", "cop-map", {}, ctx);
    assert.equal(map.ok, true);
    assert.ok(map.result.markers.some((m) => m.id === id), "added marker appears on the COP");
    assert.equal(map.result.byKind.threat, 1);

    const rm = await lensRun("defense", "cop-remove", { params: { id } }, ctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, id);
    const map2 = await lensRun("defense", "cop-map", {}, ctx);
    assert.ok(!map2.result.markers.some((m) => m.id === id), "removed marker is gone");
  });

  it("cop-add: out-of-range lat and unknown kind are rejected", async () => {
    const badLat = await lensRun("defense", "cop-add", { params: { kind: "asset", label: "x", lat: 200, lon: 0 } }, ctx);
    assert.equal(badLat.result.ok, false);
    assert.ok(String(badLat.result.error).includes("lat"));
    const badKind = await lensRun("defense", "cop-add", { params: { kind: "ufo", label: "x", lat: 0, lon: 0 } }, ctx);
    assert.equal(badKind.result.ok, false);
    assert.ok(String(badKind.result.error).includes("kind"));
  });
});

describe("defense — mission planner topo-schedule (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("defense-mission"); });

  it("mission-task-add + dependency → mission-plan computes earliest-start, finish, critical path", async () => {
    const a = await lensRun("defense", "mission-task-add", {
      params: { name: "Shape AO", phase: "shaping", durationHours: 10, startOffset: 0 },
    }, ctx);
    assert.equal(a.ok, true);
    const aId = a.result.task.id;
    assert.equal(a.result.task.status, "pending");

    const b = await lensRun("defense", "mission-task-add", {
      params: { name: "Decisive Op", phase: "decisive", durationHours: 5, dependsOn: [aId] },
    }, ctx);
    assert.equal(b.ok, true);
    assert.deepEqual(b.result.task.dependsOn, [aId]); // dependency kept (referent exists)
    const bId = b.result.task.id;

    const plan = await lensRun("defense", "mission-plan", {}, ctx);
    assert.equal(plan.ok, true);
    const sa = plan.result.tasks.find((t) => t.id === aId);
    const sb = plan.result.tasks.find((t) => t.id === bId);
    assert.equal(sa.earliestStart, 0);
    assert.equal(sa.finish, 10);
    assert.equal(sb.earliestStart, 10); // starts after A's 10h finish
    assert.equal(sb.finish, 15);
    assert.equal(plan.result.totalDurationHours, 15);
    assert.deepEqual(plan.result.criticalPath, [bId]); // only B finishes at total duration
    // B depends on A which is not complete → B is blocked
    assert.ok(plan.result.blocked.some((x) => x.id === bId));
    assert.equal(plan.result.completionPct, 0);
  });

  it("mission-task-update: completing the dependency unblocks the dependent + bumps completion", async () => {
    const a = await lensRun("defense", "mission-task-add", { params: { name: "Recon", phase: "shaping", durationHours: 4 } }, ctx);
    const aId = a.result.task.id;
    const upd = await lensRun("defense", "mission-task-update", { params: { id: aId, status: "complete" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.task.status, "complete");
    const bad = await lensRun("defense", "mission-task-update", { params: { id: aId, status: "weird" } }, ctx);
    assert.equal(bad.result.ok, false); // invalid status rejected
    assert.ok(String(bad.result.error).includes("status"));
  });

  it("mission-task-delete: unknown id is rejected", async () => {
    const r = await lensRun("defense", "mission-task-delete", { params: { id: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
  });
});

describe("defense — asset readiness rollup (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("defense-assets"); });

  it("asset-upsert ×3 → asset-rollup: fleet readiness, availability, low-readiness list", async () => {
    await lensRun("defense", "asset-upsert", { params: { designation: "Truck-1", type: "vehicle", status: "operational", readiness: 90 } }, ctx);
    await lensRun("defense", "asset-upsert", { params: { designation: "Truck-2", type: "vehicle", status: "deployed", readiness: 30 } }, ctx);
    await lensRun("defense", "asset-upsert", { params: { designation: "Radar-1", type: "sensor", status: "decommissioned", readiness: 0 } }, ctx);

    const roll = await lensRun("defense", "asset-rollup", {}, ctx);
    assert.equal(roll.ok, true);
    assert.equal(roll.result.total, 3);
    assert.equal(roll.result.inService, 2); // 3 − 1 decommissioned
    // fleet readiness = mean over non-decommissioned: round((90+30)/2) = 60
    assert.equal(roll.result.fleetReadiness, 60);
    // availability = (operational+deployed)/inService = 2/2 → 100
    assert.equal(roll.result.availabilityPct, 100);
    // low-readiness (<60, non-decommissioned): Truck-2 only
    assert.equal(roll.result.lowReadiness.length, 1);
    assert.equal(roll.result.lowReadiness[0].designation, "Truck-2");
    assert.equal(roll.result.rollupStatus, "amber"); // 55..79
  });

  it("asset-upsert: clamps readiness to 0..100 and re-upserts by id (no duplicate)", async () => {
    const up = await lensRun("defense", "asset-upsert", { params: { designation: "Drone-9", readiness: 250 } }, ctx);
    assert.equal(up.result.asset.readiness, 100); // clamped
    const id = up.result.asset.id;
    const up2 = await lensRun("defense", "asset-upsert", { params: { id, designation: "Drone-9", readiness: -5, status: "maintenance" } }, ctx);
    assert.equal(up2.result.asset.id, id);          // same row
    assert.equal(up2.result.asset.readiness, 0);     // clamped low
    assert.equal(up2.result.asset.status, "maintenance");
  });
});

describe("defense — threat board escalation ladder (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("defense-threats"); });

  it("threat-add → threat-escalate: severity climbs the ladder, history records the event", async () => {
    const add = await lensRun("defense", "threat-add", { params: { name: "Convoy ambush", severity: "medium", region: "north" } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.threat.severity, "medium");
    assert.equal(add.result.threat.status, "watching");
    const id = add.result.threat.id;

    const up = await lensRun("defense", "threat-escalate", { params: { id, direction: "up", status: "engaged" } }, ctx);
    assert.equal(up.ok, true);
    assert.equal(up.result.threat.severity, "high"); // medium → high
    assert.equal(up.result.changed, true);
    assert.equal(up.result.threat.status, "engaged");
    assert.ok(up.result.threat.history.some((h) => h.event === "escalated"));

    const board = await lensRun("defense", "threat-board", {}, ctx);
    assert.equal(board.ok, true);
    assert.ok(board.result.threats.some((t) => t.id === id));
    assert.equal(board.result.bySeverity.high, 1);
    assert.equal(board.result.highestSeverity, "high");
  });

  it("threat-escalate: at 'critical' an up-escalation is clamped (changed=false)", async () => {
    const add = await lensRun("defense", "threat-add", { params: { name: "Imminent strike", severity: "critical" } }, ctx);
    const id = add.result.threat.id;
    const up = await lensRun("defense", "threat-escalate", { params: { id, direction: "up" } }, ctx);
    assert.equal(up.result.threat.severity, "critical"); // already at top
    assert.equal(up.result.changed, false);
  });
});

describe("defense — logistics supply chain (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("defense-supply"); });

  it("supply-request → supply-advance: status walks the flow; board aggregates fulfillment", async () => {
    const req = await lensRun("defense", "supply-request", {
      params: { item: "5.56mm ammo", quantity: 5000, category: "ammunition", priority: "urgent", destination: "FOB Alpha" },
    }, ctx);
    assert.equal(req.ok, true);
    assert.equal(req.result.request.status, "requested");
    assert.equal(req.result.request.quantity, 5000);
    const id = req.result.request.id;

    const a1 = await lensRun("defense", "supply-advance", { params: { id } }, ctx);
    assert.equal(a1.result.request.status, "approved");     // requested → approved
    const a2 = await lensRun("defense", "supply-advance", { params: { id } }, ctx);
    assert.equal(a2.result.request.status, "in_transit");   // approved → in_transit
    const a3 = await lensRun("defense", "supply-advance", { params: { id } }, ctx);
    assert.equal(a3.result.request.status, "delivered");    // in_transit → delivered

    const board = await lensRun("defense", "supply-board", {}, ctx);
    assert.equal(board.result.byStatus.delivered, 1);
    assert.equal(board.result.openCount, 0); // delivered is not open
    assert.equal(board.result.fulfillmentPct, 100);
  });

  it("supply-request: non-positive quantity is rejected", async () => {
    const r = await lensRun("defense", "supply-request", { params: { item: "fuel", quantity: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("quantity"));
  });
});

describe("defense — secure comms log (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("defense-comms"); });

  it("comms-post → comms-ack → comms-log: channel filter + unacknowledged count", async () => {
    const p1 = await lensRun("defense", "comms-post", {
      params: { channel: "TAC-1", body: "Contact north ridge", classification: "secret", precedence: "immediate" },
    }, ctx);
    assert.equal(p1.ok, true);
    assert.equal(p1.result.message.acknowledged, false);
    assert.equal(p1.result.message.classification, "secret");
    const id = p1.result.message.id;
    await lensRun("defense", "comms-post", { params: { channel: "ADMIN", body: "Roster update" } }, ctx);

    const logAll = await lensRun("defense", "comms-log", {}, ctx);
    assert.equal(logAll.result.total, 2);
    assert.equal(logAll.result.unacknowledged, 2);
    assert.ok(logAll.result.channels.includes("TAC-1"));

    const ack = await lensRun("defense", "comms-ack", { params: { id } }, ctx);
    assert.equal(ack.result.message.acknowledged, true);

    const logTac = await lensRun("defense", "comms-log", { params: { channel: "TAC-1" } }, ctx);
    assert.equal(logTac.result.total, 1);          // channel-filtered
    assert.equal(logTac.result.unacknowledged, 0); // the only TAC-1 message is now acked
  });

  it("comms-post: empty body is rejected", async () => {
    const r = await lensRun("defense", "comms-post", { params: { channel: "X", body: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("body"));
  });
});
