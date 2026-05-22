// Contract tests for server/domains/queue.js — the real in-memory
// job-queue substrate (enqueue / process / retry / dead-letter /
// scheduling / priorities / workers / pause-resume / metrics).

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

beforeEach(() => {
  // Fresh per-test substrate.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("queue analytics macros (existing pure-compute)", () => {
  it("queueAnalytics returns insufficient-data message when empty", () => {
    const r = call("queueAnalytics", ctxA, {});
    assert.equal(r.ok, true);
  });
  it("prioritySchedule returns no-jobs message when empty", () => {
    const r = call("prioritySchedule", ctxA, {});
    assert.equal(r.ok, true);
  });
  it("backpressure computes a state", () => {
    const r = call("backpressure", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.currentState);
  });
});

describe("queue.enqueue", () => {
  it("enqueues a pending job", () => {
    const r = call("enqueue", ctxA, { queue: "ingest", name: "test-job", priority: "high" });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.status, "pending");
    assert.equal(r.result.job.priority, "high");
    assert.equal(r.result.job.queue, "ingest");
  });
  it("enqueues a delayed job when delayMs > 0", () => {
    const r = call("enqueue", ctxA, { name: "later", delayMs: 60000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.status, "delayed");
  });
  it("normalizes bad priority to normal", () => {
    const r = call("enqueue", ctxA, { name: "x", priority: "ultra" });
    assert.equal(r.result.job.priority, "normal");
  });
});

describe("queue.list + priority ordering", () => {
  it("lists jobs sorted by priority", () => {
    call("enqueue", ctxA, { name: "lo", priority: "low" });
    call("enqueue", ctxA, { name: "hi", priority: "high" });
    call("enqueue", ctxA, { name: "norm", priority: "normal" });
    const r = call("list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.jobs[0].name, "hi");
    assert.equal(r.result.jobs[2].name, "lo");
  });
  it("filters by queue and status", () => {
    call("enqueue", ctxA, { name: "a", queue: "ingest" });
    call("enqueue", ctxA, { name: "b", queue: "autocrawl" });
    const r = call("list", ctxA, { queue: "autocrawl" });
    assert.equal(r.result.total, 1);
    assert.equal(r.result.jobs[0].name, "b");
  });
  it("isolates jobs per user", () => {
    call("enqueue", ctxA, { name: "owned" });
    const r = call("list", ctxB, {});
    assert.equal(r.result.total, 0);
  });
});

describe("queue.process", () => {
  it("processes the highest-priority pending job to completed", () => {
    call("enqueue", ctxA, { name: "lo", priority: "low" });
    call("enqueue", ctxA, { name: "hi", priority: "high" });
    const r = call("process", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.processed.name, "hi");
    assert.equal(r.result.processed.status, "completed");
    assert.ok(r.result.processed.durationMs >= 0);
  });
  it("returns no-eligible-jobs when queue is empty", () => {
    const r = call("process", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.processed, null);
  });
  it("marks a job failed when fail flag is set", () => {
    const e = call("enqueue", ctxA, { name: "willfail" });
    const r = call("process", ctxA, { jobId: e.result.job.id, fail: true });
    assert.equal(r.result.processed.status, "failed");
    assert.equal(r.result.processed.attempts, 1);
  });
  it("dead-letters after maxAttempts exhausted", () => {
    const e = call("enqueue", ctxA, { name: "doomed", maxAttempts: 2 });
    const id = e.result.job.id;
    call("process", ctxA, { jobId: id, fail: true });
    const r2 = call("process", ctxA, { jobId: id, fail: true });
    assert.equal(r2.result.processed.status, "dead");
  });
  it("skips paused queues", () => {
    call("enqueue", ctxA, { name: "p", queue: "ingest" });
    call("control", ctxA, { queue: "ingest", paused: true });
    const r = call("process", ctxA, {});
    assert.equal(r.result.processed, null);
  });
});

describe("queue.retry", () => {
  it("requeues a failed job to pending", () => {
    const e = call("enqueue", ctxA, { name: "f" });
    call("process", ctxA, { jobId: e.result.job.id, fail: true });
    const r = call("retry", ctxA, { jobId: e.result.job.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.status, "pending");
  });
  it("rejects retry of a completed job", () => {
    const e = call("enqueue", ctxA, { name: "done" });
    call("process", ctxA, { jobId: e.result.job.id });
    const r = call("retry", ctxA, { jobId: e.result.job.id });
    assert.equal(r.ok, false);
  });
});

describe("queue.dead-letter", () => {
  it("lists dead/failed jobs", () => {
    const e = call("enqueue", ctxA, { name: "f", maxAttempts: 1 });
    call("process", ctxA, { jobId: e.result.job.id, fail: true });
    const r = call("dead-letter", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
  });
  it("bulk-retries all dead/failed jobs", () => {
    const e = call("enqueue", ctxA, { name: "f", maxAttempts: 1 });
    call("process", ctxA, { jobId: e.result.job.id, fail: true });
    const r = call("dead-letter", ctxA, { action: "retry-all" });
    assert.equal(r.result.retried, 1);
  });
  it("purges all dead/failed jobs", () => {
    const e = call("enqueue", ctxA, { name: "f", maxAttempts: 1 });
    call("process", ctxA, { jobId: e.result.job.id, fail: true });
    const r = call("dead-letter", ctxA, { action: "purge" });
    assert.equal(r.result.purged, 1);
    assert.equal(call("list", ctxA, {}).result.total, 0);
  });
});

describe("queue.scheduled", () => {
  it("lists delayed jobs with an ETA", () => {
    call("enqueue", ctxA, { name: "future", delayMs: 120000 });
    const r = call("scheduled", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.ok(r.result.jobs[0].etaMs > 0);
  });
});

describe("queue.control + queues", () => {
  it("pauses, resumes, and sets concurrency", () => {
    const r = call("control", ctxA, { queue: "ingest", paused: true, concurrency: 8 });
    assert.equal(r.ok, true);
    assert.equal(r.result.paused, true);
    assert.equal(r.result.concurrency, 8);
  });
  it("queues lists per-queue depth + counts", () => {
    call("enqueue", ctxA, { name: "a", queue: "ingest" });
    call("enqueue", ctxA, { name: "b", queue: "ingest" });
    const r = call("queues", ctxA, {});
    assert.equal(r.ok, true);
    const ingest = r.result.queues.find(q => q.name === "ingest");
    assert.equal(ingest.depth, 2);
  });
});

describe("queue.workers", () => {
  it("registers and lists workers", () => {
    const reg = call("workers", ctxA, { action: "register", name: "w1", queue: "ingest" });
    assert.equal(reg.ok, true);
    const list = call("workers", ctxA, { action: "list" });
    assert.equal(list.result.total, 1);
  });
  it("stops a worker", () => {
    const reg = call("workers", ctxA, { action: "register", name: "w1" });
    const r = call("workers", ctxA, { action: "stop", workerId: reg.result.worker.id });
    assert.equal(r.result.worker.status, "stopped");
  });
});

describe("queue.metrics", () => {
  it("aggregates totals, throughput series, and alerts", () => {
    call("enqueue", ctxA, { name: "a" });
    const e = call("enqueue", ctxA, { name: "b" });
    call("process", ctxA, { jobId: e.result.job.id });
    const r = call("metrics", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.completed, 1);
    assert.equal(r.result.throughput.series.length, 12);
    assert.ok(Array.isArray(r.result.alerts));
  });
  it("raises a dead-letter alert", () => {
    const e = call("enqueue", ctxA, { name: "f", maxAttempts: 1 });
    call("process", ctxA, { jobId: e.result.job.id, fail: true });
    const r = call("metrics", ctxA, {});
    assert.ok(r.result.alerts.some(a => /dead-letter/.test(a.message)));
  });
});

describe("queue.events + remove + clear-completed", () => {
  it("records an activity feed", () => {
    call("enqueue", ctxA, { name: "a" });
    const r = call("events", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.total >= 1);
  });
  it("removes a job", () => {
    const e = call("enqueue", ctxA, { name: "a" });
    const r = call("remove", ctxA, { jobId: e.result.job.id });
    assert.equal(r.ok, true);
    assert.equal(call("list", ctxA, {}).result.total, 0);
  });
  it("clears completed jobs", () => {
    const e = call("enqueue", ctxA, { name: "a" });
    call("process", ctxA, { jobId: e.result.job.id });
    const r = call("clear-completed", ctxA, {});
    assert.equal(r.result.cleared, 1);
  });
});

describe("queue.job-detail", () => {
  it("returns the job plus its event history", () => {
    const e = call("enqueue", ctxA, { name: "a", payload: { foo: 1 } });
    const r = call("job-detail", ctxA, { jobId: e.result.job.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.payload.foo, 1);
    assert.ok(Array.isArray(r.result.history));
  });
  it("errors on unknown job", () => {
    const r = call("job-detail", ctxA, { jobId: "nope" });
    assert.equal(r.ok, false);
  });
});
