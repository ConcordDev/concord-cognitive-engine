// Contract tests for server/domains/platform.js — the Vercel/Heroku-style
// platform console macros: deployment pipeline, live metrics, env/config,
// domain routing, alerting, cost/usage, and audit log. Plus the four
// pure-compute analysis macros (SLA, capacity, incident, dependency).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPlatformActions from "../domains/platform.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`platform.${name}`);
  if (!fn) throw new Error(`platform.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerPlatformActions(register); });

beforeEach(() => {
  // Fresh per-user platform state for each test.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_plat_a" }, userId: "user_plat_a" };

describe("platform analysis macros (pure-compute)", () => {
  it("slaCompute derives uptime + error budget", () => {
    const r = call("slaCompute", ctxA, {
      data: {
        target: 99.9,
        period: { start: "2026-01-01T00:00:00Z", end: "2026-01-31T00:00:00Z" },
        incidents: [
          { start: "2026-01-05T00:00:00Z", end: "2026-01-05T01:00:00Z", severity: "high", service: "api" },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.uptimePercent > 99);
    assert.equal(r.result.totalIncidents, 1);
    assert.ok(r.result.errorBudget);
  });

  it("capacityPlan forecasts from a metric series", () => {
    const metrics = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      cpu: 30 + i * 4, memory: 40 + i * 2, disk: 50, connections: 10,
    }));
    const r = call("capacityPlan", ctxA, { data: { metrics } }, { forecastDays: 30 });
    assert.equal(r.ok, true);
    assert.ok(r.result.resources.cpu);
    assert.equal(r.result.forecastDays, 30);
  });

  it("incidentTimeline builds phases", () => {
    const r = call("incidentTimeline", ctxA, {
      data: {
        events: [
          { timestamp: "2026-01-01T00:00:00Z", type: "alert", service: "api", message: "down", severity: "critical" },
          { timestamp: "2026-01-01T00:10:00Z", type: "resolution", service: "api", message: "up" },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 2);
  });

  it("dependencyMap finds SPOFs", () => {
    const r = call("dependencyMap", ctxA, {
      data: {
        services: [
          { name: "db", dependencies: [] },
          { name: "api", dependencies: ["db"] },
          { name: "web", dependencies: ["api", "db"] },
          { name: "worker", dependencies: ["db"] },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalServices, 4);
    assert.ok(typeof r.result.healthScore === "number");
  });
});

describe("platform deployment pipeline", () => {
  it("deploy-create + deploy-list + deploy-logs + deploy-rollback", () => {
    const c1 = call("deploy-create", ctxA, {}, { service: "web", ref: "main", environment: "production" });
    assert.equal(c1.ok, true);
    assert.equal(c1.result.deployment.status, "recorded");
    assert.equal(c1.result.deployment.buildSeconds, null);
    assert.equal(c1.result.deployment.url, null);
    assert.equal(c1.result.deployment.active, true);

    const c2 = call("deploy-create", ctxA, {}, { service: "web", ref: "feature", environment: "production" });
    assert.equal(c2.ok, true);

    const list = call("deploy-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 2);
    assert.ok(list.result.activeProduction);

    const logs = call("deploy-logs", ctxA, {}, { id: c1.result.deployment.id });
    assert.equal(logs.ok, true);
    assert.ok(logs.result.logs.length > 0);

    const rb = call("deploy-rollback", ctxA, {}, { id: c1.result.deployment.id });
    assert.equal(rb.ok, true);
    assert.equal(rb.result.deployment.active, true);
    assert.equal(rb.result.deployment.rolledBack, true);
  });

  it("deploy-rollback rejects unknown id", () => {
    const r = call("deploy-rollback", ctxA, {}, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("platform live metrics", () => {
  it("metrics-history is empty (no_data) until samples are ingested", () => {
    const r = call("metrics-history", ctxA, {}, { service: "web" });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 0);
    assert.equal(r.result.current, null);
    assert.equal(r.result.health, "no_data");
  });

  it("metrics-ingest stores real samples and history reflects exactly them", () => {
    const now = Date.now();
    const ing = call("metrics-ingest", ctxA, {}, { service: "web", samples: [
      { t: new Date(now - 60000).toISOString(), cpu: 40, memory: 50, requests: 100, latencyMs: 20 },
      { t: new Date(now).toISOString(), cpu: 90, memory: 60, requests: 300, latencyMs: 30 },
      { cpu: "nope" },
    ] });
    assert.equal(ing.ok, true);
    assert.equal(ing.result.accepted, 2);
    const r = call("metrics-history", ctxA, {}, { service: "web" });
    assert.equal(r.result.series.length, 2);
    assert.equal(r.result.current.cpu, 90);
    assert.equal(r.result.summary.cpu.avg, 65);
    assert.equal(r.result.summary.cpu.peak, 90);
    assert.equal(r.result.health, "critical");
    // another service / user sees nothing
    assert.equal(call("metrics-history", ctxA, {}, { service: "api" }).result.series.length, 0);
  });

  it("metrics-ingest rejects samples with no numeric fields", () => {
    assert.equal(call("metrics-ingest", ctxA, {}, { service: "web", samples: [{ foo: 1 }] }).ok, false);
  });
});

describe("platform env / config management", () => {
  it("env-set + env-list masks secrets", () => {
    const set = call("env-set", ctxA, {}, { key: "api-key", value: "supersecret", secret: true });
    assert.equal(set.ok, true);
    assert.equal(set.result.key, "API_KEY");

    const masked = call("env-list", ctxA, {}, {});
    assert.equal(masked.ok, true);
    assert.equal(masked.result.count, 1);
    assert.notEqual(masked.result.vars[0].value, "supersecret");

    const revealed = call("env-list", ctxA, {}, { reveal: true });
    assert.equal(revealed.result.vars[0].value, "supersecret");
  });

  it("env-set rejects empty key, env-delete removes", () => {
    assert.equal(call("env-set", ctxA, {}, { key: "" }).ok, false);
    const set = call("env-set", ctxA, {}, { key: "FOO", value: "bar" });
    const del = call("env-delete", ctxA, {}, { id: set.result.key ? null : null });
    assert.equal(del.ok, false); // unknown id
    const list = call("env-list", ctxA, {}, {});
    const realDel = call("env-delete", ctxA, {}, { id: list.result.vars[0].id });
    assert.equal(realDel.ok, true);
  });
});

describe("platform domain / routing management", () => {
  it("domain-attach starts unverified; domain-verify only succeeds on a real matching TXT record", async () => {
    const att = call("domain-attach", ctxA, {}, { host: "app.example.com", service: "web" });
    assert.equal(att.ok, true);
    assert.equal(att.result.domain.verified, false);
    assert.equal(att.result.domain.sslStatus, "not_managed");
    const txt = att.result.domain.dnsRecords.find((r) => r.type === "TXT");
    assert.ok(txt);

    const list = call("domain-list", ctxA, {}, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.pendingCount, 1);

    // record missing -> not verified
    const miss = await call("domain-verify", { ...ctxA, dnsResolveTxt: async () => [["unrelated"]] }, {}, { id: att.result.domain.id });
    assert.equal(miss.ok, false);
    // DNS failure -> honest error
    const nx = await call("domain-verify", { ...ctxA, dnsResolveTxt: async () => { const e = new Error("x"); e.code = "ENOTFOUND"; throw e; } }, {}, { id: att.result.domain.id });
    assert.equal(nx.ok, false);
    assert.equal(call("domain-list", ctxA, {}, {}).result.verifiedCount, 0);

    const ok = await call("domain-verify", { ...ctxA, dnsResolveTxt: async () => [[txt.value]] }, {}, { id: att.result.domain.id });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.domain.verified, true);

    const rm = call("domain-remove", ctxA, {}, { id: att.result.domain.id });
    assert.equal(rm.ok, true);
  });

  it("domain-attach rejects malformed host", () => {
    assert.equal(call("domain-attach", ctxA, {}, { host: "not a domain" }).ok, false);
  });
});

describe("platform alerting + on-call", () => {
  it("alert-channel-set + alert-create + alert-list evaluation + alert-delete", () => {
    const chan = call("alert-channel-set", ctxA, {}, { kind: "webhook", target: "https://hooks.example.com/x", label: "ops" });
    assert.equal(chan.ok, true);

    const rule = call("alert-create", ctxA, {}, {
      metric: "cpu", op: ">", threshold: 50, severity: "critical", channelId: chan.result.channel.id,
    });
    assert.equal(rule.ok, true);

    const fired = call("alert-list", ctxA, {}, { metrics: { cpu: 80 } });
    assert.equal(fired.ok, true);
    assert.equal(fired.result.firing, 1);

    const quiet = call("alert-list", ctxA, {}, { metrics: { cpu: 10 } });
    assert.equal(quiet.result.firing, 0);

    const del = call("alert-delete", ctxA, {}, { id: rule.result.alert.id });
    assert.equal(del.ok, true);
  });

  it("alert-create rejects bad metric", () => {
    assert.equal(call("alert-create", ctxA, {}, { metric: "bogus", threshold: 5 }).ok, false);
  });
});

describe("platform cost / usage", () => {
  it("usage-summary derives a billing breakdown", () => {
    call("deploy-create", ctxA, {}, { service: "web", ref: "main" });
    const r = call("usage-summary", ctxA, {}, { plan: "pro" });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan, "pro");
    assert.ok(Array.isArray(r.result.lineItems));
    assert.ok(typeof r.result.totalCost === "number");
  });
});

describe("platform audit log", () => {
  it("audit-list records platform changes", () => {
    call("env-set", ctxA, {}, { key: "X", value: "1" });
    call("domain-attach", ctxA, {}, { host: "a.example.com", service: "web" });
    const r = call("audit-list", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.total >= 2);
    assert.ok(r.result.actionCounts.env >= 1);
  });
});
