// Contract tests for server/domains/observe.js — Datadog-shape
// observability platform. Exercises the 4 original artifact-store
// macros plus the 7 parity-backlog feature families (metrics,
// dashboards, log search, tracing, monitors, synthetics, on-call).
//
// Pattern mirrors server/tests/travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerObserveActions from "../domains/observe.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`observe.${name}`);
  if (!fn) throw new Error(`observe.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerObserveActions(register); });

beforeEach(() => {
  // fresh per-user STATE for each test
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// ---------------------------------------------------------------- originals
describe("observe — original artifact macros", () => {
  it("serviceLog summarises level counts + error rate", () => {
    const now = new Date().toISOString();
    const artifact = { data: { entries: [
      { level: "error", ts: now, service: "api", message: "x" },
      { level: "info", ts: now, service: "api", message: "y" },
    ] } };
    const r = call("serviceLog", ctxA, artifact, { windowMinutes: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.errorRate, 50);
    assert.equal(r.result.topService, "api");
  });

  it("incidentTrack opens an incident", () => {
    const artifact = { data: {} };
    const r = call("incidentTrack", ctxA, artifact, { title: "5xx spike", severity: "sev2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.severity, "sev2");
    assert.equal(r.result.incident.status, "open");
  });

  it("sloCheck computes burn rate + status", () => {
    const r = call("sloCheck", ctxA, {}, { targetPct: 99.9, actualPct: 99.5, windowDays: 30 });
    assert.equal(r.ok, true);
    assert.ok(r.result.burnRate > 1);
    assert.ok(["burning", "critical"].includes(r.result.status));
  });
});

// ---------------------------------------------------------------- 1. metrics
describe("observe — metrics ingestion + time-series", () => {
  it("ingests points and lists them", () => {
    const ing = call("metricIngest", ctxA, {}, { metric: "app.lat", value: 120 });
    assert.equal(ing.ok, true);
    assert.equal(ing.result.ingested, 1);
    const list = call("metricList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.metrics[0].name, "app.lat");
  });

  it("metricQuery returns a windowed aggregate series", () => {
    call("metricIngest", ctxA, {}, { points: [
      { metric: "cpu", value: 10 }, { metric: "cpu", value: 30 },
    ] });
    const r = call("metricQuery", ctxA, {}, { metric: "cpu", agg: "avg", windowMinutes: 60, buckets: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 10);
    assert.equal(r.result.stats.count, 2);
    assert.equal(r.result.stats.avg, 20);
  });

  it("rejects ingest with no points at all", () => {
    const r = call("metricIngest", ctxA, {}, {});
    assert.equal(r.ok, false);
  });

  it("skips a non-numeric point but still succeeds", () => {
    const r = call("metricIngest", ctxA, {}, { metric: "x" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ingested, 0);
  });
});

// ---------------------------------------------------------------- 2. dashboards
describe("observe — dashboards", () => {
  it("saves, lists, and deletes a dashboard with widgets", () => {
    const save = call("dashboardSave", ctxA, {}, { title: "Prod", widgets: [{ kind: "timeseries", metric: "cpu" }] });
    assert.equal(save.ok, true);
    assert.equal(save.result.dashboard.widgets.length, 1);
    const id = save.result.dashboard.id;
    const list = call("dashboardList", ctxA, {}, {});
    assert.equal(list.result.total, 1);
    const upd = call("dashboardSave", ctxA, {}, { id, title: "Prod v2", widgets: [] });
    assert.equal(upd.result.dashboard.title, "Prod v2");
    const del = call("dashboardDelete", ctxA, {}, { id });
    assert.equal(del.ok, true);
    assert.equal(call("dashboardList", ctxA, {}, {}).result.total, 0);
  });
});

// ---------------------------------------------------------------- 3. log search
describe("observe — log search", () => {
  it("ingests + searches logs with DSL facets", () => {
    const ing = call("logIngest", ctxA, {}, { entries: [
      { level: "error", service: "api", message: "db timeout" },
      { level: "info", service: "api", message: "ok" },
      { level: "error", service: "web", message: "render fail" },
    ] });
    assert.equal(ing.result.ingested, 3);
    const r = call("logSearch", ctxA, {}, { query: "level:error", windowMinutes: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, 2);
    assert.ok(r.result.facets.service.length >= 2);
  });

  it("free-text term filters the matched set", () => {
    call("logIngest", ctxA, {}, { entries: [{ level: "error", service: "api", message: "db timeout" }] });
    const r = call("logSearch", ctxA, {}, { query: "timeout" });
    assert.equal(r.result.matched, 1);
  });
});

// ---------------------------------------------------------------- 4. tracing
describe("observe — distributed tracing", () => {
  it("ingests a trace, lists it, shows waterfall + service map", () => {
    const ing = call("traceIngest", ctxA, {}, { traceId: "t1", spans: [
      { id: "a", service: "gw", name: "GET", startMs: 0, durationMs: 100 },
      { id: "b", parentId: "a", service: "db", name: "query", startMs: 20, durationMs: 60, error: true },
    ] });
    assert.equal(ing.ok, true);
    assert.equal(ing.result.spanCount, 2);
    const list = call("traceList", ctxA, {}, {});
    assert.equal(list.result.traces[0].hasError, true);
    const detail = call("traceDetail", ctxA, {}, { traceId: "t1" });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.trace.waterfall.length, 2);
    const map = call("serviceMap", ctxA, {}, {});
    assert.equal(map.ok, true);
    assert.ok(map.result.nodes.some((n) => n.service === "db" && n.errors === 1));
    assert.ok(map.result.edges.some((e) => e.from === "gw" && e.to === "db"));
  });
});

// ---------------------------------------------------------------- 5. monitors
describe("observe — alert monitors", () => {
  it("saves a threshold monitor and evaluates it against metrics", () => {
    call("metricIngest", ctxA, {}, { points: [{ metric: "err", value: 99 }, { metric: "err", value: 99 }] });
    const save = call("monitorSave", ctxA, {}, { metric: "err", type: "threshold", op: ">", threshold: 50, agg: "avg" });
    assert.equal(save.ok, true);
    const ev = call("monitorEvaluate", ctxA, {}, {});
    assert.equal(ev.ok, true);
    assert.equal(ev.result.alerting, 1);
    assert.equal(ev.result.evaluations[0].breached, true);
  });

  it("lists and deletes monitors", () => {
    const save = call("monitorSave", ctxA, {}, { metric: "x", threshold: 1 });
    const id = save.result.monitor.id;
    assert.equal(call("monitorList", ctxA, {}, {}).result.total, 1);
    assert.equal(call("monitorDelete", ctxA, {}, { id }).ok, true);
    assert.equal(call("monitorList", ctxA, {}, {}).result.total, 0);
  });
});

// ---------------------------------------------------------------- 6. synthetics
describe("observe — synthetic monitoring", () => {
  it("saves and lists a synthetic check", () => {
    const save = call("syntheticSave", ctxA, {}, { url: "https://example.com/health", expectStatus: 200 });
    assert.equal(save.ok, true);
    assert.equal(save.result.check.status, "pending");
    assert.equal(call("syntheticList", ctxA, {}, {}).result.total, 1);
  });

  it("rejects a missing URL and deletes a check", () => {
    assert.equal(call("syntheticSave", ctxA, {}, {}).ok, false);
    const save = call("syntheticSave", ctxA, {}, { url: "https://x.test" });
    assert.equal(call("syntheticDelete", ctxA, {}, { id: save.result.check.id }).ok, true);
  });

  it("syntheticRun records latency + status via real fetch", async () => {
    globalThis.fetch = async () => ({ status: 200, text: async () => "OK" });
    const save = call("syntheticSave", ctxA, {}, { url: "https://x.test", expectStatus: 200 });
    const r = await call("syntheticRun", ctxA, {}, { id: save.result.check.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.check.status, "up");
    assert.equal(r.result.check.uptimePct, 100);
  });
});

// ---------------------------------------------------------------- 7. on-call
describe("observe — on-call paging", () => {
  it("sets up schedule + routes, pages, and acknowledges", () => {
    const setup = call("oncallSetup", ctxA, {}, {
      schedule: [{ person: "alice", startsAt: new Date(Date.now() - 1000).toISOString() }],
      routes: [{ name: "primary", channel: "dm", target: "alice", minSeverity: "sev3" }],
    });
    assert.equal(setup.ok, true);
    const status = call("oncallStatus", ctxA, {}, {});
    assert.equal(status.result.current.person, "alice");
    const page = call("pageOnCall", ctxA, {}, { severity: "sev1", summary: "outage" });
    assert.equal(page.ok, true);
    assert.equal(page.result.page.pagedPerson, "alice");
    assert.equal(page.result.routesNotified, 1);
    const ack = call("acknowledgePage", ctxA, {}, { id: page.result.page.id });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.page.ackedBy, "user_a");
  });

  it("severity routing — sev4 page does not fire a sev3-floor route", () => {
    call("oncallSetup", ctxA, {}, { routes: [{ name: "r", channel: "dm", target: "t", minSeverity: "sev2" }] });
    const page = call("pageOnCall", ctxA, {}, { severity: "sev4", summary: "minor" });
    assert.equal(page.result.routesNotified, 0);
  });
});
