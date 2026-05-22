// Contract tests for server/domains/meta.js — developer-portal / observability
// parity macros: service catalog, dependency graph, live metrics dashboards,
// health roll-up, change/deploy timeline, alert surface, macro explorer.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMetaActions from "../domains/meta.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`meta.${name}`);
  if (!fn) throw new Error(`meta.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerMetaActions(register); });

const ctxA = { actor: { userId: "user_meta_a" }, userId: "user_meta_a" };
const ctxB = { actor: { userId: "user_meta_b" }, userId: "user_meta_b" };

// Fresh persistent state per test for deterministic ids.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

describe("meta — pre-existing introspection macros still register", () => {
  it("systemReflection / actionAnalytics / qualityMetrics are registered", () => {
    assert.ok(ACTIONS.has("meta.systemReflection"));
    assert.ok(ACTIONS.has("meta.actionAnalytics"));
    assert.ok(ACTIONS.has("meta.qualityMetrics"));
  });
});

describe("meta.serviceCatalog (service registry)", () => {
  it("registers a service and lists it back", () => {
    const reg = call("serviceRegister", ctxA, {
      name: "DTU Substrate", kind: "datastore", owner: "core", tier: 1,
      description: "knowledge layer", tags: ["dtu", "core"],
    });
    assert.equal(reg.ok, true);
    assert.equal(reg.result.service.name, "DTU Substrate");
    assert.equal(reg.result.service.tier, 1);

    const cat = call("serviceCatalog", ctxA, {});
    assert.equal(cat.ok, true);
    assert.equal(cat.result.total, 1);
    assert.equal(cat.result.byKind.datastore, 1);
    assert.equal(cat.result.byStatus.green, 1);
  });

  it("rejects a nameless service", () => {
    const r = call("serviceRegister", ctxA, { kind: "service" });
    assert.equal(r.ok, false);
  });

  it("filters the catalog by kind and search query", () => {
    call("serviceRegister", ctxA, { name: "World Lens", kind: "lens" });
    call("serviceRegister", ctxA, { name: "Repair Brain", kind: "service" });
    const lenses = call("serviceCatalog", ctxA, { kind: "lens" });
    assert.equal(lenses.result.total, 1);
    const q = call("serviceCatalog", ctxA, { q: "repair" });
    assert.equal(q.result.total, 1);
  });

  it("updates and removes a service", () => {
    const reg = call("serviceRegister", ctxA, { name: "Edge Proxy" });
    const id = reg.result.service.id;
    const upd = call("serviceUpdate", ctxA, {
      id, status: "yellow", owner: "infra", dependsOn: ["Auth"], tags: ["edge"],
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.service.status, "yellow");
    assert.equal(upd.result.service.owner, "infra");
    assert.deepEqual(upd.result.service.dependsOn, ["Auth"]);
    assert.deepEqual(upd.result.service.tags, ["edge"]);
    const rm = call("serviceRemove", ctxA, { id });
    assert.equal(rm.ok, true);
    assert.equal(call("serviceCatalog", ctxA, {}).result.total, 0);
  });

  it("rejects update/remove of an unknown service id", () => {
    assert.equal(call("serviceUpdate", ctxA, { id: "nope" }).ok, false);
    assert.equal(call("serviceRemove", ctxA, { id: "nope" }).ok, false);
  });

  it("isolates services per user", () => {
    call("serviceRegister", ctxA, { name: "A-only" });
    const b = call("serviceCatalog", ctxB, {});
    assert.equal(b.result.total, 0);
  });
});

describe("meta.dependencyGraph", () => {
  it("builds nodes + edges and detects cycles", () => {
    call("serviceRegister", ctxA, { name: "Gateway", dependsOn: ["Auth"] });
    call("serviceRegister", ctxA, { name: "Auth", dependsOn: ["DB"] });
    call("serviceRegister", ctxA, { name: "DB", dependsOn: [] });
    const g = call("dependencyGraph", ctxA, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.stats.nodeCount, 3);
    assert.equal(g.result.stats.edgeCount, 2);
    assert.equal(g.result.stats.cycleCount, 0);
    assert.equal(g.result.mostDependedOn[0].dependents, 1);
  });

  it("flags a dependency cycle", () => {
    call("serviceRegister", ctxA, { name: "X", dependsOn: ["Y"] });
    call("serviceRegister", ctxA, { name: "Y", dependsOn: ["X"] });
    const g = call("dependencyGraph", ctxA, {});
    assert.ok(g.result.stats.cycleCount > 0);
  });
});

describe("meta.metricsDashboard (time-series)", () => {
  it("records samples and buckets them", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const r = call("metricRecord", ctxA, { series: "macro_latency_ms", value: 100 + i, at: now - i * 1000 });
      assert.equal(r.ok, true);
    }
    const dash = call("metricsDashboard", ctxA, { windowMs: 60000, buckets: 12 });
    assert.equal(dash.ok, true);
    assert.equal(dash.result.dashboards.length, 1);
    assert.equal(dash.result.dashboards[0].summary.sampleCount, 10);
    assert.equal(dash.result.dashboards[0].buckets.length, 12);
  });

  it("rejects a non-numeric metric value", () => {
    const r = call("metricRecord", ctxA, { series: "x", value: "abc" });
    assert.equal(r.ok, false);
  });

  it("rejects a metric with no series name", () => {
    assert.equal(call("metricRecord", ctxA, { value: 5 }).ok, false);
  });

  it("tracks multiple series and filters to one", () => {
    call("metricRecord", ctxA, { series: "cpu", value: 40 });
    call("metricRecord", ctxA, { series: "mem", value: 60 });
    const all = call("metricsDashboard", ctxA, {});
    assert.equal(all.result.seriesNames.length, 2);
    const one = call("metricsDashboard", ctxA, { series: "cpu" });
    assert.equal(one.result.dashboards.length, 1);
    assert.equal(one.result.dashboards[0].series, "cpu");
  });
});

describe("meta.healthRollup", () => {
  it("rolls subsystem status up worst-wins", () => {
    call("serviceRegister", ctxA, { name: "L1", kind: "lens", status: "green" });
    call("serviceRegister", ctxA, { name: "L2", kind: "lens", status: "red" });
    call("serviceRegister", ctxA, { name: "S1", kind: "service", status: "green" });
    const h = call("healthRollup", ctxA, {});
    assert.equal(h.ok, true);
    assert.equal(h.result.overall, "red");
    const lensGroup = h.result.subsystems.find((s) => s.kind === "lens");
    assert.equal(lensGroup.rollup, "red");
    assert.equal(h.result.tally.red, 1);
  });
});

describe("meta.deployTimeline (change history)", () => {
  it("records and lists deploy events newest-first", () => {
    const r1 = call("deployRecord", ctxA, { title: "v1 ship", kind: "deploy", at: 1000 });
    const r2 = call("deployRecord", ctxA, { title: "migration 200", kind: "migration", at: 2000 });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    const tl = call("deployTimeline", ctxA, {});
    assert.equal(tl.result.total, 2);
    assert.equal(tl.result.deploys[0].title, "migration 200");
    assert.equal(tl.result.byKind.migration, 1);
  });

  it("computes a failure rate", () => {
    call("deployRecord", ctxA, { title: "ok", outcome: "success" });
    call("deployRecord", ctxA, { title: "bad", outcome: "failed" });
    const tl = call("deployTimeline", ctxA, {});
    assert.equal(tl.result.failureRate, 50);
  });

  it("rejects a titleless deploy", () => {
    assert.equal(call("deployRecord", ctxA, { kind: "deploy" }).ok, false);
  });
});

describe("meta.alertSurface", () => {
  it("raises, surfaces and resolves alerts", () => {
    const a = call("alertRaise", ctxA, { title: "Heartbeat stopped", severity: "critical", source: "prometheus" });
    assert.equal(a.ok, true);
    const surf = call("alertSurface", ctxA, {});
    assert.equal(surf.result.openCount, 1);
    assert.equal(surf.result.worst, "critical");
    const res = call("alertResolve", ctxA, { id: a.result.alert.id, note: "tick restored" });
    assert.equal(res.ok, true);
    assert.equal(call("alertSurface", ctxA, {}).result.openCount, 0);
  });

  it("rejects double-resolve", () => {
    const a = call("alertRaise", ctxA, { title: "Overrun" });
    call("alertResolve", ctxA, { id: a.result.alert.id });
    assert.equal(call("alertResolve", ctxA, { id: a.result.alert.id }).ok, false);
  });

  it("rejects a titleless alert and sorts critical-first", () => {
    assert.equal(call("alertRaise", ctxA, { severity: "info" }).ok, false);
    call("alertRaise", ctxA, { title: "low", severity: "info" });
    call("alertRaise", ctxA, { title: "high", severity: "critical" });
    const surf = call("alertSurface", ctxA, {});
    assert.equal(surf.result.alerts[0].severity, "critical");
    assert.equal(surf.result.tally.critical, 1);
  });

  it("can include resolved alerts when requested", () => {
    const a = call("alertRaise", ctxA, { title: "transient" });
    call("alertResolve", ctxA, { id: a.result.alert.id });
    assert.equal(call("alertSurface", ctxA, {}).result.alerts.length, 0);
    assert.equal(call("alertSurface", ctxA, { includeResolved: true }).result.alerts.length, 1);
  });
});

describe("meta.macroExplorer", () => {
  it("returns a macro catalog from the live MACROS registry", () => {
    globalThis._concordMACROS = new Map([
      ["meta", new Map([["serviceCatalog", () => {}], ["alertSurface", () => {}]])],
      ["crypto", new Map([["holdings", () => {}]])],
    ]);
    const r = call("macroExplorer", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAll, 3);
    assert.ok(r.result.macros.some((m) => m.key === "meta.serviceCatalog"));
  });

  it("filters by domain and query", () => {
    globalThis._concordMACROS = new Map([
      ["meta", new Map([["serviceCatalog", () => {}], ["healthRollup", () => {}]])],
    ]);
    const d = call("macroExplorer", ctxA, { domain: "meta" });
    assert.equal(d.result.total, 2);
    const q = call("macroExplorer", ctxA, { q: "health" });
    assert.equal(q.result.total, 1);
  });

  it("never throws when the registry is absent", () => {
    delete globalThis._concordMACROS;
    const r = call("macroExplorer", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.available, false);
  });
});
