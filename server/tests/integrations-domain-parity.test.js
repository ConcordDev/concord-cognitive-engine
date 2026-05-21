// Contract tests for server/domains/integrations.js — the Zapier-parity
// feature backlog: connector catalog + OAuth-style connections, the visual
// Zap workflow builder + run engine (filters, branching, formatter, code),
// field-level mapping, run history + retry, scheduled/polling triggers, and
// webhook test/activate/retry + signature verification.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerIntegrationsActions from "../domains/integrations.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`integrations.${name}`);
  if (!fn) throw new Error(`integrations.${name} not registered`);
  const artifact = { id: null, domain: "integrations", type: "domain_action", data: params, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => { registerIntegrationsActions(register); });

beforeEach(() => {
  // Fresh per-user substrate each test so runs don't bleed across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("integrations.connectorCatalog + connections (OAuth-style)", () => {
  it("lists connectors with categories", () => {
    const r = call("connectorCatalog", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.connectors.length > 0);
    assert.ok(r.result.categories.includes("communication"));
  });

  it("filters connectors by category and search", () => {
    const byCat = call("connectorCatalog", ctxA, { category: "payments" });
    assert.ok(byCat.result.connectors.every((c) => c.category === "payments"));
    const bySearch = call("connectorCatalog", ctxA, { search: "git" });
    assert.ok(bySearch.result.connectors.some((c) => c.id === "github"));
  });

  it("connects an app, lists it, then disconnects", () => {
    const conn = call("connectApp", ctxA, { connectorId: "slack" });
    assert.equal(conn.ok, true);
    assert.equal(conn.result.connection.connectorId, "slack");
    const list = call("connectionList", ctxA, {});
    assert.equal(list.result.count, 1);
    const disc = call("disconnectApp", ctxA, { connectionId: conn.result.connection.id });
    assert.equal(disc.ok, true);
    assert.equal(call("connectionList", ctxA, {}).result.count, 0);
  });

  it("rejects unknown connectors and is per-user isolated", () => {
    assert.equal(call("connectApp", ctxA, { connectorId: "nope" }).ok, false);
    call("connectApp", ctxA, { connectorId: "gmail" });
    assert.equal(call("connectionList", ctxB, {}).result.count, 0);
  });
});

describe("integrations.zap CRUD + validation", () => {
  it("saves, lists, toggles and deletes a zap", () => {
    const saved = call("zapSave", ctxA, {
      name: "Issue to Slack",
      trigger: { event: "dtu.created" },
      steps: [{ kind: "action", actionId: "post_message", fieldMap: { text: "$.data.title" } }],
    });
    assert.equal(saved.ok, true);
    const id = saved.result.zap.id;
    assert.equal(call("zapList", ctxA, {}).result.count, 1);
    const tog = call("zapToggle", ctxA, { zapId: id, enabled: false });
    assert.equal(tog.result.enabled, false);
    assert.equal(call("zapDelete", ctxA, { zapId: id }).ok, true);
    assert.equal(call("zapList", ctxA, {}).result.count, 0);
  });

  it("rejects a zap without name or trigger, and a bad step", () => {
    assert.equal(call("zapSave", ctxA, { trigger: { event: "x" } }).ok, false);
    assert.equal(call("zapSave", ctxA, { name: "n" }).ok, false);
    const bad = call("zapSave", ctxA, {
      name: "n", trigger: { event: "x" },
      steps: [{ kind: "filter" }],
    });
    assert.equal(bad.ok, false);
  });
});

describe("integrations step primitives (condition / formatter / code / map)", () => {
  it("evaluates conditions with comparisons and contains", () => {
    const r = call("evalCondition", ctxA, {
      condition: 'data.amount > 100 && data.tag contains "urgent"',
      data: { data: { amount: 240, tag: "urgent" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, true);
    const miss = call("evalCondition", ctxA, { condition: "data.amount > 1000", data: { data: { amount: 5 } } });
    assert.equal(miss.result.matched, false);
  });

  it("runs formatter ops and lists them", () => {
    assert.equal(call("runFormatter", ctxA, { op: "uppercase", value: "hi" }).result.output, "HI");
    assert.equal(call("runFormatter", ctxA, { op: "bogus", value: "x" }).ok, false);
    assert.ok(call("formatterOps", ctxA, {}).result.ops.includes("truncate"));
  });

  it("runs code-step intrinsics", () => {
    const r = call("runCodeStep", ctxA, {
      expression: 'concat($.data.first, " ", $.data.last)',
      data: { data: { first: "Ada", last: "Lovelace" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.output, "Ada Lovelace");
    assert.equal(call("runCodeStep", ctxA, {}).ok, false);
  });

  it("previews field-level data mapping and flags unresolved fields", () => {
    const r = call("previewFieldMap", ctxA, {
      mapping: { text: "$.data.title", missing: "$.data.nope", label: "lit" },
      sample: { data: { title: "Deal" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.mapped.text, "Deal");
    assert.equal(r.result.mapped.label, "lit");
    assert.deepEqual(r.result.unresolved, ["missing"]);
  });
});

describe("integrations zap run engine + history + retry", () => {
  function makeZap(steps) {
    return call("zapSave", ctxA, {
      name: "Runner", trigger: { event: "dtu.created" }, steps,
    }).result.zap;
  }

  it("runs a zap end-to-end and records run history", () => {
    const zap = makeZap([
      { kind: "filter", condition: "data.amount > 100" },
      { kind: "code", expression: "len($.data.tag)", outputKey: "taglen" },
      { kind: "action", actionId: "create_dtu", fieldMap: { title: "$.data.title" } },
    ]);
    const run = call("zapRun", ctxA, { zapId: zap.id, triggerData: { data: { amount: 200, tag: "abc", title: "T" } } });
    assert.equal(run.ok, true);
    assert.equal(run.result.run.status, "success");
    const hist = call("runHistory", ctxA, { zapId: zap.id });
    assert.equal(hist.result.total, 1);
    assert.equal(hist.result.summary.success, 1);
  });

  it("halts a run when a filter fails", () => {
    const zap = makeZap([{ kind: "filter", condition: "data.amount > 1000" }]);
    const run = call("zapRun", ctxA, { zapId: zap.id, triggerData: { data: { amount: 1 } } });
    assert.equal(run.result.run.status, "filtered");
  });

  it("takes the matching branch in a path step", () => {
    const zap = makeZap([{
      kind: "path",
      branches: [
        { label: "big", condition: "data.amount > 100", steps: [{ kind: "action", actionId: "a1" }] },
        { label: "small", condition: "", steps: [{ kind: "action", actionId: "a2" }] },
      ],
    }]);
    const run = call("zapRun", ctxA, { zapId: zap.id, triggerData: { data: { amount: 500 } } });
    const pathTrace = run.result.run.trace.find((t) => t.kind === "path");
    assert.equal(pathTrace.branchLabel, "big");
  });

  it("replays a recorded run via retryRun", () => {
    const zap = makeZap([{ kind: "action", actionId: "create_dtu" }]);
    const first = call("zapRun", ctxA, { zapId: zap.id, triggerData: { data: { x: 1 } } });
    const retry = call("retryRun", ctxA, { runId: first.result.run.id });
    assert.equal(retry.ok, true);
    assert.equal(retry.result.run.attempt, 2);
    assert.equal(retry.result.run.replayOf, first.result.run.id);
    assert.equal(call("retryRun", ctxA, { runId: "missing" }).ok, false);
  });
});

describe("integrations scheduled / polling triggers", () => {
  it("sets, lists due, and clears a schedule", () => {
    const zap = call("zapSave", ctxA, {
      name: "Sched", trigger: { event: "schedule.cron" }, steps: [],
    }).result.zap;
    const set = call("scheduleSet", ctxA, { zapId: zap.id, kind: "interval", intervalSeconds: 300 });
    assert.equal(set.ok, true);
    assert.ok(set.result.schedule.nextFireAt);
    const due = call("dueSchedules", ctxA, {});
    assert.equal(due.result.schedules.length, 1);
    assert.equal(call("scheduleClear", ctxA, { zapId: zap.id }).ok, true);
  });

  it("rejects an unknown schedule kind", () => {
    const zap = call("zapSave", ctxA, { name: "S", trigger: { event: "x" }, steps: [] }).result.zap;
    assert.equal(call("scheduleSet", ctxA, { zapId: zap.id, kind: "hourly" }).ok, false);
  });
});

describe("integrations webhook test / activate / retry / signature", () => {
  it("test-fires a webhook and records a signed delivery", () => {
    const r = call("webhookTest", ctxA, { webhookId: "wh_1", url: "https://example.com/hook" });
    assert.equal(r.ok, true);
    assert.equal(r.result.delivered, true);
    assert.match(r.result.signature, /^sha=/);
    const deliveries = call("webhookDeliveries", ctxA, { webhookId: "wh_1" });
    assert.equal(deliveries.result.total, 1);
  });

  it("fails a test-fire with no target URL", () => {
    const r = call("webhookTest", ctxA, { webhookId: "wh_2" });
    assert.equal(r.ok, false);
  });

  it("activates and deactivates a webhook", () => {
    const on = call("webhookActivate", ctxA, { webhookId: "wh_3", enabled: true });
    assert.equal(on.ok, true);
    assert.equal(on.result.enabled, true);
    const off = call("webhookActivate", ctxA, { webhookId: "wh_3", enabled: false });
    assert.equal(off.result.enabled, false);
    assert.equal(call("webhookActivate", ctxA, {}).ok, false);
  });

  it("retries a delivery with backoff and verifies signatures", () => {
    const test = call("webhookTest", ctxA, { webhookId: "wh_4", url: "https://x.dev/h" });
    const retry = call("webhookRetry", ctxA, { webhookId: "wh_4", deliveryId: test.result.delivery.id });
    assert.equal(retry.ok, true);
    assert.equal(retry.result.attempt, 2);
    assert.ok(retry.result.nextBackoffSeconds > 0);

    const body = JSON.stringify({ event: "ping" });
    // verifyWebhookSignature only knows the secret after the webhook has meta.
    const bad = call("verifyWebhookSignature", ctxA, { webhookId: "wh_4", body, signature: "sha=deadbeef" });
    assert.equal(bad.ok, true);
    assert.equal(bad.result.valid, false);
    const good = call("verifyWebhookSignature", ctxA, { webhookId: "wh_4", body, signature: bad.result.expected });
    assert.equal(good.result.valid, true);
  });
});

describe("integrations pure-compute macros (regression)", () => {
  it("apiHealthCheck scores endpoints", () => {
    const r = call("apiHealthCheck", ctxA, {
      endpoints: [{ name: "api", samples: [
        { latencyMs: 50, statusCode: 200, timestamp: "2026-05-01T00:00:00Z" },
        { latencyMs: 80, statusCode: 200, timestamp: "2026-05-01T00:00:01Z" },
      ] }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.overallHealthScore > 0);
  });

  it("dataFlowMapping builds a flow graph", () => {
    const r = call("dataFlowMapping", ctxA, {
      flows: [{ source: "a", target: "b", throughputMbps: 10 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.metrics.totalNodes, 2);
  });

  it("compatibilityCheck detects breaking changes", () => {
    const r = call("compatibilityCheck", ctxA, {
      apis: [{ name: "x", currentVersion: "1.0.0", targetVersion: "2.0.0" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.apis[0].versionJump, "major");
  });
});
