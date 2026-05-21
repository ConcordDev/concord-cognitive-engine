// Contract tests for server/domains/bridge.js — the ops-grade cross-world
// federation console layer: sync topology, per-flow retry/replay,
// field-mapping editor, per-peer schedules, alerting, throughput history.
//
// Every macro exercised here is wired to a real control in the bridge lens
// (concord-frontend/components/bridge/FederationConsole.tsx).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBridgeActions from "../domains/bridge.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`bridge.${name}`);
  if (!fn) throw new Error(`bridge.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerBridgeActions(register); });

const ctx = { actor: { userId: "bridge_test_user" }, userId: "bridge_test_user" };

// Each test run gets an isolated per-user state slice.
beforeEach(() => {
  const STATE = globalThis._concordSTATE;
  if (STATE && STATE.bridgeLens) {
    for (const k of ["peers", "flows", "mappings", "schedules", "alertRules", "throughput"]) {
      STATE.bridgeLens[k]?.delete?.(ctx.userId);
    }
  }
});

/* ── helper: register a peer and return its id ── */
function newPeer(name = "Tunya") {
  const r = call("peerRegister", ctx, { name, kind: "world", region: "tunya" });
  assert.equal(r.ok, true, `peerRegister ${name}: ${r.error}`);
  return r.result.peer.id;
}

describe("bridge — peer registry", () => {
  it("registers, lists and removes peers", () => {
    const id = newPeer("Sovereign Ruins");
    const list = call("peerList", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    const rm = call("peerRemove", ctx, { peerId: id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.totalPeers, 0);
  });

  it("rejects a duplicate peer name and a blank name", () => {
    newPeer("Cyber");
    assert.equal(call("peerRegister", ctx, { name: "Cyber" }).ok, false);
    assert.equal(call("peerRegister", ctx, { name: "" }).ok, false);
  });
});

describe("bridge.syncTopology — visual sync graph", () => {
  it("returns a hub + spoke node per peer with edges", () => {
    const id = newPeer("Crime");
    call("recordFlow", ctx, { peerId: id, action: "sync", records: 100, status: "succeeded" });
    const r = call("syncTopology", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.peerCount, 1);
    assert.equal(r.result.edgeCount, 1);
    assert.ok(r.result.nodes.some(n => n.kind === "hub"));
    assert.equal(r.result.edges[0].flows, 1);
  });

  it("marks an edge critical when most flows fail", () => {
    const id = newPeer("Fantasy");
    call("recordFlow", ctx, { peerId: id, status: "failed", error: "timeout" });
    call("recordFlow", ctx, { peerId: id, status: "failed", error: "timeout" });
    const r = call("syncTopology", ctx, {});
    assert.equal(r.result.edges[0].status, "critical");
    assert.equal(r.result.unhealthy, 1);
  });
});

describe("bridge.recordFlow / flowList / flowReplay — per-flow retry", () => {
  it("records flows and filters by status", () => {
    const id = newPeer("Lattice");
    call("recordFlow", ctx, { peerId: id, status: "succeeded", records: 50 });
    call("recordFlow", ctx, { peerId: id, status: "failed", error: "boom" });
    const all = call("flowList", ctx, {});
    assert.equal(all.ok, true);
    assert.equal(all.result.total, 2);
    const failed = call("flowList", ctx, { status: "failed" });
    assert.equal(failed.result.total, 1);
  });

  it("replays a failed flow back to succeeded and bumps attempts", () => {
    const id = newPeer("Hub-A");
    const rec = call("recordFlow", ctx, { peerId: id, status: "failed", error: "net" });
    const fid = rec.result.flow.id;
    const replay = call("flowReplay", ctx, { flowId: fid });
    assert.equal(replay.ok, true);
    assert.equal(replay.result.recovered, true);
    assert.equal(replay.result.attempts, 2);
  });

  it("refuses to replay an already-succeeded flow", () => {
    const id = newPeer("Hub-B");
    const rec = call("recordFlow", ctx, { peerId: id, status: "succeeded" });
    const r = call("flowReplay", ctx, { flowId: rec.result.flow.id });
    assert.equal(r.ok, false);
  });
});

describe("bridge.mapping* — field-mapping editor", () => {
  it("upserts, lists and removes a mapping", () => {
    const up = call("mappingUpsert", ctx, { source: "first_name", target: "given", transform: "trim" });
    assert.equal(up.ok, true);
    const list = call("mappingList", ctx, {});
    assert.equal(list.result.total, 1);
    assert.ok(list.result.transforms.includes("uppercase"));
    const rm = call("mappingRemove", ctx, { mappingId: up.result.mapping.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.total, 0);
  });

  it("rejects a mapping without source/target", () => {
    assert.equal(call("mappingUpsert", ctx, { source: "x" }).ok, false);
  });

  it("previews transforms against a sample record", () => {
    call("mappingUpsert", ctx, { source: "name", target: "label", transform: "uppercase" });
    call("mappingUpsert", ctx, { source: "age", target: "years", transform: "to-number" });
    const r = call("mappingPreview", ctx, { sample: { name: "ada", age: "37" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.coverage, 100);
    const nameRow = r.result.rows.find(x => x.source === "name");
    assert.equal(nameRow.outputValue, "ADA");
  });

  it("flags a missing required source field in preview", () => {
    call("mappingUpsert", ctx, { source: "ssn", target: "id", required: true });
    const r = call("mappingPreview", ctx, { sample: {} });
    assert.equal(r.result.invalid, 1);
    assert.ok(r.result.rows[0].error);
  });
});

describe("bridge.schedule* — per-peer sync schedules", () => {
  it("sets and lists a schedule with a computed next-run", () => {
    const id = newPeer("Cron-Peer");
    const set = call("scheduleSet", ctx, { peerId: id, mode: "interval", intervalMinutes: 30 });
    assert.equal(set.ok, true);
    assert.ok(set.result.schedule.nextRunAt);
    const list = call("scheduleList", ctx, {});
    assert.equal(list.result.total, 1);
    assert.equal(list.result.active, 1);
  });

  it("rejects a schedule for an unknown peer", () => {
    assert.equal(call("scheduleSet", ctx, { peerId: "nope" }).ok, false);
  });
});

describe("bridge.alert* — sync-failure / lag alerting", () => {
  it("creates, lists and removes an alert rule", () => {
    const up = call("alertRuleUpsert", ctx, { metric: "error-rate", threshold: 25 });
    assert.equal(up.ok, true);
    assert.equal(call("alertRuleList", ctx, {}).result.total, 1);
    const rm = call("alertRuleRemove", ctx, { ruleId: up.result.rule.id });
    assert.equal(rm.ok, true);
  });

  it("rejects a negative threshold", () => {
    assert.equal(call("alertRuleUpsert", ctx, { metric: "error-rate", threshold: -1 }).ok, false);
  });

  it("fires an alert when the error-rate threshold is breached", () => {
    const id = newPeer("Flaky-Peer");
    call("recordFlow", ctx, { peerId: id, status: "failed", error: "x" });
    call("recordFlow", ctx, { peerId: id, status: "failed", error: "x" });
    call("alertRuleUpsert", ctx, { metric: "error-rate", threshold: 50 });
    const r = call("alertEvaluate", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.firing, 1);
    assert.equal(r.result.alerts[0].metric, "error-rate");
  });

  it("does not fire when the threshold is not breached", () => {
    const id = newPeer("Stable-Peer");
    call("recordFlow", ctx, { peerId: id, status: "succeeded" });
    call("alertRuleUpsert", ctx, { metric: "consecutive-failures", threshold: 3 });
    const r = call("alertEvaluate", ctx, {});
    assert.equal(r.result.firing, 0);
  });
});

describe("bridge.throughputHistory — time-series charts", () => {
  it("buckets recorded flow samples into a time series", () => {
    const id = newPeer("Throughput-Peer");
    call("recordFlow", ctx, { peerId: id, records: 1000, durationMs: 1000, status: "succeeded" });
    call("recordFlow", ctx, { peerId: id, records: 2000, durationMs: 1000, status: "succeeded" });
    const r = call("throughputHistory", ctx, { bucketMinutes: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.samples, 2);
    assert.ok(r.result.buckets.length >= 1);
    assert.ok(r.result.peakRPS >= r.result.avgRPS);
  });

  it("returns an empty series with a hint when no flows exist", () => {
    const r = call("throughputHistory", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.samples, 0);
    assert.ok(r.result.message);
  });
});

describe("bridge — original compute macros still pass", () => {
  it("connectionHealth scores supplied connections", () => {
    const r = call("connectionHealth", ctx,
      { data: { connections: [{ name: "P1", latencyMs: 100, uptimePercent: 99, errorRate: 0 }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConnections, 1);
  });

  it("dataMapping, syncStatus and throughputAnalysis return ok", () => {
    assert.equal(call("dataMapping", ctx, { data: { mappings: [] } }, {}).ok, true);
    assert.equal(call("syncStatus", ctx, { data: { syncs: [] } }, {}).ok, true);
    assert.equal(call("throughputAnalysis", ctx, { data: { throughputMetrics: [] } }, {}).ok, true);
  });
});
