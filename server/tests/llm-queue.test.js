/**
 * LLM Priority Queue Tests
 *
 * Tests bounded priority queue for LLM calls.
 * Verifies: priority ordering, concurrency caps, queue shedding, metrics, drain.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PRIORITY, createLLMQueue } from "../lib/llm-queue.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => { setTimeout(r, ms); });
}

function slowFn(ms, val = "ok") {
  return async () => { await delay(ms); return val; };
}

function immediateFn(val = "ok") {
  return async () => val;
}

function failingFn(msg = "error") {
  return async () => { throw new Error(msg); };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Priority Constants
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Priority Constants", () => {
  it("defines four priority levels", () => {
    assert.equal(PRIORITY.CRITICAL, 0);
    assert.equal(PRIORITY.HIGH, 1);
    assert.equal(PRIORITY.NORMAL, 2);
    assert.equal(PRIORITY.LOW, 3);
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(PRIORITY));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Basic Enqueueing
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Basic Operations", () => {
  it("executes a single enqueued function", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    const result = await q.enqueue(immediateFn("hello"), PRIORITY.NORMAL);
    assert.equal(result, "hello");
  });

  it("propagates errors from enqueued functions", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    await assert.rejects(() => q.enqueue(failingFn("boom"), PRIORITY.NORMAL), { message: "boom" });
  });

  it("defaults to NORMAL priority", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    await q.enqueue(immediateFn());
    const m = q.getMetrics();
    assert.equal(m.byPriority.normal.enqueued, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Priority Ordering
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Priority Ordering", () => {
  it("processes higher priority items first", async () => {
    const order = [];
    const q = createLLMQueue({ concurrency: 1 });

    // Block the queue with a slow task
    const blocker = q.enqueue(slowFn(50, "blocker"), PRIORITY.NORMAL);

    // Queue items at different priorities while blocked
    const low = q.enqueue(async () => { order.push("low"); return "low"; }, PRIORITY.LOW);
    const critical = q.enqueue(async () => { order.push("critical"); return "critical"; }, PRIORITY.CRITICAL);
    const high = q.enqueue(async () => { order.push("high"); return "high"; }, PRIORITY.HIGH);

    await Promise.all([blocker, low, critical, high]);

    assert.equal(order[0], "critical");
    assert.equal(order[1], "high");
    assert.equal(order[2], "low");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Concurrency Cap
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Concurrency", () => {
  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const q = createLLMQueue({ concurrency: 2 });
    const tasks = Array.from({ length: 5 }, () =>
      q.enqueue(async () => {
        current++;
        if (current > maxConcurrent) maxConcurrent = current;
        await delay(20);
        current--;
      }, PRIORITY.NORMAL)
    );

    await Promise.all(tasks);
    assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Queue Depth / Shedding
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Queue Depth & Shedding", () => {
  it("rejects LOW priority when queue is full", async () => {
    const q = createLLMQueue({ concurrency: 1, maxQueueDepth: 2 });
    // Fill the queue
    const blocker = q.enqueue(slowFn(100), PRIORITY.NORMAL);
    q.enqueue(immediateFn(), PRIORITY.NORMAL);
    q.enqueue(immediateFn(), PRIORITY.NORMAL);

    await assert.rejects(
      () => q.enqueue(immediateFn(), PRIORITY.LOW),
      { message: /llm_queue/ }
    );

    await blocker.catch(() => {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Metrics
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Metrics", () => {
  it("reports accurate metrics", async () => {
    const q = createLLMQueue({ concurrency: 2 });
    await q.enqueue(immediateFn(), PRIORITY.CRITICAL);
    await q.enqueue(immediateFn(), PRIORITY.HIGH);
    await q.enqueue(immediateFn(), PRIORITY.NORMAL);
    await assert.rejects(() => q.enqueue(failingFn(), PRIORITY.LOW));

    const m = q.getMetrics();
    assert.equal(m.concurrency, 2);
    assert.equal(m.byPriority.critical.enqueued, 1);
    assert.equal(m.byPriority.critical.completed, 1);
    assert.equal(m.byPriority.high.enqueued, 1);
    assert.equal(m.byPriority.normal.enqueued, 1);
    assert.equal(m.byPriority.low.errors, 1);
  });

  it("tracks average latency", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    await q.enqueue(slowFn(20), PRIORITY.NORMAL);
    const m = q.getMetrics();
    assert.ok(m.byPriority.normal.avgLatencyMs >= 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Wrap Helper
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Wrap", () => {
  it("wraps an existing function to go through the queue", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    const originalFn = async (a, b) => a + b;
    const wrapped = q.wrap(originalFn, PRIORITY.HIGH);
    const result = await wrapped(3, 4);
    assert.equal(result, 7);
    const m = q.getMetrics();
    assert.equal(m.byPriority.high.enqueued, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Drain
// ═══════════════════════════════════════════════════════════════════════════════

describe("LLM Queue — Drain", () => {
  it("rejects new items after drain starts", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    await q.drain();
    await assert.rejects(
      () => q.enqueue(immediateFn(), PRIORITY.CRITICAL),
      { message: /llm_queue_draining/ }
    );
  });

  it("drain resolves when inflight completes", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    q.enqueue(slowFn(30), PRIORITY.NORMAL);
    await delay(5); // Let it start
    await q.drain();
    // If we get here, drain completed
    assert.ok(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CRITICAL reservation (audit 2026-07-27)
// ═══════════════════════════════════════════════════════════════════════════════
// Priority ordering alone only governs DEQUEUE order — it does nothing for items
// already inflight. Without a reservation, a burst of slow background/vision work
// can fill every concurrency slot before a live-chat CRITICAL request ever arrives,
// and there is no preemption, so that request queues behind up to the full timeout
// of unrelated work. These pin the fix: a slot is held open for CRITICAL.

describe("LLM Queue — CRITICAL reservation", () => {
  it("reserves 1 slot by default when concurrency > 1: a LOW-priority burst fills concurrency-1, not concurrency", async () => {
    const q = createLLMQueue({ concurrency: 5 });
    const lows = Array.from({ length: 6 }, () => q.enqueue(slowFn(200), PRIORITY.LOW));
    await delay(20); // let the burst get admitted
    const m = q.getMetrics();
    assert.equal(m.inflight, 4, "non-CRITICAL work must not fill the reserved slot");
    await Promise.all(lows);
  });

  it("a CRITICAL request lands immediately despite a full LOW-priority burst", async () => {
    const q = createLLMQueue({ concurrency: 5 });
    const lows = Array.from({ length: 6 }, () => q.enqueue(slowFn(300), PRIORITY.LOW));
    await delay(20);
    const start = Date.now();
    const result = await q.enqueue(immediateFn("crit"), PRIORITY.CRITICAL);
    const latencyMs = Date.now() - start;
    assert.equal(result, "crit");
    assert.ok(latencyMs < 50, `CRITICAL request should be near-instant, got ${latencyMs}ms`);
    await Promise.all(lows);
  });

  it("reservation is 0 when concurrency is 1 (nothing to reserve)", async () => {
    const q = createLLMQueue({ concurrency: 1 });
    // A single-slot queue cannot reserve without deadlocking non-critical work
    // entirely — LOW must still be able to run when nothing higher is queued.
    const result = await q.enqueue(immediateFn("low-on-single-slot"), PRIORITY.LOW);
    assert.equal(result, "low-on-single-slot");
  });

  it("reserveForCritical is explicitly configurable", async () => {
    const q = createLLMQueue({ concurrency: 5, reserveForCritical: 2 });
    const lows = Array.from({ length: 6 }, () => q.enqueue(slowFn(200), PRIORITY.LOW));
    await delay(20);
    const m = q.getMetrics();
    assert.equal(m.inflight, 3, "explicit reserveForCritical:2 must hold 2 slots open");
    await Promise.all(lows);
  });

  it("an idle reserved slot does not block queue drain when no CRITICAL work ever arrives", async () => {
    const q = createLLMQueue({ concurrency: 5 });
    const lows = Array.from({ length: 4 }, () => q.enqueue(slowFn(30), PRIORITY.LOW));
    const results = await Promise.all(lows);
    assert.deepEqual(results, ["ok", "ok", "ok", "ok"]);
  });
});
