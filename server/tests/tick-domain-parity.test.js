// Contract tests for server/domains/tick.js — heartbeat-monitor substrate.
//
// Covers the pure-compute macros (healthPulse / loadPredict / rhythmAnalysis)
// plus the Datadog / Better Uptime parity macros that compute over the
// per-user persisted tick-sample history under globalThis._concordSTATE:
//   recordSample · heartbeatList · heartbeatRegistry · skipReport ·
//   alerts · stream · latencyHistogram · heartbeatControl · uptimeSLA
//
// Run: cd server && node --test tests/tick-domain-parity.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTickActions from "../domains/tick.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`tick.${name}`);
  if (!fn) throw new Error(`tick.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerTickActions(register); });

// Fresh per-user STATE before each test so samples don't bleed across cases.
beforeEach(() => {
  globalThis._concordSTATE = { settings: { disabledHeartbeats: [] } };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// ---------------------------------------------------------------------------
// Pure-compute macros
// ---------------------------------------------------------------------------

describe("tick.healthPulse (pure-compute)", () => {
  it("returns a message when there is no tick data", () => {
    const r = call("healthPulse", ctxA, { data: { ticks: [] } }, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No tick data/);
  });

  it("computes per-component health + system status from real ticks", () => {
    const now = Date.now();
    const ticks = [];
    for (let i = 0; i < 6; i++) {
      ticks.push({ componentId: "alpha", timestamp: new Date(now - (6 - i) * 5000).toISOString(), healthy: true });
    }
    const r = call("healthPulse", ctxA, { data: { ticks } }, { expectedIntervalMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.components.length, 1);
    assert.ok(["healthy", "degraded", "critical"].includes(r.result.systemStatus));
    assert.ok(r.result.summary.totalComponents === 1);
  });
});

describe("tick.loadPredict (pure-compute)", () => {
  it("needs at least 3 data points", () => {
    const r = call("loadPredict", ctxA, { data: { loadHistory: [{ timestamp: new Date().toISOString(), cpu: 10 }] } }, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 3/);
  });

  it("produces EMA forecasts + capacity planning", () => {
    const now = Date.now();
    const loadHistory = [];
    for (let i = 0; i < 8; i++) {
      loadHistory.push({ timestamp: new Date(now - (8 - i) * 60000).toISOString(), cpu: 20 + i * 5, memory: 30 });
    }
    const r = call("loadPredict", ctxA, { data: { loadHistory } }, { forecastPeriods: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.predictions.cpu);
    assert.equal(r.result.predictions.cpu.forecast.length, 5);
    assert.ok(r.result.capacityPlanning.cpu);
  });
});

describe("tick.rhythmAnalysis (pure-compute)", () => {
  it("needs at least 8 data points", () => {
    const r = call("rhythmAnalysis", ctxA, { data: { timeSeries: [] } }, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 8/);
  });

  it("detects a dominant frequency in a periodic signal", () => {
    const now = Date.now();
    const timeSeries = [];
    for (let i = 0; i < 32; i++) {
      timeSeries.push({ timestamp: new Date(now + i * 1000).toISOString(), value: Math.sin((2 * Math.PI * i) / 8) });
    }
    const r = call("rhythmAnalysis", ctxA, { data: { timeSeries } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.dominantFrequencies.length > 0);
    assert.ok(r.result.spectralAnalysis.rhythmType);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat-monitor substrate
// ---------------------------------------------------------------------------

describe("tick.recordSample — persists real observed governor samples", () => {
  it("records a sample and tracks per-interval deltas", () => {
    const r1 = call("recordSample", ctxA, {}, { ticks: 100, tickDurationMs: 120, uptimeSec: 1500 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.recorded, true);
    assert.equal(r1.result.totalSamples, 1);
    // Second sample advances the counter — tickDelta should reflect the gap.
    const r2 = call("recordSample", ctxA, {}, { ticks: 110, tickDurationMs: 90, uptimeSec: 1650 });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.sample.ticks, 110);
    assert.equal(r2.result.sample.tickDelta, 10);
  });

  it("tracks per-heartbeat snapshots passed in heartbeats[]", () => {
    const r = call("recordSample", ctxA, {}, {
      ticks: 10,
      heartbeats: [
        { id: "fauna-spawner", frequency: 30, lastRunAt: Date.now(), errorCount: 0, enabled: true },
        { id: "repair-cycle", frequency: 20, lastRunAt: Date.now(), errorCount: 0, enabled: true },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.heartbeatsTracked, 2);
  });

  it("raises a heartbeat_error alert when a module's error count climbs", () => {
    call("recordSample", ctxA, {}, { ticks: 10, heartbeats: [{ id: "x", frequency: 5, errorCount: 0 }] });
    call("recordSample", ctxA, {}, { ticks: 20, heartbeats: [{ id: "x", frequency: 5, errorCount: 3 }] });
    const a = call("alerts", ctxA, {}, { op: "list" });
    assert.equal(a.ok, true);
    assert.ok(a.result.alerts.some((al) => al.kind === "heartbeat_error"));
  });

  it("returns ok:false when STATE is unavailable", () => {
    globalThis._concordSTATE = undefined;
    const r = call("recordSample", ctxA, {}, { ticks: 1 });
    assert.equal(r.ok, false);
  });
});

describe("tick.heartbeatRegistry — surfaces the real registered modules", () => {
  it("returns ok with a modules array + summary", async () => {
    const r = await call("heartbeatRegistry", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.modules));
    assert.ok(r.result.summary);
    assert.equal(typeof r.result.summary.governorIntervalMs, "number");
  });

  it("each module carries a derived governor-tick period", async () => {
    const r = await call("heartbeatRegistry", ctxA, {}, {});
    assert.equal(r.ok, true);
    for (const m of r.result.modules) {
      assert.equal(typeof m.id, "string");
      assert.ok(m.frequency >= 1);
      assert.equal(m.periodMs, m.frequency * 15000);
      assert.equal(typeof m.enabled, "boolean");
    }
  });
});

describe("tick.heartbeatList — per-heartbeat detail (#1)", () => {
  it("derives status from observed heartbeat snapshots", () => {
    call("recordSample", ctxA, {}, {
      ticks: 5,
      heartbeats: [{ id: "metrics-decay", frequency: 20, lastRunAt: Date.now(), errorCount: 0, enabled: true }],
    });
    const r = call("heartbeatList", ctxA, {}, {});
    assert.equal(r.ok, true);
    const m = r.result.modules.find((x) => x.id === "metrics-decay");
    assert.ok(m);
    assert.equal(m.status, "healthy");
    assert.equal(r.result.summary.total, 1);
  });

  it("flags an erroring module", () => {
    call("recordSample", ctxA, {}, { ticks: 1, heartbeats: [{ id: "e", frequency: 5, errorCount: 0 }] });
    call("recordSample", ctxA, {}, { ticks: 2, heartbeats: [{ id: "e", frequency: 5, errorCount: 2 }] });
    const r = call("heartbeatList", ctxA, {}, {});
    const m = r.result.modules.find((x) => x.id === "e");
    assert.equal(m.status, "erroring");
  });
});

describe("tick.skipReport — skipped-tick / overrun visualization (#2)", () => {
  it("returns an empty series with no samples", () => {
    const r = call("skipReport", ctxA, {}, { windowMs: 3600000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 0);
  });

  it("surfaces skipped-tick deltas + overrun ratio", () => {
    call("recordSample", ctxA, {}, { ticks: 10, skippedTotal: 0 });
    call("recordSample", ctxA, {}, { ticks: 20, skippedTotal: 2 });
    const r = call("skipReport", ctxA, {}, { windowMs: 3600000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.skipped, 2);
    assert.ok(r.result.totals.overrunRatio > 0);
  });
});

describe("tick.alerts — alerting feed (#3)", () => {
  it("lists alerts and exposes notification config", () => {
    const r = call("alerts", ctxA, {}, { op: "list" });
    assert.equal(r.ok, true);
    assert.ok(r.result.config);
    assert.equal(typeof r.result.unacknowledged, "number");
  });

  it("acknowledges and clears alerts", () => {
    call("recordSample", ctxA, {}, { ticks: 1, skippedTotal: 0 });
    call("recordSample", ctxA, {}, { ticks: 1, skippedTotal: 5 });
    const list = call("alerts", ctxA, {}, { op: "list" });
    const overrun = list.result.alerts.find((a) => a.kind === "tick_overrun");
    assert.ok(overrun);
    const ack = call("alerts", ctxA, {}, { op: "ack", alertId: overrun.id });
    assert.equal(ack.ok, true);
    const cleared = call("alerts", ctxA, {}, { op: "clear" });
    assert.equal(cleared.ok, true);
    assert.ok(cleared.result.cleared >= 1);
  });

  it("updates notification config", () => {
    const r = call("alerts", ctxA, {}, { op: "config", notifyOnOverrun: false });
    assert.equal(r.ok, true);
    assert.equal(r.result.config.notifyOnOverrun, false);
  });
});

describe("tick.stream — time-range-filtered tick stream (#4)", () => {
  it("returns samples within the window + the window options", () => {
    call("recordSample", ctxA, {}, { ticks: 10, tickDurationMs: 50 });
    call("recordSample", ctxA, {}, { ticks: 20, tickDurationMs: 60 });
    const r = call("stream", ctxA, {}, { windowMs: 900000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.ok(r.result.windowOptions.length >= 4);
  });
});

describe("tick.latencyHistogram — tick latency histogram (#5)", () => {
  it("returns a message when there are no latency samples", () => {
    const r = call("latencyHistogram", ctxA, {}, { windowMs: 3600000 });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No latency samples/);
  });

  it("buckets observed tick durations and computes percentiles", () => {
    for (const d of [40, 120, 300, 700, 1500, 6000]) {
      call("recordSample", ctxA, {}, { ticks: 1, tickDurationMs: d });
    }
    const r = call("latencyHistogram", ctxA, {}, { windowMs: 3600000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sampleCount, 6);
    assert.ok(r.result.buckets.length > 0);
    assert.ok(typeof r.result.percentiles.p95 === "number");
  });
});

describe("tick.heartbeatControl — pause / resume / trigger (#6)", () => {
  it("rejects an unknown op", () => {
    const r = call("heartbeatControl", ctxA, {}, { moduleId: "x", op: "explode" });
    assert.equal(r.ok, false);
  });

  it("requires a moduleId", () => {
    const r = call("heartbeatControl", ctxA, {}, { op: "pause" });
    assert.equal(r.ok, false);
  });

  it("pauses and resumes a module", () => {
    const paused = call("heartbeatControl", ctxA, {}, { moduleId: "fauna-spawner", op: "pause" });
    assert.equal(paused.ok, true);
    assert.equal(paused.result.enabled, false);
    const resumed = call("heartbeatControl", ctxA, {}, { moduleId: "fauna-spawner", op: "resume" });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.result.enabled, true);
  });

  it("records a manual trigger request", () => {
    const r = call("heartbeatControl", ctxA, {}, { moduleId: "repair-cycle", op: "trigger" });
    assert.equal(r.ok, true);
    assert.equal(r.result.triggerRequests, 1);
    assert.ok(r.result.lastTriggerAt);
  });

  it("control state flows back into heartbeatRegistry", async () => {
    call("heartbeatControl", ctxA, {}, { moduleId: "season-cycle", op: "trigger" });
    const r = await call("heartbeatRegistry", ctxA, {}, {});
    assert.equal(r.ok, true);
    const m = r.result.modules.find((x) => x.id === "season-cycle");
    if (m) assert.ok(m.triggerRequests >= 1);
  });
});

describe("tick.uptimeSLA — historical uptime / SLA windows (#7)", () => {
  it("needs at least 2 samples", () => {
    const r = call("uptimeSLA", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2/);
  });

  it("computes uptime percentage across rolling windows", () => {
    call("recordSample", ctxA, {}, { ticks: 10 });
    call("recordSample", ctxA, {}, { ticks: 20 });
    call("recordSample", ctxA, {}, { ticks: 30 });
    const r = call("uptimeSLA", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.windows.length === 3);
    assert.equal(typeof r.result.slaTarget, "number");
    assert.ok(["operational", "down", "unknown"].includes(r.result.currentStatus));
  });
});
