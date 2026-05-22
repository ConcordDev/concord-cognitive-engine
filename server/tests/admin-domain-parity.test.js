// Contract tests for server/domains/admin.js — the Datadog/Grafana-parity
// ops-console backlog macros. Exercises every macro and asserts ok envelopes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAdminActions from "../domains/admin.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`admin.${name}`);
  if (!fn) throw new Error(`admin.${name} not registered`);
  const artifact =
    arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? maybeParams || {} : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => {
  registerAdminActions(register);
});

// Each test starts from a clean ops-state container.
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.adminLens;
});

const ctx = { actor: { userId: "admin_a" }, userId: "admin_a" };

describe("admin — time-series history", () => {
  it("records a metric point and reads it back", () => {
    const rec = call("recordMetric", ctx, {}, { metric: "cpu", value: 42 });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.metric, "cpu");
    assert.equal(rec.result.points, 1);

    const hist = call("metricHistory", ctx, {}, { metric: "cpu", rangeMinutes: 60 });
    assert.equal(hist.ok, true);
    assert.equal(hist.result.series.length, 1);
    assert.equal(hist.result.stats.count, 1);
  });

  it("rejects a non-numeric value", () => {
    const r = call("recordMetric", ctx, {}, { metric: "cpu", value: "nope" });
    assert.equal(r.ok, false);
  });

  it("lists available metrics when no metric is given", () => {
    call("recordMetric", ctx, {}, { metric: "mem", value: 10 });
    const r = call("metricHistory", ctx, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.metrics[0].metric, "mem");
  });
});

describe("admin — alert rules", () => {
  it("upserts, evaluates firing state, and deletes a rule", () => {
    call("recordMetric", ctx, {}, { metric: "lat", value: 900 });
    const up = call("alertRuleUpsert", ctx, {}, {
      rule: { name: "high-latency", metric: "lat", comparator: ">", threshold: 500 },
    });
    assert.equal(up.ok, true);
    const ruleId = up.result.rule.id;

    const ev = call("alertEvaluate", ctx, {}, {});
    assert.equal(ev.ok, true);
    assert.equal(ev.result.rules.length, 1);
    assert.equal(ev.result.rules[0].state, "firing");
    assert.equal(ev.result.summary.firing, 1);

    const del = call("alertRuleDelete", ctx, {}, { ruleId });
    assert.equal(del.ok, true);
    assert.equal(del.result.totalRules, 0);
  });

  it("rejects an upsert with no threshold", () => {
    const r = call("alertRuleUpsert", ctx, {}, { rule: { name: "x", metric: "y" } });
    assert.equal(r.ok, false);
  });
});

describe("admin — tenant administration", () => {
  it("suspends, role-changes, quota-edits and lists tenants", () => {
    const susp = call("tenantAction", ctx, {}, { userId: "u1", action: "suspend" });
    assert.equal(susp.ok, true);
    assert.equal(susp.result.tenant.suspended, true);

    const role = call("tenantAction", ctx, {}, {
      userId: "u1",
      action: "role",
      role: "moderator",
    });
    assert.equal(role.ok, true);
    assert.equal(role.result.tenant.role, "moderator");

    const quota = call("tenantAction", ctx, {}, {
      userId: "u1",
      action: "quota",
      quotaMb: 4096,
    });
    assert.equal(quota.ok, true);
    assert.equal(quota.result.tenant.quotaMb, 4096);

    const list = call("tenantList", ctx, {}, { filter: "suspended" });
    assert.equal(list.ok, true);
    assert.equal(list.result.tenants.length, 1);
    assert.equal(list.result.summary.suspended, 1);
  });

  it("rejects an unknown tenant action", () => {
    const r = call("tenantAction", ctx, {}, { userId: "u2", action: "explode" });
    assert.equal(r.ok, false);
  });
});

describe("admin — log search / tail", () => {
  it("appends a log line and finds it via search", () => {
    const app = call("logAppend", ctx, {}, {
      level: "error",
      message: "disk full on shard 3",
      source: "storage",
    });
    assert.equal(app.ok, true);

    const search = call("logSearch", ctx, {}, { minLevel: "warn", query: "disk" });
    assert.equal(search.ok, true);
    assert.equal(search.result.entries.length, 1);
    assert.equal(search.result.entries[0].level, "error");
    assert.equal(search.result.byLevel.error, 1);
  });

  it("rejects an empty log message", () => {
    const r = call("logAppend", ctx, {}, { level: "info", message: "" });
    assert.equal(r.ok, false);
  });
});

describe("admin — distributed traces", () => {
  it("records a trace with spans and lists slowest-first", () => {
    const rec = call("traceRecord", ctx, {}, {
      trace: {
        endpoint: "/api/slow",
        spans: [
          { name: "db", startMs: 0, durationMs: 120 },
          { name: "render", startMs: 120, durationMs: 30 },
        ],
      },
    });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.spanCount, 2);

    const list = call("traceList", ctx, {}, { minMs: 0 });
    assert.equal(list.ok, true);
    assert.equal(list.result.traces.length, 1);
    assert.equal(list.result.traces[0].bottleneck.name, "db");
    assert.equal(list.result.stats.total, 1);
  });

  it("rejects a trace with no endpoint", () => {
    const r = call("traceRecord", ctx, {}, { trace: { spans: [] } });
    assert.equal(r.ok, false);
  });
});

describe("admin — feature flags", () => {
  it("creates, toggles and lists a feature flag", () => {
    const set = call("featureFlagSet", ctx, {}, {
      flag: { key: "new-ui", description: "rollout the new shell" },
    });
    assert.equal(set.ok, true);
    const flagId = set.result.flag.id;
    assert.equal(set.result.flag.enabled, false);

    const toggle = call("featureFlagSet", ctx, {}, { toggle: flagId });
    assert.equal(toggle.ok, true);
    assert.equal(toggle.result.flag.enabled, true);

    const list = call("featureFlagList", ctx, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.flags.length, 1);
    assert.equal(list.result.summary.enabled, 1);
  });

  it("rejects a flag with no key", () => {
    const r = call("featureFlagSet", ctx, {}, { flag: {} });
    assert.equal(r.ok, false);
  });
});

describe("admin — incidents + on-call", () => {
  it("opens, acknowledges, notes and resolves an incident", () => {
    const open = call("incidentOpen", ctx, {}, {
      title: "API outage",
      severity: "sev1",
      service: "gateway",
    });
    assert.equal(open.ok, true);
    const incidentId = open.result.incident.id;
    assert.equal(open.result.incident.status, "open");

    const ack = call("incidentUpdate", ctx, {}, { incidentId, action: "acknowledge" });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.incident.status, "acknowledged");
    assert.equal(ack.result.incident.acknowledgedBy, "admin_a");

    const note = call("incidentUpdate", ctx, {}, {
      incidentId,
      action: "note",
      note: "rolling back deploy",
    });
    assert.equal(note.ok, true);

    const resolve = call("incidentUpdate", ctx, {}, { incidentId, action: "resolve" });
    assert.equal(resolve.ok, true);
    assert.equal(resolve.result.incident.status, "resolved");
    assert.ok(resolve.result.incident.durationMs != null);

    const list = call("incidentList", ctx, {}, { status: "resolved" });
    assert.equal(list.ok, true);
    assert.equal(list.result.incidents.length, 1);
    assert.equal(list.result.summary.resolved, 1);
  });

  it("rejects an incident with no title", () => {
    const r = call("incidentOpen", ctx, {}, { severity: "sev2" });
    assert.equal(r.ok, false);
  });

  it("rejects acknowledging an unknown incident", () => {
    const r = call("incidentUpdate", ctx, {}, {
      incidentId: "nope",
      action: "acknowledge",
    });
    assert.equal(r.ok, false);
  });
});
