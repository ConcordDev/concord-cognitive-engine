// server/tests/bridge-build.test.js
//
// Bridge full lens build (B2, GB-1088 backlog) — pins, against the REAL
// registry handlers in server/domains/bridge.js:
//   S1/F1  the four Actions verbs derive from the Federation Console's own
//          state when no artifact carries data (peer + recorded flows are
//          the connection), and still prefer artifact data when present
//   S2/F2  flowRemove deletes a flow and its throughput samples; peerRemove
//          cascades the peer's flows and reports the count
import test from "node:test";
import assert from "node:assert/strict";
import registerBridgeActions from "../domains/bridge.js";

function makeRegistry() {
  const actions = new Map();
  registerBridgeActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  return actions;
}
const ctx = { actor: { userId: "bridge-build-user" } };

test("S1: the four Actions verbs run on console state with no artifact", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, params = {}, artifact = undefined) => a.get(`bridge.${name}`)(ctx, artifact, params);

  await run("peerRegister", { name: "Peer A" });
  const peers = (await run("peerList")).result.peers;
  const peerId = peers[0].id;
  await run("recordFlow", { peerId, records: 1000, durationMs: 1000, status: "succeeded" });
  await run("recordFlow", { peerId, records: 500, durationMs: 2000, status: "failed", error: "sync error" });
  await run("mappingUpsert", { source: "first_name", target: "firstName", transform: "trim" });

  // Connection Health: one connection (the peer), scored from its flows —
  // latency is the mean duration (1000+2000)/2, error rate 1/2.
  const health = (await run("connectionHealth")).result;
  assert.equal(health.totalConnections, 1);
  assert.equal(health.connections[0].name, "Peer A");
  assert.equal(health.connections[0].latencyMs, 1500);
  assert.equal(health.connections[0].errorRate, 0.5);

  // Data Mapping: the console's mapping, analyzed.
  const mapping = (await run("dataMapping")).result;
  assert.equal(mapping.total, 1);
  assert.equal(mapping.coverage, 100);
  assert.equal(mapping.mappings[0].sourceField, "first_name");

  // Sync Status: flows are the syncs — 1500 records, the failed flow's 500
  // are errors, and there HAS been a sync.
  const sync = (await run("syncStatus")).result;
  assert.equal(sync.totalSyncs, 2);
  assert.equal(sync.totalRecordsProcessed, 1500);
  assert.equal(sync.totalErrors, 500);
  assert.notEqual(sync.lastSync, "never");

  // Throughput: the recorded samples (1000 rps and 250 rps).
  const tp = (await run("throughputAnalysis")).result;
  assert.equal(tp.dataPoints, 2);
  assert.equal(tp.peakRPS, 1000);
  assert.equal(tp.avgRPS, 625);
});

test("S1: artifact data, when present, still wins over console state", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, params = {}, artifact = undefined) => a.get(`bridge.${name}`)(ctx, artifact, params);
  await run("peerRegister", { name: "Console Peer" });
  const artifact = { data: { connections: [{ name: "Artifact Conn", latencyMs: 10, uptimePercent: 100, errorRate: 0 }] } };
  const health = (await run("connectionHealth", {}, artifact)).result;
  assert.equal(health.totalConnections, 1);
  assert.equal(health.connections[0].name, "Artifact Conn");
});

test("S2: flowRemove deletes the flow and its samples; peerRemove cascades", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, params = {}) => a.get(`bridge.${name}`)(ctx, undefined, params);

  await run("peerRegister", { name: "Peer B" });
  const peerId = (await run("peerList")).result.peers[0].id;
  const f1 = (await run("recordFlow", { peerId, records: 100, durationMs: 1000, status: "succeeded" })).result.flow;
  await run("recordFlow", { peerId, records: 50, durationMs: 1000, status: "failed" });

  const removed = (await run("flowRemove", { flowId: f1.id })).result;
  assert.equal(removed.totalFlows, 1);
  assert.equal(removed.succeeded, 0);
  assert.equal(removed.failed, 1);
  const list = (await run("flowList")).result;
  assert.equal(list.total, 1);
  // The removed flow's throughput sample went with it.
  const hist = (await run("throughputHistory")).result;
  assert.equal(hist.samples, 1);
  const missing = await run("flowRemove", { flowId: f1.id });
  assert.equal(missing.ok, false);

  // Deleting the peer cascades its remaining flow and reports the count.
  const peerGone = (await run("peerRemove", { peerId })).result;
  assert.equal(peerGone.flowsRemoved, 1);
  const after = (await run("flowList")).result;
  assert.equal(after.total, 0);
  assert.equal(after.failed, 0);
  assert.equal(after.succeeded, 0);
});
