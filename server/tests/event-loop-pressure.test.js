// Track C (event-loop unblocking audit) — event-loop-pressure primitive +
// the heartbeat dispatcher's `lowPriority` skip behavior it powers.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCurrentLagMs,
  isUnderPressure,
  _setLagMsForTest,
  stopEventLoopPressureMonitor,
} from "../lib/event-loop-pressure.js";
import {
  registerHeartbeat,
  tickAllRegistered,
  _resetHeartbeatRegistry,
  listHeartbeatModules,
} from "../emergent/heartbeat-registry.js";

describe("event-loop-pressure primitive", () => {
  afterEach(() => {
    _setLagMsForTest(0);
    stopEventLoopPressureMonitor();
  });

  it("starts at zero lag / not under pressure", () => {
    assert.equal(getCurrentLagMs(), 0);
    assert.equal(isUnderPressure(), false);
  });

  it("isUnderPressure flips true above the threshold (default 300ms)", () => {
    _setLagMsForTest(301);
    assert.equal(isUnderPressure(), true);
    _setLagMsForTest(299);
    assert.equal(isUnderPressure(), false);
  });

  it("stopEventLoopPressureMonitor resets state", () => {
    _setLagMsForTest(500);
    assert.equal(isUnderPressure(), true);
    stopEventLoopPressureMonitor();
    assert.equal(getCurrentLagMs(), 0);
    assert.equal(isUnderPressure(), false);
  });
});

describe("heartbeat registry — lowPriority skip under pressure", () => {
  beforeEach(() => {
    _resetHeartbeatRegistry();
    _setLagMsForTest(0);
  });
  afterEach(() => {
    _setLagMsForTest(0);
  });

  it("lowPriority module runs normally when NOT under pressure", async () => {
    let ran = 0;
    registerHeartbeat("lp-test", { frequency: 1, lowPriority: true, handler: () => { ran++; } });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(ran, 1);
  });

  it("lowPriority module is skipped (not run) when under pressure", async () => {
    _setLagMsForTest(1000);
    let ran = 0;
    registerHeartbeat("lp-test", { frequency: 1, lowPriority: true, handler: () => { ran++; } });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(ran, 0);
  });

  it("non-lowPriority modules are unaffected by pressure", async () => {
    _setLagMsForTest(1000);
    let ran = 0;
    registerHeartbeat("normal-test", { frequency: 1, handler: () => { ran++; } });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(ran, 1);
  });

  it("a lowPriority module resumes running once pressure clears (skip is per-tick, not permanent)", async () => {
    let ran = 0;
    registerHeartbeat("lp-test", { frequency: 1, lowPriority: true, handler: () => { ran++; } });

    _setLagMsForTest(1000);
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(ran, 0);

    _setLagMsForTest(0);
    await tickAllRegistered({ state: {}, db: null, tickCount: 2 });
    assert.equal(ran, 1);
  });

  it("listHeartbeatModules() reports lowPriority", () => {
    registerHeartbeat("lp-test", { frequency: 1, lowPriority: true, handler: () => {} });
    registerHeartbeat("normal-test", { frequency: 1, handler: () => {} });
    const modules = listHeartbeatModules();
    const lp = modules.find((m) => m.id === "lp-test");
    const normal = modules.find((m) => m.id === "normal-test");
    assert.equal(lp.lowPriority, true);
    assert.equal(normal.lowPriority, false);
  });

  it("mixed pass: pressure skips only the lowPriority entries, not the normal ones", async () => {
    _setLagMsForTest(1000);
    const order = [];
    registerHeartbeat("lp-a", { frequency: 1, lowPriority: true, handler: () => order.push("lp-a") });
    registerHeartbeat("normal-a", { frequency: 1, handler: () => order.push("normal-a") });
    registerHeartbeat("lp-b", { frequency: 1, lowPriority: true, handler: () => order.push("lp-b") });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.deepEqual(order, ["normal-a"]);
  });
});
