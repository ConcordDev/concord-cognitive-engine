// Contract tests for server/domains/debug.js — the Sentry/Datadog-style
// observability suite: issue inbox, trace viewer, alert rules,
// time-series metrics, and release tracking. All macros are exercised
// against a fresh per-user STATE and asserted to return { ok }.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDebugActions from "../domains/debug.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`debug.${name}`);
  if (!fn) throw new Error(`debug.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDebugActions(register); });

beforeEach(() => {
  // Fresh STATE per test so per-user Maps don't leak across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("debug — issue inbox (live error stream)", () => {
  it("ingests an exception and creates a new issue", () => {
    const r = call("issue-ingest", ctxA, {
      type: "TypeError",
      message: "Cannot read property 'x' of undefined",
      culprit: "lens.js:42",
      level: "error",
      release: "v1.0.0",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.isNew, true);
    assert.equal(r.result.issue.count, 1);
    assert.equal(r.result.issue.status, "open");
  });

  it("rejects ingest without a message", () => {
    const r = call("issue-ingest", ctxA, { type: "Error" });
    assert.equal(r.ok, false);
  });

  it("groups repeat occurrences by fingerprint", () => {
    call("issue-ingest", ctxA, { type: "Error", message: "boom 1", culprit: "a.js" });
    const r2 = call("issue-ingest", ctxA, { type: "Error", message: "boom 2", culprit: "a.js" });
    assert.equal(r2.result.issue.count, 2);
    assert.equal(r2.result.isNew, false);
  });

  it("lists issues with a summary", () => {
    call("issue-ingest", ctxA, { type: "Error", message: "listed err" });
    const r = call("issue-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.equal(r.result.summary.open >= 1, true);
  });

  it("returns detail with a 24h sparkline", () => {
    const created = call("issue-ingest", ctxA, { type: "Error", message: "detail err" });
    const r = call("issue-detail", ctxA, { id: created.result.issue.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.sparkline.length, 24);
  });

  it("updates issue status + assignee (resolution workflow)", () => {
    const created = call("issue-ingest", ctxA, { type: "Error", message: "workflow err" });
    const r = call("issue-update", ctxA, {
      id: created.result.issue.id,
      status: "resolved",
      assignee: "dev_a",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.issue.status, "resolved");
    assert.equal(r.result.issue.assignee, "dev_a");
  });

  it("reopens a resolved issue on regression", () => {
    const created = call("issue-ingest", ctxA, { type: "Error", message: "regress" });
    call("issue-update", ctxA, { id: created.result.issue.id, status: "resolved" });
    const r = call("issue-ingest", ctxA, { type: "Error", message: "regress" });
    assert.equal(r.result.issue.status, "open");
    assert.equal(r.result.issue.regressed, true);
  });

  it("deletes an issue", () => {
    const created = call("issue-ingest", ctxA, { type: "Error", message: "del err" });
    const r = call("issue-delete", ctxA, { id: created.result.issue.id });
    assert.equal(r.ok, true);
    assert.equal(call("issue-detail", ctxA, { id: created.result.issue.id }).ok, false);
  });
});

describe("debug — distributed trace viewer", () => {
  it("records a trace and computes waterfall layout", () => {
    const base = Date.now();
    const r = call("trace-record", ctxA, {
      name: "request",
      spans: [
        { spanId: "root", name: "GET /x", service: "web", startMs: base, endMs: base + 100 },
        { spanId: "db", parentId: "root", name: "query", service: "db", startMs: base + 10, endMs: base + 60 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.trace.spanCount, 2);
    assert.ok(r.result.trace.spans.every((s) => typeof s.offsetPct === "number"));
  });

  it("rejects a trace with no spans", () => {
    const r = call("trace-record", ctxA, { spans: [] });
    assert.equal(r.ok, false);
  });

  it("lists traces", () => {
    const base = Date.now();
    call("trace-record", ctxA, {
      spans: [{ spanId: "a", name: "a", service: "s", startMs: base, endMs: base + 5 }],
    });
    const r = call("trace-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
  });

  it("returns trace detail with service breakdown", () => {
    const base = Date.now();
    const created = call("trace-record", ctxA, {
      spans: [
        { spanId: "a", name: "a", service: "web", startMs: base, endMs: base + 30 },
        { spanId: "b", name: "b", service: "db", startMs: base + 5, endMs: base + 20, status: "error" },
      ],
    });
    const r = call("trace-detail", ctxA, { id: created.result.trace.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.serviceBreakdown.length >= 1);
  });
});

describe("debug — time-series metrics", () => {
  it("records a metric sample", () => {
    const r = call("metric-record", ctxA, { metric: "cpu", value: 42, unit: "%" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sample.value, 42);
  });

  it("rejects a non-numeric metric value", () => {
    const r = call("metric-record", ctxA, { metric: "cpu", value: "high" });
    assert.equal(r.ok, false);
  });

  it("queries a metric series with stats", () => {
    call("metric-record", ctxA, { metric: "lat", value: 10 });
    call("metric-record", ctxA, { metric: "lat", value: 30 });
    const r = call("metric-series", ctxA, { metric: "lat" });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.count, 2);
    assert.equal(r.result.stats.avg, 20);
  });

  it("lists known metric names when no metric is given", () => {
    call("metric-record", ctxA, { metric: "mem", value: 1 });
    const r = call("metric-series", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.metrics.includes("mem"));
  });
});

describe("debug — alert rules", () => {
  it("creates an alert rule", () => {
    const r = call("alert-create", ctxA, {
      name: "high cpu",
      metric: "cpu",
      op: ">",
      threshold: 80,
      severity: "critical",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.rule.metric, "cpu");
  });

  it("rejects an invalid operator", () => {
    const r = call("alert-create", ctxA, { name: "bad", metric: "cpu", op: "~", threshold: 1 });
    assert.equal(r.ok, false);
  });

  it("breaches a rule when a recorded sample crosses the threshold", () => {
    call("alert-create", ctxA, { name: "cpu hi", metric: "cpu", op: ">", threshold: 50 });
    const r = call("metric-record", ctxA, { metric: "cpu", value: 90 });
    assert.equal(r.ok, true);
    assert.equal(r.result.breaches.length, 1);
  });

  it("lists alert rules with an alerting count", () => {
    call("alert-create", ctxA, { name: "r", metric: "x", op: ">", threshold: 1 });
    const r = call("alert-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
  });

  it("updates and deletes an alert rule", () => {
    const created = call("alert-create", ctxA, { name: "u", metric: "x", op: ">", threshold: 1 });
    const upd = call("alert-update", ctxA, { id: created.result.rule.id, enabled: false });
    assert.equal(upd.result.rule.enabled, false);
    const del = call("alert-delete", ctxA, { id: created.result.rule.id });
    assert.equal(del.ok, true);
  });
});

describe("debug — release tracking", () => {
  it("creates a release", () => {
    const r = call("release-create", ctxA, { version: "v2.0.0", environment: "production" });
    assert.equal(r.ok, true);
    assert.equal(r.result.release.version, "v2.0.0");
  });

  it("rejects a duplicate release version", () => {
    call("release-create", ctxA, { version: "v3.0.0" });
    const r = call("release-create", ctxA, { version: "v3.0.0" });
    assert.equal(r.ok, false);
  });

  it("ties ingested issues to a release in the list view", () => {
    call("release-create", ctxA, { version: "v4.0.0" });
    call("issue-ingest", ctxA, { type: "Error", message: "rel-tied", release: "v4.0.0" });
    const r = call("release-list", ctxA, {});
    assert.equal(r.ok, true);
    const rel = r.result.releases.find((x) => x.version === "v4.0.0");
    assert.ok(rel);
    assert.equal(rel.issueCount, 1);
    assert.equal(rel.crashFree, false);
  });

  it("deletes a release", () => {
    const created = call("release-create", ctxA, { version: "v5.0.0" });
    const r = call("release-delete", ctxA, { id: created.result.release.id });
    assert.equal(r.ok, true);
  });
});

describe("debug — analysis macros still parity-pass", () => {
  it("logAnalysis handles an empty log set", () => {
    const fn = ACTIONS.get("debug.logAnalysis");
    const r = fn(ctxA, { data: { logs: [] } }, {});
    assert.equal(r.ok, true);
  });

  it("errorCluster handles an empty error set", () => {
    const fn = ACTIONS.get("debug.errorCluster");
    const r = fn(ctxA, { data: { errors: [] } }, {});
    assert.equal(r.ok, true);
  });
});
