// FIX-queue-004 — a job can be edited once it exists (including after
// it has been processed), and a completed job can be requeued to run
// again. Before: no update macro existed at all, and retry accepted
// only failed/dead — a completed job was a dead end.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerQueueActions from "../domains/queue.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`queue.${name}`);
  if (!fn) throw new Error(`queue.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerQueueActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function completedJob() {
  const e = call("enqueue", ctxA, { name: "ingest-file", payload: { file: "a.csv" } });
  const id = e.result.job.id;
  const p = call("process", ctxA, { jobId: id });
  assert.equal(p.result.processed.status, "completed");
  return id;
}

describe("queue update + requeue (FIX-queue-004)", () => {
  it("edits a completed job's name, priority, payload and maxAttempts", () => {
    const id = completedJob();
    const u = call("update", ctxA, { jobId: id, name: "ingest-file-v2", priority: "high", payload: { file: "b.csv" }, maxAttempts: 5 });
    assert.equal(u.ok, true);
    assert.equal(u.result.job.name, "ingest-file-v2");
    assert.equal(u.result.job.priority, "high");
    assert.deepEqual(u.result.job.payload, { file: "b.csv" });
    assert.equal(u.result.job.maxAttempts, 5);
    // Editing never resurrects or moves the job on its own.
    assert.equal(u.result.job.status, "completed");
  });

  it("requeues a completed job back to pending with its result cleared", () => {
    const id = completedJob();
    const r = call("retry", ctxA, { jobId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.status, "pending");
    assert.equal(r.result.job.result, null);
    const p = call("process", ctxA, { jobId: id });
    assert.equal(p.result.processed.status, "completed");
    assert.equal(p.result.processed.attempts, 2);
  });

  it("rejects bad edits and another user's job", () => {
    const id = completedJob();
    assert.equal(call("update", ctxA, { jobId: id, priority: "ultra" }).ok, false);
    assert.equal(call("update", ctxA, { jobId: id, payload: [1, 2] }).ok, false);
    assert.equal(call("update", ctxA, { jobId: id, name: "  " }).ok, false);
    assert.equal(call("update", ctxA, { jobId: id }).ok, false);
    assert.equal(call("update", ctxB, { jobId: id, name: "hijack" }).ok, false);
    assert.equal(call("retry", ctxB, { jobId: id }).ok, false);
  });
});
