// tests/depth/admin-behavior.test.js — REAL behavioral tests (admin/ops-console lens-actions).
//
// admin.js is the `registerLensAction("admin", …)` family → invoked through the
// `lens.run` macro via the shared `lensRun(...)` harness. Calc macros (auditLog,
// permissionMatrix, systemHealth) compute deterministic analysis over artifact
// data; the ops-console macros (recordMetric, alertRule*, tenant*, log*, trace*,
// featureFlag*, incident*) round-trip through per-deployment globalThis state.
//
// NOTE: ops-console state lives in globalThis._concordSTATE.adminLens — shared
// across the whole process, NOT ctx-scoped. Tests therefore use unique metric
// names / ids so they don't collide, and assert exact computed values.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("admin — auditLog anomaly math", () => {
  it("auditLog: rapid-fire burst is flagged with the exact z-score type", async () => {
    // Ten actions spaced ~10min apart, then one only 1ms after the last → a
    // single gap massively below the mean → an unambiguous rapid-fire anomaly
    // whose z-score is well past the default stdDevThreshold of 2.
    const base = Date.parse("2026-01-01T00:00:00Z");
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push({ timestamp: new Date(base + i * 600000).toISOString(), userId: "u1", action: "read", resource: "/a" });
    }
    // last one 1ms after the 10th
    entries.push({ timestamp: new Date(base + 9 * 600000 + 1).toISOString(), userId: "u1", action: "read", resource: "/a" });
    const r = await lensRun("admin", "auditLog", { data: { entries } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEntries, 11);
    assert.equal(r.result.uniqueUsers, 1);
    // The tiny final gap produces exactly one rapid-fire anomaly.
    assert.ok(r.result.anomalies.some(a => a.type === "rapid-fire" && a.userId === "u1"));
    assert.equal(r.result.summary.rapidFireCount, 1);
  });

  it("auditLog: empty entries returns the no-data message", async () => {
    const r = await lensRun("admin", "auditLog", { data: { entries: [] } });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /no audit log entries/i);
  });

  it("auditLog: repeated failures with >30% failure rate raise a failed-access alert", async () => {
    const base = Date.parse("2026-02-01T00:00:00Z");
    const entries = [
      { timestamp: new Date(base + 0).toISOString(), userId: "bad", action: "login", resource: "/auth", success: false },
      { timestamp: new Date(base + 1000).toISOString(), userId: "bad", action: "login", resource: "/auth", success: false },
      { timestamp: new Date(base + 2000).toISOString(), userId: "bad", action: "login", resource: "/admin", success: false },
      { timestamp: new Date(base + 3000).toISOString(), userId: "bad", action: "login", resource: "/auth", success: true },
    ];
    const r = await lensRun("admin", "auditLog", { data: { entries } });
    assert.equal(r.ok, true);
    // 3 failures / 4 total = 75% > 30% → alert. failureRate is a percentage.
    const alert = r.result.failedAccessAlerts.find(a => a.userId === "bad");
    assert.ok(alert);
    assert.equal(alert.failedAttempts, 3);
    assert.equal(alert.totalAttempts, 4);
    assert.equal(alert.failureRate, 75);
    assert.ok(alert.resources.includes("/admin"));
  });

  it("auditLog: >5 distinct IPs for one user raises a suspicious-IP alert", async () => {
    const base = Date.parse("2026-03-01T00:00:00Z");
    const entries = [];
    for (let i = 0; i < 6; i++) {
      entries.push({ timestamp: new Date(base + i * 1000).toISOString(), userId: "roamer", action: "read", resource: "/x", ip: `10.0.0.${i}` });
    }
    const r = await lensRun("admin", "auditLog", { data: { entries } });
    assert.equal(r.ok, true);
    const ip = r.result.ipAlerts.find(a => a.userId === "roamer");
    assert.ok(ip);
    assert.equal(ip.uniqueIps, 6);
    assert.equal(r.result.summary.suspiciousIpCount, 1);
  });
});

describe("admin — permissionMatrix", () => {
  it("permissionMatrix: an over-privileged role (>70% of perms) and a subset role are detected", async () => {
    const roles = [
      { name: "superadmin", permissions: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] },
      { name: "reader", permissions: ["a"] },                       // subset of superadmin
      { name: "writer", permissions: ["a", "b"] },                  // subset of superadmin
    ];
    const r = await lensRun("admin", "permissionMatrix", { data: { roles, users: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPermissions, 10);
    // superadmin holds 10/10 = 100% > 70% → over-privileged.
    const over = r.result.overPrivilegedRoles.find(o => o.role === "superadmin");
    assert.ok(over);
    assert.equal(over.ratio, 100);
    // reader ⊂ superadmin and writer ⊂ superadmin → redundant pairs.
    assert.ok(r.result.redundantRoles.some(p => p.subset === "reader" && p.superset === "superadmin"));
  });

  it("permissionMatrix: a user holding two conflicting perms is a separation-of-duty violation", async () => {
    const roles = [
      { name: "purchaser", permissions: ["create_po"] },
      { name: "approver", permissions: ["approve_po"] },
    ];
    const users = [{ userId: "danny", roles: ["purchaser", "approver"] }];
    const sodRules = [{ name: "po-segregation", conflicting: ["create_po", "approve_po"] }];
    const r = await lensRun("admin", "permissionMatrix", { data: { roles, users, sodRules } });
    assert.equal(r.ok, true);
    const v = r.result.sodViolations.find(x => x.userId === "danny");
    assert.ok(v);
    assert.equal(v.rule, "po-segregation");
    assert.deepEqual(v.conflictingPermissions.sort(), ["approve_po", "create_po"]);
    assert.equal(r.result.summary.sodViolationCount, 1);
  });

  it("permissionMatrix: a user referencing an unknown role and a roleless user are reported", async () => {
    const roles = [{ name: "member", permissions: ["read"] }];
    const users = [
      { userId: "ghost", roles: ["nonexistent"] },
      { userId: "blank", roles: [] },
    ];
    const r = await lensRun("admin", "permissionMatrix", { data: { roles, users } });
    assert.equal(r.ok, true);
    assert.ok(r.result.unknownRoles.some(u => u.userId === "ghost" && u.role === "nonexistent"));
    assert.deepEqual(r.result.usersWithNoRoles, ["blank"]);
  });
});

describe("admin — systemHealth", () => {
  it("systemHealth: a healthy series scores high with healthy status and a stable trend", async () => {
    const base = Date.parse("2026-01-01T00:00:00Z");
    const metrics = [];
    for (let i = 0; i < 10; i++) {
      metrics.push({ timestamp: new Date(base + i * 60000).toISOString(), cpu: 10, memory: 20, disk: 30, latencyMs: 50, errorRate: 0.1 });
    }
    const r = await lensRun("admin", "systemHealth", { data: { metrics } });
    assert.equal(r.ok, true);
    assert.equal(r.result.healthStatus, "healthy");
    assert.ok(r.result.compositeScore > 80);
    // Flat series → cpu trend is stable.
    assert.equal(r.result.trends.cpu.direction, "stable");
    assert.equal(r.result.currentValues.cpu, 10);
  });

  it("systemHealth: metrics at/over critical thresholds emit critical alerts and a critical status", async () => {
    const base = Date.parse("2026-01-01T00:00:00Z");
    const metrics = [];
    for (let i = 0; i < 10; i++) {
      metrics.push({ timestamp: new Date(base + i * 60000).toISOString(), cpu: 95, memory: 92, disk: 91, latencyMs: 1500, errorRate: 8 });
    }
    const r = await lensRun("admin", "systemHealth", { data: { metrics } });
    assert.equal(r.ok, true);
    // Every metric at/over threshold → composite 0 → critical.
    assert.equal(r.result.compositeScore, 0);
    assert.equal(r.result.healthStatus, "critical");
    assert.ok(r.result.alerts.some(a => a.metric === "cpu" && a.severity === "critical"));
    assert.ok(r.result.alerts.some(a => a.metric === "latency" && a.severity === "critical"));
  });

  it("systemHealth: empty metrics returns the no-data message", async () => {
    const r = await lensRun("admin", "systemHealth", { data: { metrics: [] } });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /no metrics/i);
  });
});

describe("admin — time-series (recordMetric / metricHistory)", () => {
  it("recordMetric → metricHistory: points round-trip with exact min/max/avg stats", async () => {
    const metric = `depth_metric_${Date.now()}`;
    for (const v of [10, 20, 30]) {
      const w = await lensRun("admin", "recordMetric", { params: { metric, value: v } });
      assert.equal(w.result.metric, metric);
    }
    const h = await lensRun("admin", "metricHistory", { params: { metric, buckets: 600 } });
    assert.equal(h.ok, true);
    assert.equal(h.result.metric, metric);
    assert.equal(h.result.rawPoints, 3);
    assert.equal(h.result.stats.min, 10);
    assert.equal(h.result.stats.max, 30);
    assert.equal(h.result.stats.avg, 20);
    assert.equal(h.result.stats.count, 3);
  });

  it("recordMetric: rejects a non-numeric value and a missing metric name", async () => {
    const bad = await lensRun("admin", "recordMetric", { params: { metric: "m", value: "not-a-number" } });
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /value must be a number/i);
    const noName = await lensRun("admin", "recordMetric", { params: { value: 1 } });
    assert.equal(noName.result.ok, false);
    assert.match(String(noName.result.error), /metric is required/i);
  });
});

describe("admin — alert rules (alertRuleUpsert / alertEvaluate / alertRuleDelete)", () => {
  it("alertRuleUpsert → alertEvaluate: a rule fires when its metric breaches threshold", async () => {
    const metric = `alert_metric_${Date.now()}`;
    // Seed values well over the threshold.
    await lensRun("admin", "recordMetric", { params: { metric, value: 99 } });
    await lensRun("admin", "recordMetric", { params: { metric, value: 100 } });
    const up = await lensRun("admin", "alertRuleUpsert", { params: { rule: { name: `r-${metric}`, metric, comparator: ">", threshold: 50, severity: "critical", aggregation: "avg" } } });
    assert.equal(up.result.rule.metric, metric);
    assert.equal(up.result.rule.comparator, ">");
    const ruleId = up.result.rule.id;

    const ev = await lensRun("admin", "alertEvaluate", {});
    assert.equal(ev.ok, true);
    const mine = ev.result.rules.find(r => r.id === ruleId);
    assert.ok(mine);
    assert.equal(mine.observed, 99.5); // avg of 99,100
    assert.equal(mine.state, "firing");

    // Cleanup so the shared state doesn't leak firing rules into other suites.
    const del = await lensRun("admin", "alertRuleDelete", { params: { ruleId } });
    assert.equal(del.result.deleted, ruleId);
  });

  it("alertRuleUpsert: rejects a non-numeric threshold; alertRuleDelete rejects an unknown id", async () => {
    const bad = await lensRun("admin", "alertRuleUpsert", { params: { rule: { name: "x", metric: "y", threshold: "high" } } });
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /threshold must be a number/i);
    const noRule = await lensRun("admin", "alertRuleDelete", { params: { ruleId: "alert_nope" } });
    assert.equal(noRule.result.ok, false);
    assert.match(String(noRule.result.error), /rule not found/i);
  });
});

describe("admin — tenant actions (tenantAction / tenantList)", () => {
  it("tenantAction: suspend then role change round-trips into tenantList", async () => {
    const userId = `tenant_${Date.now()}`;
    const sus = await lensRun("admin", "tenantAction", { params: { userId, action: "suspend" } });
    assert.equal(sus.result.tenant.suspended, true);
    const role = await lensRun("admin", "tenantAction", { params: { userId, action: "role", role: "admin" } });
    assert.equal(role.result.tenant.role, "admin");
    assert.match(String(role.result.change), /role member -> admin/);

    const list = await lensRun("admin", "tenantList", { params: { filter: "suspended" } });
    assert.equal(list.ok, true);
    assert.ok(list.result.tenants.some(t => t.userId === userId && t.suspended === true && t.role === "admin"));
  });

  it("tenantAction: rejects a missing userId, an invalid role, and an unknown action", async () => {
    const noUser = await lensRun("admin", "tenantAction", { params: { action: "suspend" } });
    assert.equal(noUser.result.ok, false);
    assert.match(String(noUser.result.error), /userId is required/i);
    const badRole = await lensRun("admin", "tenantAction", { params: { userId: "u", action: "role", role: "god" } });
    assert.equal(badRole.result.ok, false);
    assert.match(String(badRole.result.error), /role must be one of/i);
    const badAction = await lensRun("admin", "tenantAction", { params: { userId: "u", action: "teleport" } });
    assert.equal(badAction.result.ok, false);
    assert.match(String(badAction.result.error), /action must be/i);
  });
});

describe("admin — log buffer (logAppend / logSearch)", () => {
  it("logAppend → logSearch: a substring + minLevel filter matches exactly the seeded error", async () => {
    const needle = `needle_${Date.now()}`;
    await lensRun("admin", "logAppend", { params: { level: "debug", message: `${needle} noise debug` } });
    await lensRun("admin", "logAppend", { params: { level: "error", message: `${needle} disk full`, source: "storage" } });
    const r = await lensRun("admin", "logSearch", { params: { query: needle, minLevel: "error" } });
    assert.equal(r.ok, true);
    // minLevel=error drops the debug line → exactly one match, our error.
    const matched = r.result.entries.filter(e => e.message.includes(needle));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].level, "error");
    assert.equal(matched[0].source, "storage");
  });

  it("logAppend: rejects an empty message", async () => {
    const r = await lensRun("admin", "logAppend", { params: { level: "info", message: "   " } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /message is required/i);
  });
});

describe("admin — traces (traceRecord / traceList)", () => {
  it("traceRecord → traceList: the slowest span is the bottleneck and totalMs derives from spans", async () => {
    const endpoint = `/depth/trace/${Date.now()}`;
    const rec = await lensRun("admin", "traceRecord", { params: { trace: { endpoint, spans: [
      { name: "auth", startMs: 0, durationMs: 5 },
      { name: "db-query", startMs: 5, durationMs: 200, service: "postgres" },
      { name: "render", startMs: 205, durationMs: 10 },
    ] } } });
    assert.equal(rec.result.spanCount, 3);
    // totalMs derives from max(endMs) = 205 + 10 = 215.
    assert.equal(rec.result.totalMs, 215);

    const list = await lensRun("admin", "traceList", { params: { endpoint, minMs: 0 } });
    assert.equal(list.ok, true);
    const tr = list.result.traces.find(t => t.endpoint === endpoint);
    assert.ok(tr);
    // db-query (200ms) is the critical-path bottleneck.
    assert.equal(tr.bottleneck.name, "db-query");
    assert.equal(tr.bottleneck.durationMs, 200);
  });

  it("traceRecord: rejects a trace with no endpoint", async () => {
    const r = await lensRun("admin", "traceRecord", { params: { trace: { spans: [] } } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /endpoint is required/i);
  });
});

describe("admin — feature flags (featureFlagSet / featureFlagList)", () => {
  it("featureFlagSet: create then toggle flips enabled and shows in the list", async () => {
    const key = `flag_${Date.now()}`;
    const created = await lensRun("admin", "featureFlagSet", { params: { flag: { key, enabled: false, description: "depth" } } });
    assert.equal(created.result.flag.key, key);
    assert.equal(created.result.flag.enabled, false);
    const id = created.result.flag.id;
    const toggled = await lensRun("admin", "featureFlagSet", { params: { toggle: id } });
    assert.equal(toggled.result.flag.enabled, true);

    const list = await lensRun("admin", "featureFlagList", {});
    assert.equal(list.ok, true);
    assert.ok(list.result.flags.some(f => f.id === id && f.enabled === true && f.key === key));
  });

  it("featureFlagSet: rejects a flag with no key and a toggle of an unknown id", async () => {
    const noKey = await lensRun("admin", "featureFlagSet", { params: { flag: {} } });
    assert.equal(noKey.result.ok, false);
    assert.match(String(noKey.result.error), /key is required/i);
    const noFlag = await lensRun("admin", "featureFlagSet", { params: { toggle: "flag_nope" } });
    assert.equal(noFlag.result.ok, false);
    assert.match(String(noFlag.result.error), /flag not found/i);
  });
});

describe("admin — incidents (incidentOpen / incidentUpdate / incidentList)", () => {
  it("incidentOpen → acknowledge → resolve: status + timeline + durationMs round-trip", async () => {
    const title = `Outage ${Date.now()}`;
    const open = await lensRun("admin", "incidentOpen", { params: { title, severity: "sev1", service: "api" } });
    assert.equal(open.result.incident.status, "open");
    assert.equal(open.result.incident.severity, "sev1");
    const id = open.result.incident.id;

    const ack = await lensRun("admin", "incidentUpdate", { params: { incidentId: id, action: "acknowledge", note: "on it" } });
    assert.equal(ack.result.incident.status, "acknowledged");
    assert.ok(ack.result.incident.acknowledgedAt);

    const res = await lensRun("admin", "incidentUpdate", { params: { incidentId: id, action: "resolve" } });
    assert.equal(res.result.incident.status, "resolved");
    assert.equal(typeof res.result.incident.durationMs, "number");
    // Timeline records opened → acknowledged → resolved (≥3 entries).
    assert.ok(res.result.incident.timeline.some(t => t.kind === "acknowledged"));
    assert.ok(res.result.incident.timeline.some(t => t.kind === "resolved"));

    const list = await lensRun("admin", "incidentList", { params: { status: "resolved" } });
    assert.ok(list.result.incidents.some(i => i.id === id));
  });

  it("incidentUpdate: resolving twice is rejected; missing title is rejected on open", async () => {
    const open = await lensRun("admin", "incidentOpen", { params: { title: `Dup ${Date.now()}` } });
    const id = open.result.incident.id;
    await lensRun("admin", "incidentUpdate", { params: { incidentId: id, action: "resolve" } });
    const again = await lensRun("admin", "incidentUpdate", { params: { incidentId: id, action: "resolve" } });
    assert.equal(again.result.ok, false);
    assert.match(String(again.result.error), /already resolved/i);

    const noTitle = await lensRun("admin", "incidentOpen", { params: { severity: "sev2" } });
    assert.equal(noTitle.result.ok, false);
    assert.match(String(noTitle.result.error), /title is required/i);
  });
});
