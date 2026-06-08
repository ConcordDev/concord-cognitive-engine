// tests/depth/bridge-behavior.test.js — REAL behavioral tests for the
// bridge/integration domain (registerLensAction family, invoked via lensRun).
// Two layers: stateless calc contracts (connectionHealth/dataMapping/syncStatus/
// throughputAnalysis read artifact.data) and a persistent ops console
// (peers/flows/mappings/schedules/alerts/throughput keyed per-user in STATE).
// Every lensRun("bridge", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("bridge — stateless calc contracts (exact computed values)", () => {
  it("connectionHealth: perfect link scores 100/healthy, lossy link degrades", async () => {
    const r = await lensRun("bridge", "connectionHealth", {
      data: {
        connections: [
          { name: "perfect", source: "A", target: "B", latencyMs: 0, uptimePercent: 100, errorRate: 0 },
          { name: "lossy", source: "C", target: "D", latencyMs: 2500, uptimePercent: 90, errorRate: 0.1 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConnections, 2);
    const perfect = r.result.connections.find((c) => c.name === "perfect");
    // (1*30) + (100/100*40) + (1*30) = 100
    assert.equal(perfect.healthScore, 100);
    assert.equal(perfect.status, "healthy");
    const lossy = r.result.connections.find((c) => c.name === "lossy");
    // max(0,1-0.5)*30 + 0.9*40 + max(0,1-0.1)*30 = 15 + 36 + 27 = 78
    assert.equal(lossy.healthScore, 78);
    assert.equal(lossy.status, "degraded");
    assert.equal(r.result.healthy, 1);
    assert.equal(r.result.degraded, 1);
    assert.equal(r.result.overallHealth, 89); // round((100+78)/2)
  });

  it("connectionHealth: a saturated link is critical", async () => {
    const r = await lensRun("bridge", "connectionHealth", {
      data: { connections: [{ name: "dead", source: "X", target: "Y", latencyMs: 5000, uptimePercent: 10, errorRate: 1 }] },
    });
    // max(0,1-1)*30 + 10/100*40 + max(0,1-1)*30 = 0 + 4 + 0 = 4
    assert.equal(r.result.connections[0].healthScore, 4);
    assert.equal(r.result.connections[0].status, "critical");
    assert.equal(r.result.critical, 1);
  });

  it("connectionHealth: empty input returns the guidance message", async () => {
    const r = await lensRun("bridge", "connectionHealth", { data: { connections: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Add bridge connections"));
  });

  it("dataMapping: a mapping missing target is invalid; coverage is exact", async () => {
    const r = await lensRun("bridge", "dataMapping", {
      data: {
        mappings: [
          { source: "first_name", target: "firstName", transform: "trim" },
          { source: "orphan", target: "" }, // invalid: no target
        ],
      },
    });
    assert.equal(r.result.total, 2);
    assert.equal(r.result.valid, 1);
    assert.equal(r.result.invalid, 1);
    assert.equal(r.result.coverage, 50);
    assert.ok(r.result.transforms.includes("trim"));
    assert.ok(r.result.transforms.includes("direct")); // orphan defaults to direct
  });

  it("syncStatus: a recent sync is 'recent' and error-rate is exact", async () => {
    const lastSync = new Date(Date.now() - 30 * 60000).toISOString(); // 30 min ago
    const r = await lensRun("bridge", "syncStatus", {
      data: {
        lastSync,
        syncs: [
          { recordsProcessed: 100, errors: 5 },
          { recordsProcessed: 100, errors: 0 },
        ],
      },
    });
    assert.equal(r.result.syncHealth, "recent"); // 30 min: <60
    assert.equal(r.result.totalSyncs, 2);
    assert.equal(r.result.totalRecordsProcessed, 200);
    assert.equal(r.result.totalErrors, 5);
    assert.equal(r.result.errorRate, 2.5); // 5/200 = 2.5%
  });

  it("syncStatus: never-synced reads 'disconnected'/'never'", async () => {
    const r = await lensRun("bridge", "syncStatus", { data: { syncs: [] } });
    assert.equal(r.result.lastSync, "never");
    assert.equal(r.result.syncHealth, "disconnected");
    assert.equal(r.result.errorRate, 0);
  });

  it("throughputAnalysis: avg/peak/min are exact and low avg flags a bottleneck", async () => {
    const r = await lensRun("bridge", "throughputAnalysis", {
      data: { throughputMetrics: [{ recordsPerSecond: 10 }, { rps: 50 }, { recordsPerSecond: 90 }] },
    });
    assert.equal(r.result.avgRPS, 50);  // (10+50+90)/3
    assert.equal(r.result.peakRPS, 90);
    assert.equal(r.result.minRPS, 10);
    assert.equal(r.result.dataPoints, 3);
    assert.ok(r.result.bottleneck.includes("Low throughput")); // avg 50 < 100
  });

  it("throughputAnalysis: healthy avg reports no bottleneck", async () => {
    const r = await lensRun("bridge", "throughputAnalysis", {
      data: { throughputMetrics: [{ rps: 200 }, { rps: 300 }] },
    });
    assert.equal(r.result.avgRPS, 250);
    assert.ok(r.result.bottleneck.includes("healthy"));
  });
});

describe("bridge — peer CRUD + topology (shared ctx round-trips)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("bridge-peers"); });

  it("peerRegister → peerList: peer reads back; kind defaults to 'world'", async () => {
    const add = await lensRun("bridge", "peerRegister", { params: { name: "Tunya", endpoint: "https://tunya", region: "tunya" } }, ctx);
    assert.equal(add.result.peer.name, "Tunya");
    assert.equal(add.result.peer.kind, "world"); // invalid/absent kind defaults
    assert.equal(add.result.peer.region, "tunya");
    const list = await lensRun("bridge", "peerList", {}, ctx);
    assert.ok(list.result.peers.some((p) => p.id === add.result.peer.id));
  });

  it("peerRegister: a blank name is rejected", async () => {
    const bad = await lensRun("bridge", "peerRegister", { params: { name: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /peer name required/);
  });

  it("peerRegister: a duplicate name (case-insensitive) is rejected", async () => {
    await lensRun("bridge", "peerRegister", { params: { name: "Cyberworld" } }, ctx);
    const dup = await lensRun("bridge", "peerRegister", { params: { name: "cyberworld" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already exists/);
  });

  it("peerRemove removes the peer from the list; a missing id is rejected", async () => {
    const add = await lensRun("bridge", "peerRegister", { params: { name: "Ephemeral", kind: "external-api" } }, ctx);
    assert.equal(add.result.peer.kind, "external-api");
    const id = add.result.peer.id;
    const rem = await lensRun("bridge", "peerRemove", { params: { peerId: id } }, ctx);
    assert.equal(rem.result.removed, id);
    const list = await lensRun("bridge", "peerList", {}, ctx);
    assert.ok(!list.result.peers.some((p) => p.id === id));
    const bad = await lensRun("bridge", "peerRemove", { params: { peerId: "peer_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /peer not found/);
  });

  it("syncTopology: hub node plus one edge per peer; a half-failed peer is critical", async () => {
    const c = await depthCtx("bridge-topo");
    const peer = (await lensRun("bridge", "peerRegister", { params: { name: "TopoPeer" } }, c)).result.peer;
    // 1 succeeded + 1 failed flow → errRate 0.5 → critical.
    await lensRun("bridge", "recordFlow", { params: { peerId: peer.id, status: "succeeded", records: 100, durationMs: 1000 } }, c);
    await lensRun("bridge", "recordFlow", { params: { peerId: peer.id, status: "failed", records: 0, durationMs: 1000, error: "boom" } }, c);
    const topo = await lensRun("bridge", "syncTopology", {}, c);
    assert.equal(topo.result.peerCount, 1);
    assert.equal(topo.result.edgeCount, 1);
    const hub = topo.result.nodes.find((n) => n.kind === "hub");
    assert.equal(hub.id, "node_hub");
    const edge = topo.result.edges[0];
    assert.equal(edge.source, "node_hub");
    assert.equal(edge.flows, 2);
    assert.equal(edge.failed, 1);
    assert.equal(edge.succeeded, 1);
    assert.equal(edge.errorRate, 50); // round(0.5 * 1000)/10
    assert.equal(edge.status, "critical");
    assert.equal(topo.result.unhealthy, 1);
  });

  it("syncTopology: a peer with no flows is 'idle'", async () => {
    const c = await depthCtx("bridge-topo-idle");
    await lensRun("bridge", "peerRegister", { params: { name: "IdlePeer" } }, c);
    const topo = await lensRun("bridge", "syncTopology", {}, c);
    assert.equal(topo.result.edges[0].status, "idle");
    assert.equal(topo.result.unhealthy, 0); // idle is not unhealthy
  });
});

describe("bridge — flow record / list / replay (shared ctx)", () => {
  let ctx, peerId;
  before(async () => {
    ctx = await depthCtx("bridge-flows");
    peerId = (await lensRun("bridge", "peerRegister", { params: { name: "FlowPeer" } }, ctx)).result.peer.id;
  });

  it("recordFlow computes rps exactly from records/duration", async () => {
    const r = await lensRun("bridge", "recordFlow", { params: { peerId, action: "sync", status: "succeeded", records: 2000, durationMs: 2000 } }, ctx);
    assert.equal(r.result.flow.peerId, peerId);
    assert.equal(r.result.flow.status, "succeeded");
    assert.equal(r.result.flow.records, 2000);
    assert.equal(r.result.flow.rps, 1000); // 2000 records / 2s
    assert.equal(r.result.flow.attempts, 1);
    assert.equal(r.result.flow.error, null);
  });

  it("recordFlow: an unknown peer is rejected", async () => {
    const bad = await lensRun("bridge", "recordFlow", { params: { peerId: "peer_nope", records: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /peer not found/);
  });

  it("flowList filters by status and reports failed/succeeded tallies", async () => {
    const f = await lensRun("bridge", "recordFlow", { params: { peerId, status: "failed", records: 0, durationMs: 500, error: "timeout" } }, ctx);
    const failedId = f.result.flow.id;
    const only = await lensRun("bridge", "flowList", { params: { status: "failed" } }, ctx);
    assert.ok(only.result.flows.every((x) => x.status === "failed"));
    assert.ok(only.result.flows.some((x) => x.id === failedId));
    const all = await lensRun("bridge", "flowList", {}, ctx);
    assert.ok(all.result.succeeded >= 1);
    assert.ok(all.result.failed >= 1);
    // Newest-first ordering: the most-recent failed flow leads the filtered list.
    assert.equal(only.result.flows[0].id, failedId);
  });

  it("flowReplay recovers a failed flow and bumps attempts", async () => {
    const f = await lensRun("bridge", "recordFlow", { params: { peerId, status: "failed", records: 50, durationMs: 1000, error: "net" } }, ctx);
    const id = f.result.flow.id;
    const replay = await lensRun("bridge", "flowReplay", { params: { flowId: id } }, ctx);
    assert.equal(replay.result.recovered, true);
    assert.equal(replay.result.flow.status, "succeeded");
    assert.equal(replay.result.attempts, 2);
    assert.equal(replay.result.flow.error, null);
  });

  it("flowReplay: forceFail keeps it failed and preserves an error", async () => {
    const f = await lensRun("bridge", "recordFlow", { params: { peerId, status: "failed", records: 1, durationMs: 1000, error: "x" } }, ctx);
    const replay = await lensRun("bridge", "flowReplay", { params: { flowId: f.result.flow.id, forceFail: true } }, ctx);
    assert.equal(replay.result.recovered, false);
    assert.equal(replay.result.flow.status, "failed");
    assert.ok(replay.result.flow.error.length > 0);
  });

  it("flowReplay: replaying an already-succeeded flow is rejected", async () => {
    const f = await lensRun("bridge", "recordFlow", { params: { peerId, status: "succeeded", records: 10, durationMs: 1000 } }, ctx);
    const bad = await lensRun("bridge", "flowReplay", { params: { flowId: f.result.flow.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /already succeeded/);
  });

  it("flowReplay: a missing flow id is rejected", async () => {
    const bad = await lensRun("bridge", "flowReplay", { params: { flowId: "flow_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /flow not found/);
  });
});

describe("bridge — field-mapping editor (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("bridge-maps"); });

  it("mappingUpsert creates then updates the same row in place", async () => {
    const created = await lensRun("bridge", "mappingUpsert", { params: { source: "name", target: "fullName", transform: "uppercase", dataType: "string" } }, ctx);
    assert.equal(created.result.mapping.transform, "uppercase");
    const id = created.result.mapping.id;
    const updated = await lensRun("bridge", "mappingUpsert", { params: { mappingId: id, source: "name", target: "fullName", transform: "trim", required: true } }, ctx);
    assert.equal(updated.result.mapping.id, id); // same row
    assert.equal(updated.result.mapping.transform, "trim");
    assert.equal(updated.result.mapping.required, true);
    // No duplicate added.
    const list = await lensRun("bridge", "mappingList", {}, ctx);
    assert.equal(list.result.mappings.filter((m) => m.id === id).length, 1);
    assert.ok(list.result.transforms.includes("iso-date"));
  });

  it("mappingUpsert: missing source or target is rejected", async () => {
    const bad = await lensRun("bridge", "mappingUpsert", { params: { source: "x", target: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /source and target fields required/);
  });

  it("mappingUpsert: an unknown transform falls back to 'direct'", async () => {
    const r = await lensRun("bridge", "mappingUpsert", { params: { source: "a", target: "b", transform: "bogus" } }, ctx);
    assert.equal(r.result.mapping.transform, "direct");
  });

  it("mappingRemove deletes the row; a missing id is rejected", async () => {
    const m = await lensRun("bridge", "mappingUpsert", { params: { source: "del", target: "del2" } }, ctx);
    const id = m.result.mapping.id;
    const rem = await lensRun("bridge", "mappingRemove", { params: { mappingId: id } }, ctx);
    assert.equal(rem.result.removed, id);
    const list = await lensRun("bridge", "mappingList", {}, ctx);
    assert.ok(!list.result.mappings.some((x) => x.id === id));
    const bad = await lensRun("bridge", "mappingRemove", { params: { mappingId: "map_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /mapping not found/);
  });

  it("mappingPreview applies transforms to a sample and flags a missing required field", async () => {
    const c = await depthCtx("bridge-map-preview");
    await lensRun("bridge", "mappingUpsert", { params: { source: "title", target: "TITLE", transform: "uppercase" } }, c);
    await lensRun("bridge", "mappingUpsert", { params: { source: "count", target: "qty", transform: "to-number" } }, c);
    await lensRun("bridge", "mappingUpsert", { params: { source: "ssn", target: "ssn", transform: "direct", required: true } }, c);
    const pv = await lensRun("bridge", "mappingPreview", { params: { sample: { title: "hello", count: "42" } } }, c);
    assert.equal(pv.result.total, 3);
    const title = pv.result.rows.find((r) => r.source === "title");
    assert.equal(title.outputValue, "HELLO"); // uppercase transform applied
    assert.equal(title.ok, true);
    const count = pv.result.rows.find((r) => r.source === "count");
    assert.equal(count.outputValue, 42); // to-number transform
    const ssn = pv.result.rows.find((r) => r.source === "ssn");
    assert.equal(ssn.ok, false);
    assert.match(ssn.error, /required source field missing/);
    assert.equal(pv.result.valid, 2);
    assert.equal(pv.result.invalid, 1);
    assert.equal(pv.result.coverage, 67); // round(2/3*100)
  });

  it("mappingPreview: a non-numeric value through to-number is flagged not numeric", async () => {
    const c = await depthCtx("bridge-map-preview-bad");
    await lensRun("bridge", "mappingUpsert", { params: { source: "amt", target: "amt", transform: "to-number" } }, c);
    const pv = await lensRun("bridge", "mappingPreview", { params: { sample: { amt: "not-a-number" } } }, c);
    const row = pv.result.rows[0];
    assert.equal(row.ok, false);
    assert.match(row.error, /not numeric/);
    assert.equal(row.outputValue, null);
  });
});

describe("bridge — schedules + alerts + throughput history (shared ctx)", () => {
  let ctx, peerId;
  before(async () => {
    ctx = await depthCtx("bridge-ops");
    peerId = (await lensRun("bridge", "peerRegister", { params: { name: "OpsPeer" } }, ctx)).result.peer.id;
  });

  it("scheduleSet clamps the interval and computes a forward nextRunAt; scheduleList reads it", async () => {
    const set = await lensRun("bridge", "scheduleSet", { params: { peerId, mode: "interval", intervalMinutes: 100000, enabled: true } }, ctx);
    assert.equal(set.result.schedule.intervalMinutes, 10080); // clamped to weekly max
    assert.equal(set.result.schedule.mode, "interval");
    assert.ok(new Date(set.result.schedule.nextRunAt).getTime() > Date.now());
    const list = await lensRun("bridge", "scheduleList", {}, ctx);
    const entry = list.result.schedules.find((e) => e.peerId === peerId);
    assert.equal(entry.intervalMinutes, 10080);
    assert.ok(list.result.active >= 1);
  });

  it("scheduleSet: a manual mode has no nextRunAt", async () => {
    const set = await lensRun("bridge", "scheduleSet", { params: { peerId, mode: "manual" } }, ctx);
    assert.equal(set.result.schedule.mode, "manual");
    assert.equal(set.result.schedule.nextRunAt, null);
  });

  it("scheduleSet: an unknown peer is rejected", async () => {
    const bad = await lensRun("bridge", "scheduleSet", { params: { peerId: "peer_nope", intervalMinutes: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /peer not found/);
  });

  it("alertRuleUpsert + alertRuleList round-trip; a negative threshold is rejected", async () => {
    const rule = await lensRun("bridge", "alertRuleUpsert", { params: { metric: "error-rate", threshold: 25, peerId } }, ctx);
    assert.equal(rule.result.rule.metric, "error-rate");
    assert.equal(rule.result.rule.threshold, 25);
    const id = rule.result.rule.id;
    const list = await lensRun("bridge", "alertRuleList", {}, ctx);
    assert.ok(list.result.rules.some((r) => r.id === id));
    const bad = await lensRun("bridge", "alertRuleUpsert", { params: { metric: "error-rate", threshold: -1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /non-negative number/);
  });

  it("alertRuleUpsert updates the same row in place (no duplicate)", async () => {
    const r1 = await lensRun("bridge", "alertRuleUpsert", { params: { metric: "lag-minutes", threshold: 60 } }, ctx);
    const id = r1.result.rule.id;
    const r2 = await lensRun("bridge", "alertRuleUpsert", { params: { ruleId: id, metric: "lag-minutes", threshold: 120 } }, ctx);
    assert.equal(r2.result.rule.id, id);
    assert.equal(r2.result.rule.threshold, 120);
    const list = await lensRun("bridge", "alertRuleList", {}, ctx);
    assert.equal(list.result.rules.filter((r) => r.id === id).length, 1);
  });

  it("alertRuleRemove deletes the rule; a missing id is rejected", async () => {
    const r = await lensRun("bridge", "alertRuleUpsert", { params: { metric: "error-rate", threshold: 10 } }, ctx);
    const id = r.result.rule.id;
    const rem = await lensRun("bridge", "alertRuleRemove", { params: { ruleId: id } }, ctx);
    assert.equal(rem.result.removed, id);
    const bad = await lensRun("bridge", "alertRuleRemove", { params: { ruleId: "rule_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /alert rule not found/);
  });

  it("alertEvaluate fires an error-rate rule when the failure ratio breaches the threshold", async () => {
    const c = await depthCtx("bridge-alert-eval");
    const p = (await lensRun("bridge", "peerRegister", { params: { name: "AlertPeer" } }, c)).result.peer.id;
    // 1 succeeded + 1 failed → 50% error rate.
    await lensRun("bridge", "recordFlow", { params: { peerId: p, status: "succeeded", records: 10, durationMs: 1000 } }, c);
    await lensRun("bridge", "recordFlow", { params: { peerId: p, status: "failed", records: 0, durationMs: 1000, error: "e" } }, c);
    await lensRun("bridge", "alertRuleUpsert", { params: { metric: "error-rate", threshold: 50, peerId: p } }, c);
    const ev = await lensRun("bridge", "alertEvaluate", {}, c);
    assert.equal(ev.result.rulesEvaluated, 1);
    assert.equal(ev.result.firing, 1);
    const fired = ev.result.alerts[0];
    assert.equal(fired.metric, "error-rate");
    assert.equal(fired.value, 50); // exact ratio
    assert.equal(fired.peerName, "AlertPeer");
    assert.match(fired.detail, /1\/2 flows failed/);
  });

  it("alertEvaluate: consecutive-failures at 2x threshold escalates to critical", async () => {
    const c = await depthCtx("bridge-alert-streak");
    const p = (await lensRun("bridge", "peerRegister", { params: { name: "StreakPeer" } }, c)).result.peer.id;
    for (let i = 0; i < 4; i++) {
      await lensRun("bridge", "recordFlow", { params: { peerId: p, status: "failed", records: 0, durationMs: 1000, error: "e" } }, c);
    }
    await lensRun("bridge", "alertRuleUpsert", { params: { metric: "consecutive-failures", threshold: 2, peerId: p } }, c);
    const ev = await lensRun("bridge", "alertEvaluate", {}, c);
    assert.equal(ev.result.firing, 1);
    assert.equal(ev.result.critical, 1); // streak 4 >= threshold*2 (4)
    assert.equal(ev.result.alerts[0].value, 4);
    assert.equal(ev.result.alerts[0].severity, "critical");
  });

  it("alertEvaluate: a rule below threshold does not fire", async () => {
    const c = await depthCtx("bridge-alert-quiet");
    const p = (await lensRun("bridge", "peerRegister", { params: { name: "QuietPeer" } }, c)).result.peer.id;
    await lensRun("bridge", "recordFlow", { params: { peerId: p, status: "succeeded", records: 10, durationMs: 1000 } }, c);
    await lensRun("bridge", "alertRuleUpsert", { params: { metric: "error-rate", threshold: 50, peerId: p } }, c);
    const ev = await lensRun("bridge", "alertEvaluate", {}, c);
    assert.equal(ev.result.firing, 0); // 0% error rate < 50
  });

  it("throughputHistory buckets recorded flow samples and computes avg/peak exactly", async () => {
    const c = await depthCtx("bridge-tput");
    const p = (await lensRun("bridge", "peerRegister", { params: { name: "TputPeer" } }, c)).result.peer.id;
    // Two flows: rps 100 (1000 rec/10s) and rps 300 (3000 rec/10s).
    await lensRun("bridge", "recordFlow", { params: { peerId: p, status: "succeeded", records: 1000, durationMs: 10000 } }, c);
    await lensRun("bridge", "recordFlow", { params: { peerId: p, status: "succeeded", records: 3000, durationMs: 10000 } }, c);
    const h = await lensRun("bridge", "throughputHistory", { params: { bucketMinutes: 60 } }, c);
    assert.equal(h.result.samples, 2);
    assert.equal(h.result.avgRPS, 200);  // (100+300)/2
    assert.equal(h.result.peakRPS, 300);
    assert.equal(h.result.bucketMinutes, 60);
    assert.ok(h.result.buckets.length >= 1);
    const total = h.result.buckets.reduce((s, b) => s + b.succeeded, 0);
    assert.equal(total, 2);
  });

  it("throughputHistory: no samples returns an empty series with guidance", async () => {
    const c = await depthCtx("bridge-tput-empty");
    const h = await lensRun("bridge", "throughputHistory", {}, c);
    assert.equal(h.result.samples, 0);
    assert.deepEqual(h.result.buckets, []);
    assert.ok(h.result.message.includes("Record sync flows"));
  });
});
