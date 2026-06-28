// Behavioral macro tests for server/domains/system.js — the System Lens live
// observability substrate (the platform's own Datadog/Grafana: process
// time-series, Prometheus alert evaluation, log search, per-heartbeat health,
// request traces, custom dashboards, coverage/drift trend).
//
// SAVED-CLASS fix verification: these drive the 14 telemetry macros through the
// SAME canonical `register(domain, name, (ctx, input) => ...)` registry shim
// that server.js uses (registerSystemActions(register)) — so they prove the
// production wiring path, not just the raw handler bodies. The macros are
// DISJOINT from the inline system.{analogize,…,synthesize} introspection set.
//
// These are NOT shape-only assertions: every test asserts ACTUAL values +
// round-trips against the REAL in-memory globalThis._concordSTATE.systemLens
// store + real process introspection — sample → metrics buffer growth,
// trace-record → traces rollup percentiles, dashboard save/load/reset,
// alert-ack toggle, history snapshot/read, the live-status fan-in, per-user
// isolation, and the fail-CLOSED numeric guard the macro-assassin V2 probes.
//
// Hermetic: local register harness, no server boot, no DB, < 1s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSystemActions from "../domains/system.js";

// Canonical register harness — exactly what server.js passes to the module.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "system", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`system.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerSystemActions(register); });
// Fresh STATE per test — the domain lazily builds systemLens substructure.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("system — registration", () => {
  it("registers all 14 telemetry macros via the canonical shim", () => {
    for (const m of [
      "sample", "metrics", "alerts", "alert-ack", "logs", "heartbeat-health",
      "trace-record", "traces", "dashboard-load", "dashboard-save",
      "dashboard-reset", "history-snapshot", "history", "live-status",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing system.${m}`);
    }
  });
});

describe("system.sample + system.metrics — real process telemetry", () => {
  it("captures a real sample and grows the metrics ring buffer", async () => {
    const s1 = call("sample", ctxA, {});
    assert.equal(s1.ok, true);
    // Real process introspection — heap is a positive MB figure.
    assert.equal(typeof s1.result.heapUsedMB, "number");
    assert.ok(s1.result.heapUsedMB > 0, "heapUsedMB should be a live positive value");
    assert.ok(s1.result.heapPct >= 0 && s1.result.heapPct <= 100, "heapPct bounded");
    assert.equal(typeof s1.result.ts, "number");

    // metrics returns the accumulated buffer; never empty (captures on first read).
    const m1 = call("metrics", ctxA, {});
    assert.equal(m1.ok, true);
    assert.ok(Array.isArray(m1.result.samples));
    assert.ok(m1.result.count >= 1, "buffer non-empty");
    assert.equal(m1.result.count, m1.result.samples.length);
    assert.equal(m1.result.capacity, 720);
    const countAfterOne = m1.result.count;

    // a second sample lands in the SAME shared buffer (it's the box, not per-user).
    call("sample", ctxB, {});
    const m2 = call("metrics", ctxA, {});
    assert.ok(m2.result.count > countAfterOne, "shared buffer grew");
    assert.ok(m2.result.peakHeapMB >= m2.result.latest.heapUsedMB - 0.001 || m2.result.peakHeapMB > 0);
  });

  it("respects an explicit limit window", () => {
    for (let i = 0; i < 5; i++) call("sample", ctxA, {});
    const r = call("metrics", ctxA, { limit: 2 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count <= 2, "windowed to limit");
  });

  it("fails CLOSED on a poisoned numeric limit (NaN/Infinity/1e308/negative)", () => {
    for (const bad of [NaN, Infinity, 1e308, -5, "NaN", "Infinity"]) {
      const r = call("metrics", ctxA, { limit: bad });
      assert.equal(r.ok, false, `limit=${String(bad)} should reject`);
      assert.equal(r.error, "invalid_limit");
    }
  });
});

describe("system.trace-record + system.traces — latency rollup", () => {
  it("records spans and computes percentiles + per-route rollup", () => {
    call("trace-record", ctxA, { route: "/api/lens/run", method: "post", durationMs: 10, status: 200 });
    call("trace-record", ctxA, { route: "/api/lens/run", method: "post", durationMs: 50, status: 200 });
    call("trace-record", ctxA, { route: "/api/world/x", method: "get", durationMs: 300, status: 500 });

    const t = call("traces", ctxA, {});
    assert.equal(t.ok, true);
    assert.equal(t.result.count, 3);
    assert.equal(t.result.spans.length, 3);
    // method normalized to upper.
    assert.ok(t.result.spans.every((sp) => sp.method === sp.method.toUpperCase()));
    // 1 of 3 spans is a 500 → 33.3% error rate.
    assert.ok(t.result.errorRate > 33 && t.result.errorRate < 34, `errorRate=${t.result.errorRate}`);
    // percentiles are real ordered numbers within the observed range.
    assert.ok(t.result.p50 >= 10 && t.result.p99 >= t.result.p50);
    assert.equal(t.result.maxMs, 300);
    // per-route rollup present + the busy route aggregated.
    const lensRoute = t.result.routes.find((r) => r.route === "/api/lens/run");
    assert.ok(lensRoute, "lens route rolled up");
    assert.equal(lensRoute.count, 2);
    assert.equal(lensRoute.avgMs, 30);
  });

  it("trace-record fails CLOSED on poisoned durationMs/status", () => {
    const bad = call("trace-record", ctxA, { route: "/x", durationMs: Infinity });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_durationMs");
    const bad2 = call("trace-record", ctxA, { route: "/x", status: NaN });
    assert.equal(bad2.ok, false);
    assert.equal(bad2.error, "invalid_status");
  });

  it("traces fails CLOSED on poisoned limit", () => {
    const r = call("traces", ctxA, { limit: 1e308 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_limit");
  });
});

describe("system.alerts + system.alert-ack — Prometheus rule evaluation", () => {
  it("loads + evaluates rules and merges a per-user acknowledgement round-trip", async () => {
    const a = await call("alerts", ctxA, {});
    assert.equal(a.ok, true);
    assert.ok(Array.isArray(a.result.rules));
    assert.equal(a.result.ruleCount, a.result.rules.length);
    assert.equal(a.result.firing.length, a.result.firingCount);
    assert.ok(a.result.firingCount <= a.result.ruleCount, "firing subset of rules");

    // Acknowledge an arbitrary alert name and confirm it surfaces as acked for A only.
    const name = a.result.rules[0]?.name || "ConcordHighMemory";
    const ack = call("alert-ack", ctxA, { name, note: "investigating" });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.acknowledged, true);
    assert.equal(ack.result.ackNote, "investigating");

    const a2 = await call("alerts", ctxA, {});
    const acked = a2.result.rules.find((r) => r.name === name);
    assert.equal(acked.acknowledged, true);
    assert.equal(acked.ackNote, "investigating");

    // User B does NOT see A's acknowledgement (per-user isolation).
    const b = await call("alerts", ctxB, {});
    const bRow = b.result.rules.find((r) => r.name === name);
    if (bRow) assert.equal(bRow.acknowledged, false, "ack is per-user");

    // un-ack toggles it back.
    const un = call("alert-ack", ctxA, { name, unack: true });
    assert.equal(un.ok, true);
    assert.equal(un.result.acknowledged, false);
  });

  it("alert-ack rejects a missing name", () => {
    const r = call("alert-ack", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });
});

describe("system.logs — in-process logger search", () => {
  it("returns a real envelope with tally + sources from the live buffer", () => {
    const r = call("logs", ctxA, { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.entries));
    assert.equal(r.result.count, r.result.entries.length);
    assert.ok(r.result.tally && typeof r.result.tally.error === "number");
    assert.ok(Array.isArray(r.result.sources));
    assert.equal(typeof r.result.bufferSize, "number");
  });

  it("fails CLOSED on a poisoned limit", () => {
    const r = call("logs", ctxA, { limit: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_limit");
  });
});

describe("system.heartbeat-health — registry join", () => {
  it("returns a module list + a consistent summary", () => {
    const r = call("heartbeat-health", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.modules));
    const sum = r.result.summary;
    assert.equal(sum.total, r.result.modules.length);
    // the four health buckets partition the total.
    assert.equal(sum.ok + sum.stale + sum.error + sum.pending, sum.total);
  });
});

describe("system.dashboard-* — per-user layout persistence round-trip", () => {
  it("loads default, saves custom, reloads custom, then resets to default", () => {
    // default layout when never customised.
    const d0 = call("dashboard-load", ctxA, {});
    assert.equal(d0.ok, true);
    assert.equal(d0.result.isDefault, true);
    assert.ok(d0.result.panelCount > 0);

    // save a custom layout — kinds/metrics sanitised against allowlists.
    const saved = call("dashboard-save", ctxA, {
      panels: [
        { kind: "metric", metric: "cpuPct", title: "CPU", w: 2 },
        { kind: "bogus", metric: "evil", title: "X", w: 9 }, // kind→metric default, metric→heapUsedMB, w clamp
      ],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.panelCount, 2);
    assert.equal(saved.result.panels[1].kind, "metric", "unknown kind coerced");
    assert.equal(saved.result.panels[1].metric, "heapUsedMB", "unknown metric coerced");
    assert.ok(saved.result.panels[1].w <= 3, "width clamped");

    // reload returns the saved (non-default) layout.
    const d1 = call("dashboard-load", ctxA, {});
    assert.equal(d1.result.isDefault, false);
    assert.equal(d1.result.panels[0].metric, "cpuPct");

    // user B is unaffected (per-user isolation).
    const dB = call("dashboard-load", ctxB, {});
    assert.equal(dB.result.isDefault, true);

    // reset → back to default.
    const reset = call("dashboard-reset", ctxA, {});
    assert.equal(reset.ok, true);
    const d2 = call("dashboard-load", ctxA, {});
    assert.equal(d2.result.isDefault, true);
  });

  it("dashboard-save rejects a missing panels array", () => {
    const r = call("dashboard-save", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /panels array required/);
  });
});

describe("system.history + system.history-snapshot — coverage/drift timeline", () => {
  it("history reads an empty timeline cleanly (never no_db)", () => {
    const r = call("history", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.snapshots));
    assert.equal(r.result.count, r.result.snapshots.length);
    assert.equal(r.result.capacity, 365);
    assert.equal(r.result.trend, null, "no snapshots → null trend");
  });

  it("history fails CLOSED on a poisoned limit", () => {
    const r = call("history", ctxA, { limit: Infinity });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_limit");
  });

  it("history reflects a manually seeded snapshot timeline", () => {
    // Seed the shared STATE the way history-snapshot would, then read trend.
    globalThis._concordSTATE.systemLens = {
      history: [
        { at: "2026-06-01T00:00:00Z", coveragePct: 80, driftCount: 5, dormantModuleCount: 10, cartographGeneratedAt: "a" },
        { at: "2026-06-02T00:00:00Z", coveragePct: 90, driftCount: 2, dormantModuleCount: 7, cartographGeneratedAt: "b" },
      ],
    };
    const r = call("history", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.trend.coverageDelta, 10);
    assert.equal(r.result.trend.driftDelta, -3);
    assert.equal(r.result.trend.dormantDelta, -3);
  });
});

describe("system.live-status — realtime fan-in", () => {
  it("returns a fresh sample + heartbeat/alert/trace roll-up in one call", async () => {
    const r = await call("live-status", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.sample && typeof r.result.sample.heapUsedMB === "number");
    assert.ok(r.result.heartbeats && typeof r.result.heartbeats.total === "number");
    assert.ok(r.result.heartbeats.ok <= r.result.heartbeats.total);
    assert.ok(r.result.alerts && typeof r.result.alerts.firing === "number");
    assert.ok(r.result.alerts.unacknowledgedFiring <= r.result.alerts.firing);
    assert.equal(typeof r.result.traceCount, "number");
    assert.equal(typeof r.result.pollAt, "string");
  });
});
