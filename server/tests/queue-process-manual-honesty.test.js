// FIX-queue-001 — Process is a MANUAL state transition (no worker
// executes the job anywhere in this lens), yet the job flipped to a
// bare 'completed' status: the list badge, the detail drawer and the
// event history all read as if a worker had run it. The stored result
// already carried the truth ({ manual: true, output: "marked completed
// manually — no worker executed …" }); this pin holds the records
// together: the completion event names the manual mark in words, and
// the result keeps its manual flag for the FE chips/line.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/queue.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`queue.${name}`);
  if (!fn) throw new Error(`queue.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});
const ctxA = { actor: { userId: "u" }, userId: "u" };

describe("FIX-queue-001 manual completion reads as manual everywhere", () => {
  it("process completes with the manual flag + honest output, and the history event says so", () => {
    call("enqueue", ctxA, { queue: "autocrawl", name: "qa5" });
    const job = call("list", ctxA, {}).result.jobs[0];
    const r = call("process", ctxA, { jobId: job.id });
    assert.equal(r.result.processed.status, "completed");
    assert.equal(r.result.processed.result.manual, true);
    assert.match(r.result.processed.result.output, /no worker executed/);
    const detail = call("job-detail", ctxA, { jobId: job.id });
    const ev = detail.result.history.find((e) => e.type === "completed" || /completed/.test(e.message || ""));
    assert.ok(ev, "a completed event exists");
    assert.match(ev.message, /marked completed manually/);
    assert.match(ev.message, /no worker executed it/);
  });

  it("a failed manual process does NOT claim completion", () => {
    call("enqueue", ctxA, { queue: "autocrawl", name: "qa6", payload: { shouldFail: true } });
    const job = call("list", ctxA, {}).result.jobs[0];
    const r = call("process", ctxA, { jobId: job.id });
    assert.notEqual(r.result.processed.status, "completed");
  });
});
