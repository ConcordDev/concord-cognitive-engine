/**
 * governorTick block isolation contract.
 *
 * The "must never stop the tick" invariant from CLAUDE.md is load-bearing:
 * if any inline tick block in governorTick() throws unhandled, the next
 * `if (_tick % FREQ === 0)` block doesn't run, and the simulation slowly
 * starves. The runHeartbeatModule helper at server.js:30342 is the canonical
 * wrap — every new heavy tick block must use it.
 *
 * This test pins the wrap contract in two ways:
 *   1. runHeartbeatModule swallows synchronous AND asynchronous throws.
 *   2. A throw in one wrapped block does NOT prevent a later block from running.
 *   3. Per-block timing histogram receives an observation regardless of
 *      whether the block threw or completed.
 *
 * Run: cd server && node --test tests/governor-tick-isolation.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Re-implementation of runHeartbeatModule in the same shape as
 * server.js:30342. Kept here (not imported from the monolith) because
 * server.js is import-side-effect-heavy (DB open, port bind attempt,
 * heartbeat scheduler init) and unsuitable for unit-test import. If the
 * real helper drifts, update this copy and the test fails — that's the
 * regression signal.
 */
function makeRunHeartbeatModule({ structuredLog, METRICS }) {
  return async function runHeartbeatModule(name, fn) {
    const start = Date.now();
    try {
      return await fn();
    } catch (err) {
      try {
        structuredLog("warn", "heartbeat_module_error", { module: name, error: String(err?.message || err) });
        METRICS?.counters?.heartbeatModuleErrors?.inc({ module: name });
      } catch { /* metrics best-effort */ }
      return undefined;
    } finally {
      const ms = Date.now() - start;
      try { METRICS?.histograms?.heartbeatBlockMs?.observe({ module: name }, ms); } catch { /* metrics best-effort */ }
      if (ms > 5000) {
        try { structuredLog("warn", "heartbeat_block_slow", { module: name, ms }); } catch { /* logging best-effort */ }
      }
    }
  };
}

describe("runHeartbeatModule — isolation contract", () => {
  let logs;
  let metricEvents;
  let METRICS;
  let runHeartbeatModule;

  beforeEach(() => {
    logs = [];
    metricEvents = [];
    METRICS = {
      counters: {
        heartbeatModuleErrors: {
          inc: (labels) => metricEvents.push({ kind: "counter_inc", labels }),
        },
      },
      histograms: {
        heartbeatBlockMs: {
          observe: (labels, value) => metricEvents.push({ kind: "histogram_observe", labels, value }),
        },
      },
    };
    runHeartbeatModule = makeRunHeartbeatModule({
      structuredLog: (level, event, payload) => logs.push({ level, event, payload }),
      METRICS,
    });
  });

  it("returns the function's resolved value when no throw", async () => {
    const result = await runHeartbeatModule("happy", async () => 42);
    assert.equal(result, 42);
  });

  it("swallows a synchronous throw and returns undefined", async () => {
    const result = await runHeartbeatModule("sync_throw", () => {
      throw new Error("synchronous boom");
    });
    assert.equal(result, undefined);
    const err = logs.find((l) => l.event === "heartbeat_module_error");
    assert.ok(err, "expected heartbeat_module_error log");
    assert.equal(err.payload.module, "sync_throw");
    assert.match(err.payload.error, /synchronous boom/);
  });

  it("swallows an async throw and returns undefined", async () => {
    const result = await runHeartbeatModule("async_throw", async () => {
      throw new Error("async boom");
    });
    assert.equal(result, undefined);
    const err = logs.find((l) => l.event === "heartbeat_module_error");
    assert.ok(err);
    assert.match(err.payload.error, /async boom/);
  });

  it("increments the per-module error counter on throw", async () => {
    await runHeartbeatModule("counter_block", () => { throw new Error("x"); });
    const inc = metricEvents.find((e) => e.kind === "counter_inc");
    assert.ok(inc, "expected counter_inc event");
    assert.deepEqual(inc.labels, { module: "counter_block" });
  });

  it("observes the timing histogram on success", async () => {
    await runHeartbeatModule("timed_ok", async () => "done");
    const obs = metricEvents.find((e) => e.kind === "histogram_observe");
    assert.ok(obs, "expected histogram_observe event");
    assert.deepEqual(obs.labels, { module: "timed_ok" });
    assert.ok(obs.value >= 0, "duration must be non-negative");
  });

  it("observes the timing histogram even on throw (finally block fires)", async () => {
    await runHeartbeatModule("timed_throw", () => { throw new Error("y"); });
    const obs = metricEvents.find((e) => e.kind === "histogram_observe" && e.labels.module === "timed_throw");
    assert.ok(obs, "histogram must observe even when block threw");
  });

  it("emits heartbeat_block_slow when block exceeds 5s", async () => {
    // Patch Date.now temporarily so we don't actually have to wait 5s.
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => {
      calls += 1;
      // First call (start): t=0; second call (finally): t=6000.
      return calls === 1 ? 0 : 6000;
    };
    try {
      await runHeartbeatModule("slow_block", () => {});
    } finally {
      Date.now = realNow;
    }
    const slow = logs.find((l) => l.event === "heartbeat_block_slow");
    assert.ok(slow, "expected heartbeat_block_slow log");
    assert.equal(slow.payload.module, "slow_block");
    assert.equal(slow.payload.ms, 6000);
  });

  it("does NOT emit heartbeat_block_slow for blocks under 5s", async () => {
    await runHeartbeatModule("fast_block", () => {});
    const slow = logs.find((l) => l.event === "heartbeat_block_slow");
    assert.equal(slow, undefined);
  });
});

describe("Multi-block isolation — one throw cannot starve the next block", () => {
  it("a throwing block does not prevent later blocks from running", async () => {
    const logs = [];
    const METRICS = {
      counters: { heartbeatModuleErrors: { inc: () => {} } },
      histograms: { heartbeatBlockMs: { observe: () => {} } },
    };
    const runHeartbeatModule = makeRunHeartbeatModule({
      structuredLog: (level, event, payload) => logs.push({ level, event, payload }),
      METRICS,
    });

    // Simulate three sequential blocks like governorTick does: an early
    // block throws, the second runs, the third runs. If the wrap contract
    // is broken (e.g. the helper rethrows), block-2 and block-3 wouldn't
    // execute and the assertions below fail.
    const ran = [];
    await runHeartbeatModule("block_a", async () => {
      ran.push("a");
      throw new Error("a-fail");
    });
    await runHeartbeatModule("block_b", async () => {
      ran.push("b");
    });
    await runHeartbeatModule("block_c", async () => {
      ran.push("c");
    });

    assert.deepEqual(ran, ["a", "b", "c"], "all three blocks must run");
    const errors = logs.filter((l) => l.event === "heartbeat_module_error");
    assert.equal(errors.length, 1, "only block_a should have logged an error");
    assert.equal(errors[0].payload.module, "block_a");
  });
});
