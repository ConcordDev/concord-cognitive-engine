// tests/depth/meta-behavior.test.js — REAL behavioral tests for the meta
// domain (registerLensAction family, invoked via lensRun). The meta domain is
// the developer-portal / observability surface: system reflection, action
// analytics, artifact quality metrics, service catalog, dependency graph, live
// metrics dashboards, health roll-up, deploy timeline, alert surface, macro
// explorer, and a deterministic text classifier.
//
// lens.run unwraps a handler's { ok, result }: on success r.result is the inner
// result object; on a handler refusal (which returns { ok:false, error } with NO
// result key) lens.run passes it through unchanged, so r.result.ok === false and
// r.result.error carries the message.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("meta — analytics calc contracts (exact computed values)", () => {
  it("systemReflection: response-time percentiles + error rate are exact over 10 samples", async () => {
    // responseMs 100..1000 (10 evenly-spaced), 2 failures → overallErrorRate 0.2.
    const metrics = [];
    for (let i = 1; i <= 10; i++) {
      metrics.push({
        timestamp: `2026-06-07T00:0${i % 10}:00.000Z`,
        responseMs: i * 100,
        success: i > 8 ? false : true, // i=9,10 fail → 2 errors
        cpuPercent: 50,
        endpoint: "/api/x",
      });
    }
    const r = await lensRun("meta", "systemReflection", { data: { metrics } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRequests, 10);
    assert.equal(r.result.overallErrorRate, 0.2); // 2/10
    // percentile(arr,p) = arr[ceil(p*n)-1]; sorted=[100..1000], n=10.
    assert.equal(r.result.responseTime.p50, 500); // ceil(.5*10)-1 = 4 → 500
    assert.equal(r.result.responseTime.p90, 900); // ceil(.9*10)-1 = 8 → 900
    assert.equal(r.result.responseTime.min, 100);
    assert.equal(r.result.responseTime.max, 1000);
    assert.equal(r.result.responseTime.mean, 550); // (100+..+1000)/10
    // single endpoint aggregates all 10 with errorRate 0.2.
    const ep = r.result.endpoints.find((e) => e.name === "/api/x");
    assert.equal(ep.requests, 10);
    assert.equal(ep.errorRate, 0.2);
  });

  it("systemReflection: empty metrics yields the no-data message (not a crash)", async () => {
    const r = await lensRun("meta", "systemReflection", { data: { metrics: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No system metrics to analyze.");
  });

  it("actionAnalytics: frequency distribution counts + percentage are exact", async () => {
    const base = "2026-06-07T00:00:00.000Z";
    const actionLog = [
      { userId: "u1", action: "open", timestamp: base },
      { userId: "u1", action: "open", timestamp: "2026-06-07T00:01:00.000Z" },
      { userId: "u1", action: "save", timestamp: "2026-06-07T00:02:00.000Z" },
      { userId: "u2", action: "open", timestamp: "2026-06-07T00:03:00.000Z" },
    ];
    const r = await lensRun("meta", "actionAnalytics", { data: { actionLog } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalActions, 4);
    assert.equal(r.result.uniqueActions, 2); // open, save
    assert.equal(r.result.uniqueUsers, 2);
    const open = r.result.frequencyDistribution.find((f) => f.action === "open");
    assert.equal(open.count, 3);
    assert.equal(open.percentage, 75); // 3/4 → 75.00
    // open then save in u1's session → a bigram transition is recorded.
    assert.ok(r.result.topTransitions.some((t) => t.transition === "open -> save"));
  });

  it("actionAnalytics: empty log yields the no-data message", async () => {
    const r = await lensRun("meta", "actionAnalytics", { data: { actionLog: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No action log data.");
  });

  it("qualityMetrics: completeness/consistency/freshness compose into the weighted overall score", async () => {
    // reference time pinned so freshness is deterministic. All fields updated NOW
    // → freshness ~1.0. 2 of 2 required filled → completeness 1.0. type matches → consistency 1.0.
    const refTime = "2026-06-07T00:00:00.000Z";
    const r = await lensRun("meta", "qualityMetrics", {
      data: {
        fields: [
          { name: "title", value: "Hello", required: true, expectedType: "string", updatedAt: refTime },
          { name: "count", value: 42, required: true, expectedType: "number", updatedAt: refTime },
        ],
      },
      params: { referenceTime: refTime, freshnessHalfLifeDays: 30 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFields, 2);
    assert.equal(r.result.completeness.scoreRequired, 1);
    assert.equal(r.result.consistency.score, 1);
    assert.equal(r.result.freshness.avgScore, 1); // age 0 → exp(0)=1
    assert.equal(r.result.overall.score, 1); // 0.4 + 0.35 + 0.25
    assert.equal(r.result.overall.grade, "A");
  });

  it("qualityMetrics: a type mismatch is recorded as an inconsistency and lowers the score", async () => {
    const refTime = "2026-06-07T00:00:00.000Z";
    const r = await lensRun("meta", "qualityMetrics", {
      data: {
        fields: [
          { name: "age", value: "not-a-number", required: true, expectedType: "number", updatedAt: refTime },
          { name: "email", value: "bad-email", required: true, expectedType: "email", updatedAt: refTime },
        ],
      },
      params: { referenceTime: refTime },
    });
    assert.equal(r.ok, true);
    // "not-a-number" → parseFloat NaN → inconsistent; "bad-email" → regex fail.
    assert.equal(r.result.consistency.consistentFields, 0);
    assert.equal(r.result.consistency.score, 0);
    assert.ok(r.result.consistency.inconsistencies.some((x) => x.field === "email"));
    assert.ok(r.result.consistency.inconsistencies.some((x) => x.field === "age"));
  });

  it("qualityMetrics: empty fields yields the no-fields message", async () => {
    const r = await lensRun("meta", "qualityMetrics", { data: { fields: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No fields to evaluate.");
  });
});

describe("meta — service catalog CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("meta-svc"); });

  it("serviceRegister → serviceCatalog: service reads back with defaulted fields", async () => {
    const reg = await lensRun("meta", "serviceRegister", { params: { name: "Auth API", kind: "service", owner: "platform", tier: 1 } }, ctx);
    assert.equal(reg.result.service.name, "Auth API");
    assert.equal(reg.result.service.status, "green"); // default
    assert.equal(reg.result.service.tier, 1);
    assert.match(reg.result.service.id, /^svc_\d+$/);
    const cat = await lensRun("meta", "serviceCatalog", {}, ctx);
    assert.ok(cat.result.services.some((s) => s.id === reg.result.service.id));
    assert.ok(cat.result.byKind.service >= 1);
  });

  it("serviceRegister: a missing name is rejected", async () => {
    const bad = await lensRun("meta", "serviceRegister", { params: { name: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("serviceRegister: an invalid status falls back to green", async () => {
    const reg = await lensRun("meta", "serviceRegister", { params: { name: "Defaulter", status: "purple" } }, ctx);
    assert.equal(reg.result.service.status, "green");
  });

  it("serviceUpdate flips status + tier; serviceCatalog filter by status returns it", async () => {
    const reg = await lensRun("meta", "serviceRegister", { params: { name: "Flaky Worker", kind: "heartbeat" } }, ctx);
    const id = reg.result.service.id;
    const upd = await lensRun("meta", "serviceUpdate", { params: { id, status: "red", tier: 2, owner: "ops" } }, ctx);
    assert.equal(upd.result.service.status, "red");
    assert.equal(upd.result.service.tier, 2);
    assert.equal(upd.result.service.owner, "ops");
    const cat = await lensRun("meta", "serviceCatalog", { params: { status: "red" } }, ctx);
    assert.ok(cat.result.services.every((s) => s.status === "red"));
    assert.ok(cat.result.services.some((s) => s.id === id));
  });

  it("serviceUpdate: an unknown id is rejected", async () => {
    const bad = await lensRun("meta", "serviceUpdate", { params: { id: "svc_99999", status: "red" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /service not found/);
  });

  it("serviceRemove deletes the service; a missing id is rejected", async () => {
    const reg = await lensRun("meta", "serviceRegister", { params: { name: "Doomed Service" } }, ctx);
    const id = reg.result.service.id;
    const del = await lensRun("meta", "serviceRemove", { params: { id } }, ctx);
    assert.equal(del.result.removed, true);
    const cat = await lensRun("meta", "serviceCatalog", {}, ctx);
    assert.ok(!cat.result.services.some((s) => s.id === id));
    const bad = await lensRun("meta", "serviceRemove", { params: { id: "svc_404" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /service not found/);
  });

  it("serviceCatalog: free-text q matches name", async () => {
    await lensRun("meta", "serviceRegister", { params: { name: "Billing Gateway", description: "stripe" } }, ctx);
    const cat = await lensRun("meta", "serviceCatalog", { params: { q: "billing" } }, ctx);
    assert.ok(cat.result.services.length >= 1);
    assert.ok(cat.result.services.every((s) =>
      s.name.toLowerCase().includes("billing") ||
      s.description.toLowerCase().includes("billing") ||
      s.tags.some((t) => t.toLowerCase().includes("billing"))));
  });
});

describe("meta — dependency graph (edges, fan-in/out, cycles)", () => {
  it("dependencyGraph: edges resolve dependsOn-by-name; fan-in/most-depended-on are exact", async () => {
    const ctx = await depthCtx("meta-depgraph");
    await lensRun("meta", "serviceRegister", { params: { name: "DB", kind: "datastore" } }, ctx);
    await lensRun("meta", "serviceRegister", { params: { name: "API", dependsOn: ["DB"] } }, ctx);
    await lensRun("meta", "serviceRegister", { params: { name: "Web", dependsOn: ["API", "DB"] } }, ctx);
    const g = await lensRun("meta", "dependencyGraph", {}, ctx);
    assert.equal(g.result.stats.nodeCount, 3);
    assert.equal(g.result.stats.edgeCount, 3); // API->DB, Web->API, Web->DB
    assert.equal(g.result.stats.cycleCount, 0);
    // DB is depended on by API + Web → fan-in 2, top of mostDependedOn.
    const dbNode = g.result.nodes.find((n) => n.name === "DB");
    const dbTop = g.result.mostDependedOn.find((m) => m.id === dbNode.id);
    assert.equal(dbTop.dependents, 2);
    // Web has no dependents → it's a root; DB has no deps → it's a leaf.
    assert.ok(g.result.roots.includes(g.result.nodes.find((n) => n.name === "Web").id));
    assert.ok(g.result.leaves.includes(dbNode.id));
  });

  it("dependencyGraph: a mutual dependency is detected as a cycle", async () => {
    const ctx = await depthCtx("meta-depcycle");
    await lensRun("meta", "serviceRegister", { params: { name: "Alpha", dependsOn: ["Beta"] } }, ctx);
    await lensRun("meta", "serviceRegister", { params: { name: "Beta", dependsOn: ["Alpha"] } }, ctx);
    const g = await lensRun("meta", "dependencyGraph", {}, ctx);
    assert.ok(g.result.stats.cycleCount >= 1);
  });
});

describe("meta — live metrics dashboards", () => {
  it("metricRecord → metricsDashboard: samples aggregate into series summary (avg/min/max exact)", async () => {
    const ctx = await depthCtx("meta-metrics");
    const now = Date.now();
    await lensRun("meta", "metricRecord", { params: { series: "latency", value: 10, at: now - 1000 } }, ctx);
    await lensRun("meta", "metricRecord", { params: { series: "latency", value: 30, at: now - 500 } }, ctx);
    await lensRun("meta", "metricRecord", { params: { series: "latency", value: 20, at: now } }, ctx);
    const dash = await lensRun("meta", "metricsDashboard", { params: { series: "latency", windowMs: 3600000 } }, ctx);
    const d = dash.result.dashboards.find((x) => x.series === "latency");
    assert.equal(d.summary.sampleCount, 3);
    assert.equal(d.summary.avg, 20); // (10+30+20)/3
    assert.equal(d.summary.min, 10);
    assert.equal(d.summary.max, 30);
    assert.equal(d.summary.latest, 20); // last recorded
    assert.ok(dash.result.seriesNames.includes("latency"));
  });

  it("metricRecord: a missing series is rejected", async () => {
    const ctx = await depthCtx("meta-metrics-bad");
    const bad = await lensRun("meta", "metricRecord", { params: { series: "", value: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /series required/);
  });

  it("metricRecord: a non-numeric value is rejected", async () => {
    const ctx = await depthCtx("meta-metrics-nan");
    const bad = await lensRun("meta", "metricRecord", { params: { series: "x", value: "abc" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /value must be a number/);
  });
});

describe("meta — health roll-up + deploy timeline + alerts", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("meta-health"); });

  it("healthRollup: worst child status wins per kind and overall", async () => {
    await lensRun("meta", "serviceRegister", { params: { name: "Svc Green", kind: "service", status: "green" } }, ctx);
    await lensRun("meta", "serviceRegister", { params: { name: "Svc Red", kind: "service", status: "red" } }, ctx);
    const roll = await lensRun("meta", "healthRollup", {}, ctx);
    const svcGroup = roll.result.subsystems.find((g) => g.kind === "service");
    assert.equal(svcGroup.rollup, "red"); // one red present
    assert.equal(svcGroup.red, 1);
    assert.equal(svcGroup.green, 1);
    assert.equal(roll.result.overall, "red");
  });

  it("deployRecord → deployTimeline: failure rate + ordering are exact", async () => {
    const d = await depthCtx("meta-deploy");
    await lensRun("meta", "deployRecord", { params: { title: "v1", outcome: "success", at: 1000 } }, d);
    await lensRun("meta", "deployRecord", { params: { title: "v2", outcome: "failed", at: 2000 } }, d);
    const tl = await lensRun("meta", "deployTimeline", {}, d);
    assert.equal(tl.result.total, 2);
    assert.equal(tl.result.byOutcome.failed, 1);
    assert.equal(tl.result.failureRate, 50); // 1/2
    assert.equal(tl.result.deploys[0].title, "v2"); // sorted desc by at → newest first
    assert.equal(tl.result.lastDeployAt, 2000);
  });

  it("deployRecord: a missing title is rejected", async () => {
    const bad = await lensRun("meta", "deployRecord", { params: { title: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("alertRaise → alertSurface → alertResolve round-trips; severity tally is exact", async () => {
    const a = await depthCtx("meta-alert");
    const raised = await lensRun("meta", "alertRaise", { params: { title: "Disk full", severity: "critical", service: "db" } }, a);
    assert.equal(raised.result.alert.severity, "critical");
    assert.equal(raised.result.alert.resolvedAt, null);
    const id = raised.result.alert.id;
    const surf = await lensRun("meta", "alertSurface", {}, a);
    assert.equal(surf.result.openCount, 1);
    assert.equal(surf.result.tally.critical, 1);
    assert.equal(surf.result.worst, "critical");
    const resolved = await lensRun("meta", "alertResolve", { params: { id, note: "cleared" } }, a);
    assert.ok(resolved.result.alert.resolvedAt > 0);
    // After resolve, default surface excludes resolved → openCount 0.
    const surf2 = await lensRun("meta", "alertSurface", {}, a);
    assert.equal(surf2.result.openCount, 0);
    assert.equal(surf2.result.worst, "clear");
  });

  it("alertResolve: resolving twice is rejected, and a missing id is rejected", async () => {
    const a = await depthCtx("meta-alert-dup");
    const raised = await lensRun("meta", "alertRaise", { params: { title: "Once" } }, a);
    const id = raised.result.alert.id;
    await lensRun("meta", "alertResolve", { params: { id } }, a);
    const again = await lensRun("meta", "alertResolve", { params: { id } }, a);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already resolved/);
    const missing = await lensRun("meta", "alertResolve", { params: { id: "alt_404" } }, a);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /alert not found/);
  });

  it("alertRaise: a missing title is rejected", async () => {
    const bad = await lensRun("meta", "alertRaise", { params: { title: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });
});

describe("meta — macro explorer + classifier", () => {
  it("macroExplorer: surfaces a known domain.macro from the live registry and filters by q", async () => {
    const r = await lensRun("meta", "macroExplorer", { params: { q: "lens.run" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.available, true);
    assert.ok(r.result.totalAll > 0);
    // The lens.run macro we just invoked through must be in the catalog.
    assert.ok(r.result.macros.some((m) => m.key === "lens.run"));
  });

  it("macroExplorer: filtering by domain returns only that domain", async () => {
    const r = await lensRun("meta", "macroExplorer", { params: { domain: "lens" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.macros.length >= 1);
    assert.ok(r.result.macros.every((m) => m.domain === "lens"));
  });

  it("classify: keyword-scored routing picks the dominant domain with confidence", async () => {
    const r = await lensRun("meta", "classify", {
      params: { text: "I need to refactor this function and fix a git bug before deploy" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.domain, "code"); // refactor/function/git/bug/deploy all hit code
    assert.equal(r.result.matched, true);
    assert.ok(r.result.confidence > 0 && r.result.confidence <= 1);
  });

  it("classify: text reading from artifact.data.text classifies to finance", async () => {
    const r = await lensRun("meta", "classify", {
      data: { text: "review my budget, expenses, and savings portfolio for tax season" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.domain, "finance");
  });

  it("classify: empty text is rejected", async () => {
    const r = await lensRun("meta", "classify", { params: { text: "   " } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /text required/);
  });

  it("classify: text with no signal keywords returns no match", async () => {
    const r = await lensRun("meta", "classify", { params: { text: "zzz qqq xyzzy plugh" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, false);
    assert.equal(r.result.domain, null);
    assert.equal(r.result.confidence, 0);
  });
});
