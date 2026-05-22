// Contract tests for server/domains/lock.js — concurrency lock-profiler
// macros: deadlock detection, contention/fairness analysis, plus the
// JFR-parity trace surface (recordLockEvent / holdTimeline / orderingAnalysis
// / hotspotRanking / blameAttribution / amdahlProjection).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLockActions from "../domains/lock.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`lock.${name}`);
  if (!fn) throw new Error(`lock.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerLockActions(register); });

// Fresh per-user trace store before each test.
beforeEach(() => {
  globalThis._concordSTATE = { lockLens: { traces: new Map() } };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Helper: record a sequence of lock events for a user.
function recordSeq(ctx, seq) {
  for (const ev of seq) {
    const r = call("recordLockEvent", ctx, {}, ev);
    assert.equal(r.ok, true, `recordLockEvent failed: ${r.error}`);
  }
}

describe("lock.recordLockEvent / clearLockTrace", () => {
  it("records a valid event and reports total", () => {
    const r = call("recordLockEvent", ctxA, {}, {
      thread: "t1", lock: "L1", action: "acquire", holdMs: 50,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 1);
    assert.equal(r.result.recorded.thread, "t1");
  });

  it("rejects missing thread/lock", () => {
    assert.equal(call("recordLockEvent", ctxA, {}, { lock: "L1", action: "acquire" }).ok, false);
    assert.equal(call("recordLockEvent", ctxA, {}, { thread: "t1", action: "acquire" }).ok, false);
  });

  it("rejects an invalid action", () => {
    const r = call("recordLockEvent", ctxA, {}, { thread: "t1", lock: "L1", action: "frob" });
    assert.equal(r.ok, false);
  });

  it("isolates traces per user", () => {
    recordSeq(ctxA, [{ thread: "t1", lock: "L1", action: "acquire" }]);
    const rb = call("holdTimeline", ctxB, {});
    assert.equal(rb.ok, true);
    assert.equal(rb.result.eventCount, undefined);
    assert.equal(rb.result.spans.length, 0);
  });

  it("clears the per-user trace", () => {
    recordSeq(ctxA, [{ thread: "t1", lock: "L1", action: "acquire" }]);
    const c = call("clearLockTrace", ctxA);
    assert.equal(c.ok, true);
    assert.equal(c.result.cleared, true);
    const tl = call("holdTimeline", ctxA, {});
    assert.equal(tl.result.spans.length, 0);
  });
});

describe("lock.holdTimeline [M]", () => {
  it("reports empty when no trace recorded", () => {
    const r = call("holdTimeline", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.spans, []);
  });

  it("pairs acquire→release into closed hold spans", () => {
    recordSeq(ctxA, [
      { thread: "t1", lock: "L1", action: "acquire", ts: 1000 },
      { thread: "t1", lock: "L1", action: "release", ts: 1500 },
    ]);
    const r = call("holdTimeline", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.spans.length, 1);
    assert.equal(r.result.spans[0].durationMs, 500);
    assert.equal(r.result.spans[0].closed, true);
    assert.deepEqual(r.result.lanes, ["t1"]);
  });

  it("treats an unreleased acquire as still-open to window end", () => {
    recordSeq(ctxA, [
      { thread: "t1", lock: "L1", action: "acquire", ts: 1000 },
      { thread: "t2", lock: "L2", action: "acquire", ts: 2000 },
      { thread: "t2", lock: "L2", action: "release", ts: 2200 },
    ]);
    const r = call("holdTimeline", ctxA, {});
    assert.equal(r.result.openSpans, 1);
  });
});

describe("lock.orderingAnalysis [M]", () => {
  it("detects a deadlock-prone ordering inversion", () => {
    // t1: acquire L1, then L2 while holding L1 → L1>L2
    // t2: acquire L2, then L1 while holding L2 → L2>L1  (inversion)
    recordSeq(ctxA, [
      { thread: "t1", lock: "L1", action: "acquire", ts: 1 },
      { thread: "t1", lock: "L2", action: "acquire", ts: 2 },
      { thread: "t1", lock: "L2", action: "release", ts: 3 },
      { thread: "t1", lock: "L1", action: "release", ts: 4 },
      { thread: "t2", lock: "L2", action: "acquire", ts: 5 },
      { thread: "t2", lock: "L1", action: "acquire", ts: 6 },
      { thread: "t2", lock: "L1", action: "release", ts: 7 },
      { thread: "t2", lock: "L2", action: "release", ts: 8 },
    ]);
    const r = call("orderingAnalysis", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.riskLevel, "high");
    assert.equal(r.result.inversions.length, 1);
    const inv = r.result.inversions[0];
    assert.ok([inv.lockA, inv.lockB].includes("L1"));
    assert.ok([inv.lockA, inv.lockB].includes("L2"));
  });

  it("reports safe ordering when all threads acquire consistently", () => {
    recordSeq(ctxA, [
      { thread: "t1", lock: "L1", action: "acquire", ts: 1 },
      { thread: "t1", lock: "L2", action: "acquire", ts: 2 },
      { thread: "t1", lock: "L2", action: "release", ts: 3 },
      { thread: "t1", lock: "L1", action: "release", ts: 4 },
      { thread: "t2", lock: "L1", action: "acquire", ts: 5 },
      { thread: "t2", lock: "L2", action: "acquire", ts: 6 },
      { thread: "t2", lock: "L2", action: "release", ts: 7 },
      { thread: "t2", lock: "L1", action: "release", ts: 8 },
    ]);
    const r = call("orderingAnalysis", ctxA, {});
    assert.equal(r.result.inversions.length, 0);
    assert.equal(r.result.riskLevel, "low");
  });
});

describe("lock.hotspotRanking [S]", () => {
  it("ranks locks by total wait time descending", () => {
    recordSeq(ctxA, [
      { thread: "t1", lock: "hot", action: "wait", waitMs: 300 },
      { thread: "t2", lock: "hot", action: "wait", waitMs: 200 },
      { thread: "t3", lock: "cool", action: "wait", waitMs: 20 },
      { thread: "t1", lock: "hot", action: "acquire", holdMs: 40 },
    ]);
    const r = call("hotspotRanking", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.hotspots[0].lock, "hot");
    assert.equal(r.result.hotspots[0].rank, 1);
    assert.equal(r.result.hotspots[0].totalWaitMs, 500);
    assert.equal(r.result.worst.lock, "hot");
  });

  it("reports empty when no trace recorded", () => {
    const r = call("hotspotRanking", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.hotspots, []);
  });
});

describe("lock.blameAttribution [S]", () => {
  it("attributes wait/hold to the top stack frame", () => {
    recordSeq(ctxA, [
      { thread: "t1", lock: "L1", action: "wait", waitMs: 100, stack: ["debit()", "transfer()"] },
      { thread: "t2", lock: "L1", action: "wait", waitMs: 80, stack: ["debit()", "transfer()"] },
      { thread: "t3", lock: "L1", action: "acquire", holdMs: 30, stack: ["credit()", "transfer()"] },
    ]);
    const r = call("blameAttribution", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.sites[0].site, "debit()");
    assert.equal(r.result.sites[0].blameMs, 180);
    assert.equal(r.result.topOffender.site, "debit()");
  });

  it("reports no stacks when events carry none", () => {
    recordSeq(ctxA, [{ thread: "t1", lock: "L1", action: "acquire" }]);
    const r = call("blameAttribution", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.sites, []);
  });
});

describe("lock.amdahlProjection [M]", () => {
  it("derives serial fraction from the recorded trace", () => {
    recordSeq(ctxA, [
      { thread: "t1", lock: "L1", action: "acquire", holdMs: 500, ts: 1000 },
      { thread: "t2", lock: "L1", action: "wait", waitMs: 200, ts: 1100 },
      { thread: "t1", lock: "L1", action: "release", ts: 2000 },
    ]);
    const r = call("amdahlProjection", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.serialFractionSource, "trace");
    assert.ok(r.result.curve.length > 0);
    assert.ok(r.result.curve[0].processors === 1);
  });

  it("honours a supplied serial fraction and bounds the curve", () => {
    const r = call("amdahlProjection", ctxA, {}, { serialFraction: 0.5, maxProcessors: 8 });
    assert.equal(r.ok, true);
    assert.equal(r.result.serialFraction, 0.5);
    assert.equal(r.result.serialFractionSource, "supplied");
    assert.equal(r.result.amdahlCeiling, 2);
    assert.ok(r.result.curve.every((c) => c.processors <= 8));
  });

  it("falls back to a default serial fraction with no trace or param", () => {
    const r = call("amdahlProjection", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.serialFractionSource, "default");
  });
});

describe("lock.deadlockDetect (wait-for graph)", () => {
  it("detects a 2-node cycle", () => {
    const r = call("deadlockDetect", ctxA, {
      data: { locks: [{ holder: "A", waiting: "B" }, { holder: "B", waiting: "A" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.deadlocked, true);
    assert.equal(r.result.cycleCount, 1);
  });

  it("reports no deadlock for an acyclic wait-for graph", () => {
    const r = call("deadlockDetect", ctxA, {
      data: { locks: [{ holder: "A", waiting: "B" }, { holder: "B", waiting: "C" }] },
    }, {});
    assert.equal(r.result.deadlocked, false);
  });
});

describe("lock.contentionAnalysis", () => {
  it("identifies hot locks and emits granularity suggestions", () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({ resource: "ledger", type: "acquire", processId: `p${i}`, durationMs: 200 });
      events.push({ resource: "ledger", type: "wait", processId: `p${i}`, durationMs: 150 });
    }
    const r = call("contentionAnalysis", ctxA, { data: { lockEvents: events } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.resources.length >= 1);
    assert.ok(r.result.summary.totalEvents === events.length);
  });

  it("handles empty input gracefully", () => {
    const r = call("contentionAnalysis", ctxA, { data: { lockEvents: [] } }, {});
    assert.equal(r.ok, true);
  });
});

describe("lock.fairnessScore (Jain's index)", () => {
  it("scores perfectly-equal waits as excellent fairness", () => {
    const r = call("fairnessScore", ctxA, {
      data: {
        processWaits: [
          { processId: "p1", resource: "L", waitMs: 100 },
          { processId: "p2", resource: "L", waitMs: 100 },
          { processId: "p3", resource: "L", waitMs: 100 },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.fairnessLevel, "excellent");
    assert.ok(r.result.jainsIndex > 0.99);
  });

  it("detects starvation when one process waits far longer", () => {
    // Starvation threshold is 3x the mean wait; a single outlier needs
    // enough low-wait peers for it to clear 3x the mean.
    const r = call("fairnessScore", ctxA, {
      data: {
        processWaits: [
          { processId: "p1", resource: "L", waitMs: 10 },
          { processId: "p2", resource: "L", waitMs: 10 },
          { processId: "p3", resource: "L", waitMs: 10 },
          { processId: "p4", resource: "L", waitMs: 10 },
          { processId: "p5", resource: "L", waitMs: 10 },
          { processId: "p6", resource: "L", waitMs: 5000 },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.starvation.detected, true);
    assert.equal(r.result.fairnessLevel, "poor");
  });
});
