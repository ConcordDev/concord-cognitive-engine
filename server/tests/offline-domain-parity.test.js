// Contract tests for server/domains/offline.js — pure-compute sync math
// (CRDT/LWW conflict resolution, cache strategy, delta diff) plus the
// stateful PouchDB-style replication substrate (changes feed, checkpoints,
// conflict detection, merge resolution) and the Workbox precache manifest.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOfflineActions from "../domains/offline.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`offline.${name}`);
  if (!fn) throw new Error(`offline.${name} not registered`);
  // The /api/lens/run route passes `input` as BOTH artifact.data and params.
  const artifact = { id: null, domain: "offline", type: "domain_action", data: input, meta: {} };
  return fn(ctx, artifact, input);
}

before(() => { registerOfflineActions(register); });

// Fresh in-memory STATE per test so replication is isolated.
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("offline.syncConflict (CRDT / LWW)", () => {
  it("resolves an LWW conflict using vector clocks", () => {
    const r = call("syncConflict", ctxA, {
      replicas: [
        { replicaId: "a", state: { x: { value: 1, timestamp: 100, vectorClock: { a: 2, b: 1 } } } },
        { replicaId: "b", state: { x: { value: 2, timestamp: 200, vectorClock: { a: 1, b: 2 } } } },
      ],
      strategy: "lww",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.strategy, "lww");
    assert.equal(r.result.summary.conflictCount, 1);
    assert.ok(["lww: replica a wins", "lww: replica b wins"].includes(r.result.conflicts[0].resolution));
  });

  it("needs at least 2 replicas", () => {
    const r = call("syncConflict", ctxA, { replicas: [{ replicaId: "a", state: {} }] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2 replicas/);
  });
});

describe("offline.cacheStrategy", () => {
  it("scores hot/cold split and recommends an eviction policy", () => {
    const log = [];
    for (let i = 0; i < 30; i++) log.push({ key: "hot", timestamp: new Date(1000 + i * 1000).toISOString() });
    for (let i = 0; i < 3; i++) log.push({ key: `cold${i}`, timestamp: new Date(2000 + i * 5000).toISOString() });
    const r = call("cacheStrategy", ctxA, { accessLog: log, cacheCapacity: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.hotColdSplit.hotCount >= 1);
    assert.ok(["LRU", "LFU"].includes(r.result.evictionPolicy.recommended));
  });

  it("handles an empty access log", () => {
    const r = call("cacheStrategy", ctxA, { accessLog: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No access log/);
  });
});

describe("offline.deltaCompute", () => {
  it("diffs two states and estimates bandwidth", () => {
    const r = call("deltaCompute", ctxA, {
      baseState: { a: 1, b: 2 },
      currentState: { a: 1, b: 9, c: 3 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.changes.added, 1);
    assert.equal(r.result.changes.modified, 1);
    assert.equal(r.result.changes.unchanged, 1);
    assert.ok(r.result.bandwidth.networkEstimates["4g"]);
  });
});

describe("offline.swManifest (Workbox precache)", () => {
  it("returns a precache + runtime caching plan", () => {
    const r = call("swManifest", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.cacheName, "concord-v2");
    assert.ok(Array.isArray(r.result.precache));
    assert.ok(r.result.precache.length > 0);
    assert.ok(Array.isArray(r.result.runtimeCaching));
    assert.equal(r.result.backgroundSyncTag, "concord-mutation-sync");
  });
});

describe("offline.replication{Push,Pull,Status} (changes feed)", () => {
  it("pushes docs, bumps update_seq, and pulls them back", () => {
    const push = call("replicationPush", ctxA, {
      docs: [
        { id: "note:1", body: { title: "first" } },
        { id: "note:2", body: { title: "second" } },
      ],
    });
    assert.equal(push.ok, true);
    assert.equal(push.result.appliedCount, 2);
    assert.equal(push.result.conflictCount, 0);
    assert.equal(push.result.updateSeq, 2);

    const status = call("replicationStatus", ctxA, {});
    assert.equal(status.ok, true);
    assert.equal(status.result.docCount, 2);
    assert.equal(status.result.updateSeq, 2);

    const pull = call("replicationPull", ctxA, { since: 0 });
    assert.equal(pull.ok, true);
    assert.equal(pull.result.changes.length, 2);
    assert.equal(pull.result.lastSeq, 2);
    assert.deepEqual(pull.result.changes[0].doc, { title: "first" });
  });

  it("does an incremental pull after a checkpoint", () => {
    call("replicationPush", ctxA, { docs: [{ id: "a", body: { v: 1 } }] });
    const first = call("replicationPull", ctxA, { since: 0 });
    assert.equal(first.result.changes.length, 1);
    call("replicationPush", ctxA, { docs: [{ id: "b", body: { v: 2 } }] });
    const incremental = call("replicationPull", ctxA, { since: first.result.lastSeq });
    assert.equal(incremental.result.changes.length, 1);
    assert.equal(incremental.result.changes[0].id, "b");
  });

  it("isolates replication per user", () => {
    call("replicationPush", ctxA, { docs: [{ id: "x", body: { owner: "a" } }] });
    const bStatus = call("replicationStatus", ctxB, {});
    assert.equal(bStatus.result.docCount, 0);
  });

  it("rejects an empty or oversized push batch", () => {
    assert.equal(call("replicationPush", ctxA, { docs: [] }).ok, false);
    const big = Array.from({ length: 501 }, (_, i) => ({ id: `d${i}`, body: {} }));
    assert.equal(call("replicationPush", ctxA, { docs: big }).ok, false);
  });
});

describe("offline.replicationPush conflict detection", () => {
  it("flags a rev-mismatch conflict and holds the branch", () => {
    const first = call("replicationPush", ctxA, { docs: [{ id: "doc:1", body: { v: 1 } }] });
    const rev1 = first.result.applied[0].rev;
    // A second client pushes with a STALE baseRev — must conflict.
    const conflict = call("replicationPush", ctxA, {
      docs: [{ id: "doc:1", body: { v: 99 }, baseRev: "1-deadbeef" }],
    });
    assert.equal(conflict.ok, true);
    assert.equal(conflict.result.conflictCount, 1);
    assert.equal(conflict.result.conflicts[0].id, "doc:1");
    assert.equal(conflict.result.conflicts[0].serverRev, rev1);
    assert.equal(conflict.result.conflicts[0].reason, "rev_mismatch");
  });

  it("accepts a push that branches from the current rev", () => {
    const first = call("replicationPush", ctxA, { docs: [{ id: "doc:2", body: { v: 1 } }] });
    const ok = call("replicationPush", ctxA, {
      docs: [{ id: "doc:2", body: { v: 2 }, baseRev: first.result.applied[0].rev }],
    });
    assert.equal(ok.result.conflictCount, 0);
    assert.equal(ok.result.appliedCount, 1);
  });
});

describe("offline.mergeResolve", () => {
  it("commits the merged body as a new revision", () => {
    call("replicationPush", ctxA, { docs: [{ id: "m:1", body: { side: "server" } }] });
    const r = call("mergeResolve", ctxA, {
      id: "m:1",
      winner: "merged",
      mergedBody: { side: "merged", merged: true },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "merged");
    assert.deepEqual(r.result.resolvedBody, { side: "merged", merged: true });
    const status = call("replicationStatus", ctxA, {});
    assert.equal(status.result.docCount, 1);
  });

  it("keeps the server body when winner=server", () => {
    call("replicationPush", ctxA, { docs: [{ id: "m:2", body: { keep: "server" } }] });
    const r = call("mergeResolve", ctxA, { id: "m:2", winner: "server" });
    assert.deepEqual(r.result.resolvedBody, { keep: "server" });
  });

  it("rejects a missing doc id", () => {
    assert.equal(call("mergeResolve", ctxA, { winner: "server" }).ok, false);
  });
});

describe("offline.syncCheckpoint", () => {
  it("saves and reads back a replication checkpoint", () => {
    const saved = call("syncCheckpoint", ctxA, { replicationId: "repl-1", seq: 42 });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.saved, true);
    assert.equal(saved.result.seq, 42);
    const read = call("syncCheckpoint", ctxA, { replicationId: "repl-1" });
    assert.equal(read.result.saved, false);
    assert.equal(read.result.seq, 42);
  });

  it("returns seq 0 for an unknown checkpoint", () => {
    const r = call("syncCheckpoint", ctxA, { replicationId: "never-seen" });
    assert.equal(r.ok, true);
    assert.equal(r.result.seq, 0);
  });
});

describe("offline.backoffSchedule", () => {
  it("produces an exponential schedule with a jitter band", () => {
    const r = call("backoffSchedule", ctxA, { attempt: 0, baseMs: 1000, capMs: 60000, maxAttempts: 8 });
    assert.equal(r.ok, true);
    assert.equal(r.result.schedule.length, 8);
    assert.equal(r.result.schedule[0].baseDelayMs, 1000);
    assert.equal(r.result.schedule[1].baseDelayMs, 2000);
    assert.equal(r.result.schedule[2].baseDelayMs, 4000);
    assert.ok(r.result.schedule[0].minDelayMs <= 1000);
    assert.ok(r.result.schedule[0].maxDelayMs >= 1000);
    assert.equal(r.result.exhausted, false);
  });

  it("caps the delay and reports exhaustion", () => {
    const r = call("backoffSchedule", ctxA, { attempt: 10, baseMs: 1000, capMs: 5000, maxAttempts: 4 });
    assert.equal(r.result.exhausted, true);
    for (const e of r.result.schedule) assert.ok(e.baseDelayMs <= 5000);
  });
});
