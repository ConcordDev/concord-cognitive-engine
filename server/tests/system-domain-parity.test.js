// Contract tests for server/domains/system.js — the System Lens backend
// (the "Datadog / Grafana" of the Concord cognitive OS).
//
// Exercises every macro the System Lens UI wires: live time-series
// (sample / metrics / live-status), Prometheus alerting (alerts / alert-ack),
// log search (logs), per-heartbeat health (heartbeat-health), distributed
// traces (trace-record / traces), customizable dashboards (dashboard-load /
// save / reset), and historical trend snapshots (history-snapshot / history).
//
// Pattern mirrors server/tests/travel-domain-parity.test.js.
//
// Run: node --test tests/system-domain-parity.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSystemActions from "../domains/system.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`system.${name}`);
  if (!fn) throw new Error(`system.${name} not registered`);
  const artifact = { id: null, data: {}, meta: {} };
  return await fn(ctx, artifact, params);
}

before(() => { registerSystemActions(register); });

// Each test gets a clean shared STATE so per-user maps don't leak across cases.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_sys_a" }, userId: "user_sys_a" };
const ctxB = { actor: { userId: "user_sys_b" }, userId: "user_sys_b" };

describe("system domain — macro registration", () => {
  it("registers every macro the System Lens UI calls", () => {
    const expected = [
      "sample", "metrics", "alerts", "alert-ack", "logs",
      "heartbeat-health", "trace-record", "traces",
      "dashboard-load", "dashboard-save", "dashboard-reset",
      "history-snapshot", "history", "live-status",
    ];
    for (const name of expected) {
      assert.ok(ACTIONS.has(`system.${name}`), `system.${name} should be registered`);
    }
  });
});

describe("system.sample / system.metrics (live time-series)", () => {
  it("sample captures a real process telemetry point", async () => {
    const r = await call("sample", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.at, "sample has ISO timestamp");
    assert.ok(typeof r.result.heapUsedMB === "number");
    assert.ok(r.result.heapUsedMB > 0, "real heap reading");
    assert.ok(typeof r.result.cpuPct === "number");
    assert.ok(typeof r.result.uptimeSec === "number");
  });

  it("metrics returns the accumulated ring buffer + summary", async () => {
    await call("sample", ctxA, {});
    await call("sample", ctxA, {});
    const r = await call("metrics", ctxA, { limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.samples));
    assert.ok(r.result.count >= 2);
    assert.ok(r.result.latest, "latest sample present");
    assert.ok(typeof r.result.peakHeapMB === "number");
    assert.ok(typeof r.result.avgCpuPct === "number");
  });

  it("metrics auto-captures a point so the chart is never empty", async () => {
    const r = await call("metrics", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1, "fresh sample auto-captured");
  });
});

describe("system.alerts / system.alert-ack (Prometheus alerting)", () => {
  it("alerts loads + evaluates rules", async () => {
    const r = await call("alerts", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.rules));
    assert.ok(typeof r.result.ruleCount === "number");
    assert.ok(typeof r.result.firingCount === "number");
    assert.ok(Array.isArray(r.result.firing));
  });

  it("alert-ack rejects an empty alert name", async () => {
    const r = await call("alert-ack", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("alert-ack records + clears a per-user acknowledgement", async () => {
    const ack = await call("alert-ack", ctxA, { name: "ConcordHighMemory", note: "investigating" });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.acknowledged, true);
    assert.equal(ack.result.ackNote, "investigating");

    const unack = await call("alert-ack", ctxA, { name: "ConcordHighMemory", unack: true });
    assert.equal(unack.ok, true);
    assert.equal(unack.result.acknowledged, false);
  });

  it("acknowledgements are scoped per-user", async () => {
    await call("alert-ack", ctxA, { name: "ConcordHeartbeatStopped" });
    const aAlerts = await call("alerts", ctxA, {});
    const bAlerts = await call("alerts", ctxB, {});
    const aRule = aAlerts.result.rules.find((x) => x.name === "ConcordHeartbeatStopped");
    const bRule = bAlerts.result.rules.find((x) => x.name === "ConcordHeartbeatStopped");
    if (aRule) assert.equal(aRule.acknowledged, true);
    if (bRule) assert.equal(bRule.acknowledged, false);
  });
});

describe("system.logs (log viewer / search)", () => {
  it("queries the in-process logger buffer with a level tally", async () => {
    const r = await call("logs", ctxA, { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.entries));
    assert.ok(r.result.tally && typeof r.result.tally.error === "number");
    assert.ok(Array.isArray(r.result.sources));
  });

  it("accepts a level filter without throwing", async () => {
    const r = await call("logs", ctxA, { level: "error", search: "x" });
    assert.equal(r.ok, true);
  });
});

describe("system.heartbeat-health (per-heartbeat health)", () => {
  it("returns module health + summary verdict", async () => {
    const r = await call("heartbeat-health", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.modules));
    assert.ok(r.result.summary && typeof r.result.summary.total === "number");
    for (const m of r.result.modules) {
      assert.ok(["ok", "stale", "error", "pending"].includes(m.health));
      assert.ok(typeof m.errorCount === "number");
      assert.ok(typeof m.skipCount === "number");
    }
  });
});

describe("system.trace-record / system.traces (distributed traces)", () => {
  it("trace-record stores a span", async () => {
    const r = await call("trace-record", ctxA, {
      route: "/api/test", method: "POST", durationMs: 42, status: 200,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.route, "/api/test");
    assert.equal(r.result.durationMs, 42);
  });

  it("traces returns spans + latency percentiles + route rollup", async () => {
    await call("trace-record", ctxA, { route: "/api/a", durationMs: 10, status: 200 });
    await call("trace-record", ctxA, { route: "/api/a", durationMs: 90, status: 500 });
    const r = await call("traces", ctxA, { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.spans));
    assert.ok(typeof r.result.p50 === "number");
    assert.ok(typeof r.result.p95 === "number");
    assert.ok(typeof r.result.p99 === "number");
    assert.ok(Array.isArray(r.result.routes));
    assert.ok(typeof r.result.errorRate === "number");
  });
});

describe("system.dashboard-load / save / reset (customizable panels)", () => {
  it("dashboard-load returns the default layout when uncustomised", async () => {
    const r = await call("dashboard-load", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.isDefault, true);
    assert.ok(r.result.panels.length > 0);
  });

  it("dashboard-save rejects a missing panels array", async () => {
    const r = await call("dashboard-save", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("dashboard-save persists + sanitizes a custom layout", async () => {
    const save = await call("dashboard-save", ctxA, {
      panels: [
        { id: "x1", kind: "metric", metric: "cpuPct", title: "CPU", w: 2 },
        { id: "x2", kind: "alerts", title: "Alerts", w: 1 },
        { id: "x3", kind: "bogus", metric: "evil", w: 99 },
      ],
    });
    assert.equal(save.ok, true);
    assert.equal(save.result.panels.length, 3);
    // bogus kind coerced to metric, width clamped to 3.
    assert.equal(save.result.panels[2].kind, "metric");
    assert.ok(save.result.panels[2].w <= 3);

    const load = await call("dashboard-load", ctxA, {});
    assert.equal(load.result.isDefault, false);
    assert.equal(load.result.panels.length, 3);
  });

  it("dashboard-reset restores the default layout", async () => {
    await call("dashboard-save", ctxA, { panels: [{ id: "y1", kind: "alerts", title: "A", w: 1 }] });
    const reset = await call("dashboard-reset", ctxA, {});
    assert.equal(reset.ok, true);
    const load = await call("dashboard-load", ctxA, {});
    assert.equal(load.result.isDefault, true);
  });
});

describe("system.history-snapshot / system.history (trend)", () => {
  it("history returns a snapshot timeline (empty before any capture)", async () => {
    const r = await call("history", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.snapshots));
    assert.ok(typeof r.result.capacity === "number");
  });

  it("history-snapshot returns a structured result (ok or cartograph_not_run)", async () => {
    const r = await call("history-snapshot", ctxA, {});
    assert.ok(typeof r.ok === "boolean");
    if (!r.ok) {
      assert.equal(r.error, "cartograph_not_run");
    } else {
      assert.ok(r.result.snapshot);
      assert.ok(typeof r.result.snapshot.coveragePct === "number");
    }
  });
});

describe("system.live-status (auto-refresh aggregate)", () => {
  it("returns one bundle of sample + heartbeat + alert counts", async () => {
    const r = await call("live-status", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.sample, "fresh sample");
    assert.ok(r.result.heartbeats && typeof r.result.heartbeats.total === "number");
    assert.ok(r.result.alerts && typeof r.result.alerts.firing === "number");
    assert.ok(typeof r.result.traceCount === "number");
    assert.ok(r.result.pollAt, "poll timestamp");
  });
});

describe("system domain — never-throw invariant", () => {
  it("every macro returns a plain { ok } object even with junk input", async () => {
    const names = [
      "sample", "metrics", "alerts", "alert-ack", "logs",
      "heartbeat-health", "trace-record", "traces",
      "dashboard-load", "dashboard-save", "dashboard-reset",
      "history-snapshot", "history", "live-status",
    ];
    for (const name of names) {
      const r = await call(name, ctxA, { limit: "bad", panels: "nope", durationMs: "NaN" });
      assert.ok(r && typeof r.ok === "boolean", `system.${name} returns { ok }`);
    }
  });
});
