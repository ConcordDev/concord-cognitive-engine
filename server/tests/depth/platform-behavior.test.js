// tests/depth/platform-behavior.test.js — REAL behavioral tests (platform lens-actions).
// Family: registerLensAction("platform", …) → invoked via lensRun.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("platform — calc actions", () => {
  it("slaCompute: computes uptime %, error budget and 9s notation from incidents", async () => {
    // 30-day window, one 6-hour (360 min) outage on svc-a.
    const period = { start: "2026-01-01T00:00:00Z", end: "2026-01-31T00:00:00Z" };
    const r = await lensRun("platform", "slaCompute", {
      data: {
        period, target: 99.9,
        incidents: [{ start: "2026-01-10T00:00:00Z", end: "2026-01-10T06:00:00Z", severity: "critical", service: "svc-a" }],
      },
    });
    assert.equal(r.ok, true);
    // total = 30*24*60 = 43200 min; down 360 → uptime 99.167%
    assert.equal(r.result.totalMinutes, 43200);
    assert.equal(r.result.downtimeMinutes, 360);
    assert.equal(r.result.uptimePercent, 99.167);
    assert.equal(r.result.meetsTarget, false); // 99.167 < 99.9
    assert.equal(r.result.nines, "two-nines"); // 99.167 >= 99
    // MTTR == single incident duration (360 min); one incident → MTBF null.
    assert.equal(r.result.mttr, 360);
    assert.equal(r.result.mtbf, null);
    assert.ok(r.result.serviceBreakdown.some((b) => b.service === "svc-a" && b.downtimeMinutes === 360));
  });

  it("slaCompute: rejects an inverted measurement window", async () => {
    const r = await lensRun("platform", "slaCompute", {
      data: { period: { start: "2026-02-01T00:00:00Z", end: "2026-01-01T00:00:00Z" }, incidents: [] },
    });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /invalid period/i);
  });

  it("capacityPlan: flags critical CPU and rejects under-2 datapoints", async () => {
    const r = await lensRun("platform", "capacityPlan", {
      data: { metrics: [
        { timestamp: "2026-01-01T00:00:00Z", cpu: 80 },
        { timestamp: "2026-01-02T00:00:00Z", cpu: 88 },
        { timestamp: "2026-01-03T00:00:00Z", cpu: 92 },
      ] },
      params: { forecastDays: 30 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dataPoints, 3);
    // current = last = 92 > 85 → critical
    assert.equal(r.result.resources.cpu.current, 92);
    assert.equal(r.result.resources.cpu.alert, "critical");
    assert.equal(r.result.overallHealth, "critical");
    assert.ok(r.result.recommendations.some((m) => m.toLowerCase().includes("cpu") && m.includes("critical")));

    const bad = await lensRun("platform", "capacityPlan", { data: { metrics: [{ timestamp: "x", cpu: 1 }] } });
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /at least 2 data points/i);
  });

  it("incidentTimeline: detects a resolved phase with its duration", async () => {
    const r = await lensRun("platform", "incidentTimeline", {
      data: { events: [
        { timestamp: "2026-01-01T00:00:00Z", type: "alert", service: "api", message: "high latency", severity: "critical" },
        { timestamp: "2026-01-01T00:30:00Z", type: "resolution", service: "api", message: "recovered" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 2);
    assert.ok(r.result.phases.some((p) => p.phase === "resolved" && p.durationMinutes === 30));
    assert.equal(r.result.severityDistribution.critical, 1);
  });

  it("dependencyMap: identifies SPOFs and computes transitive blast radius", async () => {
    const r = await lensRun("platform", "dependencyMap", {
      data: { services: [
        { name: "db", dependencies: [] },
        { name: "api", dependencies: ["db"] },
        { name: "web", dependencies: ["api"] },
        { name: "worker", dependencies: ["db"] },
        { name: "cron", dependencies: ["db"] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalServices, 5);
    // db has 3 direct dependents (api, worker, cron) → SPOF
    assert.ok(r.result.singlePointsOfFailure.some((s) => s.service === "db" && s.dependentCount === 3));
    // db down → api, worker, cron, web (transitive via api) = 4 affected
    const dbBlast = r.result.blastRadius.find((b) => b.service === "db");
    assert.equal(dbBlast.transitiveImpact, 4);
    assert.equal(r.result.maxDependencyDepth, 2); // web → api → db
  });
});

describe("platform — deployment CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("platform-crud-deploy"); });

  it("deploy-create → deploy-list → deploy-logs: created deploy is active and listed with logs", async () => {
    const created = await lensRun("platform", "deploy-create", { params: { service: "api", ref: "main", environment: "production" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.deployment.service, "api");
    assert.equal(created.result.deployment.active, true);
    assert.equal(created.result.deployment.status, "ready");
    const id = created.result.deployment.id;

    const list = await lensRun("platform", "deploy-list", { params: { service: "api" } }, ctx);
    assert.ok(list.result.deployments.some((d) => d.id === id), "deploy is listed");
    assert.ok(list.result.activeProduction && list.result.activeProduction.id === id);

    const logs = await lensRun("platform", "deploy-logs", { params: { id } }, ctx);
    assert.equal(logs.ok, true);
    assert.ok(logs.result.logs.some((l) => l.msg.toLowerCase().includes("deployment ready")));
  });

  it("deploy-rollback: a superseded deploy can be re-promoted to active", async () => {
    const first = await lensRun("platform", "deploy-create", { params: { service: "rb", ref: "v1", environment: "production" } }, ctx);
    const firstId = first.result.deployment.id;
    // second deploy deactivates the first
    await lensRun("platform", "deploy-create", { params: { service: "rb", ref: "v2", environment: "production" } }, ctx);
    const rolled = await lensRun("platform", "deploy-rollback", { params: { id: firstId } }, ctx);
    assert.equal(rolled.ok, true);
    assert.equal(rolled.result.deployment.active, true);
    assert.equal(rolled.result.deployment.rolledBack, true);
  });

  it("deploy-rollback: rejects an unknown deployment id", async () => {
    const r = await lensRun("platform", "deploy-rollback", { params: { id: "dep_nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /not found/i);
  });
});

describe("platform — env + domain CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("platform-crud-env"); });

  it("env-set → env-list: secret value is masked unless revealed", async () => {
    const set = await lensRun("platform", "env-set", { params: { key: "api-key", value: "supersecret", secret: true, targets: ["production"] } }, ctx);
    assert.equal(set.ok, true);
    assert.equal(set.result.key, "API_KEY"); // normalized uppercase + underscore
    assert.deepEqual(set.result.targets, ["production"]);

    const masked = await lensRun("platform", "env-list", { params: {} }, ctx);
    const v = masked.result.vars.find((e) => e.key === "API_KEY");
    assert.ok(v && v.value.includes("••••") && v.value !== "supersecret", "secret is masked");

    const revealed = await lensRun("platform", "env-list", { params: { reveal: true } }, ctx);
    assert.equal(revealed.result.vars.find((e) => e.key === "API_KEY").value, "supersecret");
  });

  it("env-delete: removes a var and rejects an unknown id", async () => {
    const set = await lensRun("platform", "env-set", { params: { key: "TEMP", value: "x" } }, ctx);
    assert.equal(set.ok, true);
    const list = await lensRun("platform", "env-list", { params: {} }, ctx);
    const id = list.result.vars.find((e) => e.key === "TEMP").id;
    const del = await lensRun("platform", "env-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, "TEMP");
    const after = await lensRun("platform", "env-list", { params: {} }, ctx);
    assert.ok(!after.result.vars.some((e) => e.key === "TEMP"), "deleted var is gone");

    const bad = await lensRun("platform", "env-delete", { params: { id: "env_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /not found/i);
  });

  it("domain-attach: rejects a malformed host then verifies a valid one", async () => {
    const bad = await lensRun("platform", "domain-attach", { params: { host: "not a host" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /valid domain host/i);

    const ok = await lensRun("platform", "domain-attach", { params: { host: "app.example.com", service: "web" } }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.domain.host, "app.example.com");
    const id = ok.result.domain.id;
    const verified = await lensRun("platform", "domain-verify", { params: { id } }, ctx);
    assert.equal(verified.result.domain.verified, true);
    assert.equal(verified.result.domain.sslStatus, "issued");
  });
});

describe("platform — alerting + usage + audit", () => {
  let ctx; before(async () => { ctx = await depthCtx("platform-crud-alert"); });

  it("alert-channel-set → alert-create → alert-list: alert fires against a metrics snapshot", async () => {
    const chan = await lensRun("platform", "alert-channel-set", { params: { kind: "webhook", target: "https://hook.example/x", label: "ops" } }, ctx);
    assert.equal(chan.ok, true);
    const channelId = chan.result.channel.id;

    const created = await lensRun("platform", "alert-create", { params: { metric: "cpu", op: ">", threshold: 80, channelId, severity: "critical" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.alert.metric, "cpu");

    const list = await lensRun("platform", "alert-list", { params: { metrics: { cpu: 95 } } }, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.firing, 1); // 95 > 80
    assert.ok(list.result.alerts.some((a) => a.triggered && a.channel && a.channel.id === channelId));
  });

  it("alert-create: rejects an invalid metric", async () => {
    const r = await lensRun("platform", "alert-create", { params: { metric: "bogus", op: ">", threshold: 1 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /metric must be one of/i);
  });

  it("usage-summary: derives quota line items including build minutes from deploys", async () => {
    await lensRun("platform", "deploy-create", { params: { service: "billable", ref: "main" } }, ctx);
    const r = await lensRun("platform", "usage-summary", { params: { plan: "pro" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.plan, "pro");
    assert.equal(r.result.basePlanCost, 20);
    assert.ok(r.result.lineItems.some((l) => l.label === "Build minutes" && l.used > 0));
    assert.ok(r.result.counts.deployments >= 1);
  });

  it("audit-list: records platform mutations as audit entries", async () => {
    // the alert-channel + alert-create + deploy-create above all audit on this ctx
    const r = await lensRun("platform", "audit-list", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.total >= 1);
    assert.ok(r.result.entries.some((e) => e.action === "alert.create" || e.action === "deploy.create"));
    const filtered = await lensRun("platform", "audit-list", { params: { action: "alert" } }, ctx);
    assert.ok(filtered.result.entries.every((e) => e.action.startsWith("alert")));
  });
});
