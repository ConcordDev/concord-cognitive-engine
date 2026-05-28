// Phase A — parallel heartbeat dispatch.
//
// Pins: (1) modules without `serial: true` run in parallel, (2) modules
// with `serial: true` run after the parallel batch in registration order,
// (3) a module that throws or times out does not block siblings, and
// (4) a per-module timeout cancels at the dispatcher boundary.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerHeartbeat,
  tickAllRegistered,
  _resetHeartbeatRegistry,
  getHeartbeatTimingStats,
} from "../emergent/heartbeat-registry.js";

describe("Phase A — heartbeat parallel dispatch", () => {
  beforeEach(() => {
    _resetHeartbeatRegistry();
  });

  it("runs parallel modules concurrently", async () => {
    const WORK_MS = 100;
    let started = 0, peak = 0, finished = 0;
    const sleeper = async () => {
      started++;
      peak = Math.max(peak, started - finished);
      await new Promise(r => setTimeout(r, WORK_MS));
      finished++;
    };
    for (let i = 0; i < 5; i++) {
      registerHeartbeat(`p-${i}`, { frequency: 1, handler: sleeper });
    }
    const t0 = Date.now();
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    const elapsed = Date.now() - t0;
    assert.ok(peak >= 2, `expected concurrent execution but peak in-flight was ${peak}`);
    assert.ok(elapsed < WORK_MS * 4, `expected parallel ~${WORK_MS}ms, got ${elapsed}ms`);
  });

  it("runs serial:true modules after the parallel batch", async () => {
    const order = [];
    registerHeartbeat("par-a", { frequency: 1, handler: () => order.push("par-a") });
    registerHeartbeat("par-b", { frequency: 1, handler: () => order.push("par-b") });
    registerHeartbeat("ser-1", { frequency: 1, serial: true, handler: () => order.push("ser-1") });
    registerHeartbeat("ser-2", { frequency: 1, serial: true, handler: () => order.push("ser-2") });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    // par-a + par-b finish first (any order); ser-1 then ser-2.
    const ser1Idx = order.indexOf("ser-1");
    const ser2Idx = order.indexOf("ser-2");
    assert.ok(order.indexOf("par-a") < ser1Idx, "parallel must come before serial");
    assert.ok(order.indexOf("par-b") < ser1Idx, "parallel must come before serial");
    assert.ok(ser1Idx < ser2Idx, "serial modules preserve registration order");
  });

  it("a thrower does not block other parallel modules", async () => {
    let bGood = false, cGood = false;
    registerHeartbeat("thrower", { frequency: 1, handler: () => { throw new Error("boom"); } });
    registerHeartbeat("good-b", { frequency: 1, handler: () => { bGood = true; } });
    registerHeartbeat("good-c", { frequency: 1, handler: async () => { await new Promise(r => setTimeout(r, 30)); cGood = true; } });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(bGood, true);
    assert.equal(cGood, true);
  });

  it("a hanging module is timed out and the tick completes", async () => {
    process.env.CONCORD_HEARTBEAT_MODULE_TIMEOUT_MS = "200";
    // Re-import so the registry re-reads the env var. Done by isolation
    // — the timeout is read inside _runOne every call.
    let bGood = false;
    registerHeartbeat("hang", { frequency: 1, handler: () => new Promise(() => {}) });
    registerHeartbeat("good-b", { frequency: 1, handler: () => { bGood = true; } });
    const t0 = Date.now();
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    const elapsed = Date.now() - t0;
    assert.ok(bGood, "non-hanging module ran");
    assert.ok(elapsed < 1000, `tick returned within timeout, got ${elapsed}ms`);
    delete process.env.CONCORD_HEARTBEAT_MODULE_TIMEOUT_MS;
  });

  it("getHeartbeatTimingStats reports per-module samples after a tick", async () => {
    registerHeartbeat("timed", { frequency: 1, handler: async () => { await new Promise(r => setTimeout(r, 50)); } });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    const stats = getHeartbeatTimingStats();
    const timed = stats.find(s => s.id === "timed");
    assert.ok(timed, "module shows up in stats");
    assert.ok(timed.sampleCount >= 1, "sample recorded");
    assert.ok(timed.lastMs >= 40, "last duration roughly matches sleep");
  });

  it("scope filter only runs the requested scope", async () => {
    let globalRan = 0, worldRan = 0;
    registerHeartbeat("g-mod", { frequency: 1, scope: "global", handler: () => { globalRan++; } });
    registerHeartbeat("w-mod", { frequency: 1, scope: "world",  handler: () => { worldRan++; } });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1, scope: "global" });
    assert.equal(globalRan, 1);
    assert.equal(worldRan, 0);
    await tickAllRegistered({ state: {}, db: null, tickCount: 2, scope: "world" });
    assert.equal(worldRan, 1);
  });
});
