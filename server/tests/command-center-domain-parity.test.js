// Contract tests for the command-center lens — Datadog/PagerDuty-shape ops
// cockpit substrate in server/domains/commandcenter.js. One test per macro
// added for the feature-parity backlog (time-series, alerting, dashboards,
// incidents, correlation, health rollup, runbooks).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCommandCenterActions from "../domains/commandcenter.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, data = {}) {
  const fn = ACTIONS.get(`command-center.${name}`);
  assert.ok(fn, `command-center.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => { registerCommandCenterActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("command-center.recordVital + vitalHistory + vitalMetrics", () => {
  it("records a real point and reads it back windowed with stats", () => {
    assert.equal(call("recordVital", ctxA, { metric: "heap_mb", value: 120 }).ok, true);
    call("recordVital", ctxA, { metric: "heap_mb", value: 140 });
    const h = call("vitalHistory", ctxA, { metric: "heap_mb" });
    assert.equal(h.result.count, 2);
    assert.equal(h.result.stats.max, 140);
    assert.equal(h.result.stats.latest, 140);
  });
  it("rejects missing metric or non-numeric value", () => {
    assert.equal(call("recordVital", ctxA, { value: 1 }).ok, false);
    assert.equal(call("recordVital", ctxA, { metric: "x", value: "nope" }).ok, false);
  });
  it("returns empty state for an unrecorded metric", () => {
    const h = call("vitalHistory", ctxA, { metric: "never" });
    assert.equal(h.result.count, 0);
    assert.match(h.result.message, /no data/);
  });
  it("vitalMetrics lists recorded metrics per user, isolated", () => {
    call("recordVital", ctxA, { metric: "cpu", value: 5 });
    assert.equal(call("vitalMetrics", ctxA).result.count, 1);
    assert.equal(call("vitalMetrics", ctxB).result.count, 0);
  });
});

describe("command-center.alert rules + acknowledge + mute + delete", () => {
  it("creates a rule, fires it on a breaching point, acknowledges it", () => {
    const rule = call("createAlertRule", ctxA, { name: "Heap high", metric: "heap_mb", comparator: "gt", threshold: 100, severity: "high" });
    assert.equal(rule.ok, true);
    const rec = call("recordVital", ctxA, { metric: "heap_mb", value: 150 });
    assert.equal(rec.result.rulesFired.length, 1);
    const list = call("listAlertRules", ctxA);
    assert.equal(list.result.breachingCount, 1);
    assert.equal(list.result.unacknowledged, 1);
    const ack = call("acknowledgeAlert", ctxA, { ruleId: rule.result.rule.id, note: "looking" });
    assert.equal(ack.result.rule.acknowledged, true);
    assert.equal(call("listAlertRules", ctxA).result.unacknowledged, 0);
  });
  it("rejects an invalid rule and unknown ruleId", () => {
    assert.equal(call("createAlertRule", ctxA, { name: "x" }).ok, false);
    assert.equal(call("acknowledgeAlert", ctxA, { ruleId: "nope" }).ok, false);
  });
  it("muted rule does not fire", () => {
    const rule = call("createAlertRule", ctxA, { name: "M", metric: "m", comparator: "gt", threshold: 1 });
    call("muteAlertRule", ctxA, { ruleId: rule.result.rule.id, muted: true });
    assert.equal(call("recordVital", ctxA, { metric: "m", value: 99 }).result.rulesFired.length, 0);
  });
  it("deletes a rule", () => {
    const rule = call("createAlertRule", ctxA, { name: "D", metric: "d", comparator: "gt", threshold: 1 });
    assert.equal(call("deleteAlertRule", ctxA, { ruleId: rule.result.rule.id }).ok, true);
    assert.equal(call("listAlertRules", ctxA).result.count, 0);
  });
});

describe("command-center.saveDashboard + listDashboards + deleteDashboard", () => {
  it("saves, updates, lists and deletes a dashboard per user", () => {
    const d = call("saveDashboard", ctxA, { name: "Ops", widgets: [{ type: "vital", metric: "cpu" }] });
    assert.equal(d.ok, true);
    const upd = call("saveDashboard", ctxA, { dashboardId: d.result.dashboard.id, name: "Ops v2", widgets: [] });
    assert.equal(upd.result.dashboard.name, "Ops v2");
    assert.equal(call("listDashboards", ctxA).result.count, 1);
    assert.equal(call("listDashboards", ctxB).result.count, 0);
    assert.equal(call("deleteDashboard", ctxA, { dashboardId: d.result.dashboard.id }).ok, true);
    assert.equal(call("listDashboards", ctxA).result.count, 0);
  });
  it("rejects a dashboard with no name", () => {
    assert.equal(call("saveDashboard", ctxA, { widgets: [] }).ok, false);
  });
});

describe("command-center.incidents — open, update, postmortem, list", () => {
  it("opens an incident, adds a status update, resolves it", () => {
    const inc = call("openIncident", ctxA, { title: "DB slow", severity: "high", description: "p99 spike" });
    assert.equal(inc.ok, true);
    assert.equal(inc.result.incident.status, "investigating");
    const upd = call("updateIncident", ctxA, { incidentId: inc.result.incident.id, status: "resolved", message: "fixed" });
    assert.equal(upd.result.incident.status, "resolved");
    assert.ok(upd.result.incident.resolvedAt);
    assert.equal(upd.result.incident.updates.length, 2);
  });
  it("writes a postmortem with action items", () => {
    const inc = call("openIncident", ctxA, { title: "Outage" });
    const pm = call("writePostmortem", ctxA, { incidentId: inc.result.incident.id, summary: "root cause was X", rootCause: "X", actionItems: ["add alert"] });
    assert.equal(pm.result.incident.postmortem.actionItems.length, 1);
  });
  it("listIncidents computes MTTR and open count", () => {
    const inc = call("openIncident", ctxA, { title: "T", severity: "low" });
    call("updateIncident", ctxA, { incidentId: inc.result.incident.id, status: "resolved", message: "done" });
    const list = call("listIncidents", ctxA);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.openCount, 0);
    assert.ok(list.result.mttrMinutes != null);
  });
  it("rejects unknown incident and empty fields", () => {
    assert.equal(call("openIncident", ctxA, {}).ok, false);
    assert.equal(call("updateIncident", ctxA, { incidentId: "nope", message: "x" }).ok, false);
    assert.equal(call("writePostmortem", ctxA, { incidentId: "nope", summary: "x" }).ok, false);
  });
});

describe("command-center.correlateVitals", () => {
  it("finds a strong positive correlation between co-moving metrics", () => {
    const base = Date.now() - 60 * 60000;
    for (let i = 0; i < 10; i++) {
      const t = base + i * 5 * 60000;
      call("recordVital", ctxA, { metric: "requests", value: i * 10, t });
      call("recordVital", ctxA, { metric: "latency", value: i * 10 + 5, t });
    }
    const c = call("correlateVitals", ctxA, { windowMinutes: 120 });
    assert.equal(c.ok, true);
    assert.equal(c.result.count, 1);
    assert.ok(c.result.pairs[0].coefficient > 0.9);
    assert.equal(c.result.pairs[0].direction, "positive");
  });
  it("returns empty pairs when insufficient data", () => {
    call("recordVital", ctxA, { metric: "solo", value: 1 });
    assert.equal(call("correlateVitals", ctxA, {}).result.count, 0);
  });
});

describe("command-center.healthRollup", () => {
  it("returns a perfect score with no rules and no incidents", () => {
    const r = call("healthRollup", ctxA);
    assert.equal(r.result.score, 100);
    assert.equal(r.result.verdict, "green");
  });
  it("drops the score and colors a metric red on a critical breach", () => {
    call("createAlertRule", ctxA, { name: "Crit", metric: "errors", comparator: "gt", threshold: 0, severity: "critical" });
    call("recordVital", ctxA, { metric: "errors", value: 50 });
    const r = call("healthRollup", ctxA);
    assert.ok(r.result.score < 100);
    assert.equal(r.result.breachCount, 1);
    assert.ok(r.result.metricStatus.some((m) => m.metric === "errors" && m.color === "red"));
  });
});

describe("command-center.runbooks — save, list, run, delete", () => {
  it("saves a runbook and executes it, recording an immutable log", () => {
    const rb = call("saveRunbook", ctxA, { name: "Restart worker", steps: [{ label: "drain queue", action: "noop" }, { label: "restart", action: "noop" }] });
    assert.equal(rb.ok, true);
    const run = call("runRunbook", ctxA, { runbookId: rb.result.runbook.id });
    assert.equal(run.result.execution.stepCount, 2);
    assert.equal(run.result.runbook.runCount, 1);
    assert.equal(call("listRunbooks", ctxA).result.count, 1);
  });
  it("wiring a run to an incident appends a remediation note", () => {
    const inc = call("openIncident", ctxA, { title: "Queue stuck" });
    const rb = call("saveRunbook", ctxA, { name: "Flush", steps: [{ label: "flush", action: "noop" }] });
    call("runRunbook", ctxA, { runbookId: rb.result.runbook.id, incidentId: inc.result.incident.id });
    const list = call("listIncidents", ctxA);
    const updated = list.result.incidents.find((i) => i.id === inc.result.incident.id);
    assert.ok(updated.updates.some((u) => u.message.includes("Runbook")));
  });
  it("rejects a runbook with no steps and an unknown runbookId", () => {
    assert.equal(call("saveRunbook", ctxA, { name: "Empty", steps: [] }).ok, false);
    assert.equal(call("runRunbook", ctxA, { runbookId: "nope" }).ok, false);
  });
  it("deletes a runbook", () => {
    const rb = call("saveRunbook", ctxA, { name: "Del", steps: [{ label: "x", action: "noop" }] });
    assert.equal(call("deleteRunbook", ctxA, { runbookId: rb.result.runbook.id }).ok, true);
    assert.equal(call("listRunbooks", ctxA).result.count, 0);
  });
});
