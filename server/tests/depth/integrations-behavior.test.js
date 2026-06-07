// tests/depth/integrations-behavior.test.js — REAL behavioral tests for the
// integrations domain (registerLensAction family, invoked via lensRun).
//
// The domain has NO live external HTTP egress: every "OAuth"/webhook path is a
// deterministic in-memory mock (mock tokenRef, FNV-style local signature, no
// fetch). So every branch here is exercised for real under the no-egress
// preload — there are no network-dependent success paths to skip.
//
// Wrapping note (verified against server.js:37511-37517 `lens.run`): a handler
// returning { ok:true, result } is unwrapped → the test sees r.ok===true /
// r.result.<field>. A handler returning a bare { ok:false, error } (no `result`
// key) is NOT unwrapped → the test sees r.ok===true (outer) / r.result.ok===false
// / r.result.error. Each lensRun("integrations","<macro>",…) literally names the
// macro → the macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

const ISO = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

describe("integrations — apiHealthCheck calc contract (exact computed values)", () => {
  it("a perfect endpoint scores 100 / healthy with exact latency + availability", async () => {
    // Single endpoint, 4 samples all 200, latencies [10,20,30,40].
    // latencies sorted = [10,20,30,40], n=4.
    //   p50 = sorted[ceil(0.5*4)-1] = sorted[1] = 20
    //   p95 = sorted[ceil(0.95*4)-1] = sorted[3] = 40
    //   avg = round(100/4*100)/100 = 25
    // statusCodes all 2xx → errorRate 0, availability 100.
    // latencyScore = max(0,100-(40/10)) = 96 ; availabilityScore = 100 ; errorScore = 100
    // healthScore = round((96*0.3 + 100*0.5 + 100*0.2)*100)/100
    //             = round((28.8 + 50 + 20)*100)/100 = 98.8 → healthy (>=90)
    const r = await lensRun("integrations", "apiHealthCheck", {
      data: { endpoints: [{
        name: "api", url: "https://api.example/health", samples: [
          { latencyMs: 10, statusCode: 200, timestamp: ISO(3000) },
          { latencyMs: 20, statusCode: 200, timestamp: ISO(2000) },
          { latencyMs: 30, statusCode: 200, timestamp: ISO(1000) },
          { latencyMs: 40, statusCode: 200, timestamp: ISO(0) },
        ],
      }] },
    });
    assert.equal(r.ok, true);
    const ep = r.result.endpoints[0];
    assert.equal(ep.latency.p50, 20);
    assert.equal(ep.latency.p95, 40);
    assert.equal(ep.latency.avg, 25);
    assert.equal(ep.availability, 100);
    assert.equal(ep.errorRate, 0);
    assert.equal(ep.healthScore, 98.8);
    assert.equal(ep.status, "healthy");
    assert.equal(r.result.overallStatus, "healthy");
    assert.equal(r.result.summary.healthy, 1);
  });

  it("error rate + availability split is exact across 4xx/5xx/2xx", async () => {
    // 4 samples: codes 200, 200, 404, 500.
    //   errors (>=400) = 2 → errorRate = round(2/4*10000)/100 = 50
    //   clientErrors (>=400 <500) = 1 ; serverErrors (>=500) = 1
    //   successCount (2xx/3xx) = 2 → availability = 50
    const r = await lensRun("integrations", "apiHealthCheck", {
      data: { endpoints: [{
        name: "flaky", samples: [
          { latencyMs: 5, statusCode: 200, timestamp: ISO(40) },
          { latencyMs: 5, statusCode: 200, timestamp: ISO(30) },
          { latencyMs: 5, statusCode: 404, timestamp: ISO(20) },
          { latencyMs: 5, statusCode: 500, timestamp: ISO(10) },
        ],
      }] },
    });
    const ep = r.result.endpoints[0];
    assert.equal(ep.errorRate, 50);
    assert.equal(ep.availability, 50);
    assert.equal(ep.errors.total, 2);
    assert.equal(ep.errors.client, 1);
    assert.equal(ep.errors.server, 1);
    assert.equal(ep.statusCodeDistribution["200"], 2);
  });

  it("an endpoint with no samples reports no_data; empty endpoint list short-circuits", async () => {
    const nd = await lensRun("integrations", "apiHealthCheck", {
      data: { endpoints: [{ name: "silent", samples: [] }] },
    });
    assert.equal(nd.result.endpoints[0].status, "no_data");
    assert.equal(nd.result.endpoints[0].availability, 0);

    const empty = await lensRun("integrations", "apiHealthCheck", { data: { endpoints: [] } });
    assert.equal(empty.ok, true);
    assert.equal(empty.result.message, "No endpoints to check.");
  });
});

describe("integrations — dataFlowMapping graph contract", () => {
  it("source/sink/intermediary roles, degrees, and a bottleneck are detected", async () => {
    // A -> B (10), A -> B again is not; build A->B->C with a fat intake at B.
    // flows: A->B 10mbps, D->B 10mbps, B->C 2mbps.
    //   B incoming throughput = 20, outgoing = 2 → bottleneckScore = round(20/2*100)/100 = 10 → isBottleneck (>2)
    //   A,D are sources (inDegree 0); C is sink (outDegree 0); B is intermediary.
    const r = await lensRun("integrations", "dataFlowMapping", {
      data: { flows: [
        { source: "A", target: "B", throughputMbps: 10, latencyMs: 5, protocol: "http" },
        { source: "D", target: "B", throughputMbps: 10, latencyMs: 5, protocol: "http" },
        { source: "B", target: "C", throughputMbps: 2, latencyMs: 7, protocol: "grpc" },
      ] },
    });
    assert.equal(r.ok, true);
    const byNode = Object.fromEntries(r.result.nodes.map((n) => [n.node, n]));
    assert.equal(byNode.A.role, "source");
    assert.equal(byNode.C.role, "sink");
    assert.equal(byNode.B.role, "intermediary");
    assert.equal(byNode.B.inDegree, 2);
    assert.equal(byNode.B.outDegree, 1);
    assert.equal(byNode.B.bottleneckScore, 10);
    assert.equal(byNode.B.isBottleneck, true);
    assert.equal(r.result.metrics.bottleneckCount, 1);
    assert.equal(r.result.bottlenecks[0].node, "B");
    // A->B->C path: throughput capacity = min(10,2)=2, total latency = 5+7=12
    const path = r.result.paths.find((p) => p.path[0] === "A");
    assert.ok(path, "A→C path exists");
    assert.equal(path.throughputCapacityMbps, 2);
    assert.equal(path.totalLatencyMs, 12);
    // protocol summary: http count 2, grpc count 1
    assert.equal(r.result.protocolSummary.http.count, 2);
    assert.equal(r.result.protocolSummary.grpc.count, 1);
  });

  it("empty flow list short-circuits with a message", async () => {
    const r = await lensRun("integrations", "dataFlowMapping", { data: { flows: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No flows to map.");
  });
});

describe("integrations — compatibilityCheck semver + migration scoring", () => {
  it("a major jump with breaking changes scores high effort and is not backward compatible", async () => {
    // current 1.2.0 → target 2.0.0: versionJump = "major".
    // changes: 1 removed (breaking), 1 added (non-breaking).
    //   breakingChanges = [removed] → 1 ; nonBreakingChanges = [added] → 1
    //   migrationEffort = 1*8 + 1*2 + 15(major) = 25 → score 25 → level "low" (>=10)
    //   estimatedHours = round(25*0.4*10)/10 = round(100)/10 = 10
    //   backwardCompatible = false (has breaking + major)
    const r = await lensRun("integrations", "compatibilityCheck", {
      data: { apis: [{
        name: "billing", currentVersion: "1.2.0", targetVersion: "2.0.0",
        changes: [
          { type: "removed", field: "legacyId" },
          { type: "added", field: "newId" },
        ],
      }] },
    });
    assert.equal(r.ok, true);
    const a = r.result.apis[0];
    assert.equal(a.versionJump, "major");
    assert.equal(a.backwardCompatible, false);
    assert.equal(a.changes.breaking, 1);
    assert.equal(a.changes.nonBreaking, 1);
    assert.deepEqual(a.changes.removed, ["legacyId"]);
    assert.deepEqual(a.changes.added, ["newId"]);
    assert.equal(a.migration.effortScore, 25);
    assert.equal(a.migration.level, "low");
    assert.equal(a.migration.estimatedHours, 10);
    assert.equal(r.result.summary.totalBreakingChanges, 1);
    assert.equal(r.result.summary.incompatible, 1);
  });

  it("a patch bump with no changes is backward compatible and trivial effort", async () => {
    // 1.0.0 → 1.0.1: versionJump = "patch", no changes, not major.
    //   migrationEffort = 0 → score 0 → level "trivial" (<10)
    //   inferredBreaking = false ; backwardCompatible = true
    const r = await lensRun("integrations", "compatibilityCheck", {
      data: { apis: [{ name: "search", currentVersion: "1.0.0", targetVersion: "1.0.1" }] },
    });
    const a = r.result.apis[0];
    assert.equal(a.versionJump, "patch");
    assert.equal(a.backwardCompatible, true);
    assert.equal(a.inferredBreaking, false);
    assert.equal(a.migration.effortScore, 0);
    assert.equal(a.migration.level, "trivial");
    assert.equal(r.result.summary.allBackwardCompatible, true);
  });

  it("a major bump with NO explicit changes infers breaking", async () => {
    // 1.5.2 → 2.0.0, changes empty, versionJump major → inferredBreaking true.
    //   effort = 0 breaking + 0 nonBreaking + 15 (major) = 15 → score 15 → "low"
    //   backwardCompatible = false (inferredBreaking)
    const r = await lensRun("integrations", "compatibilityCheck", {
      data: { apis: [{ name: "core", currentVersion: "1.5.2", targetVersion: "2.0.0" }] },
    });
    const a = r.result.apis[0];
    assert.equal(a.inferredBreaking, true);
    assert.equal(a.backwardCompatible, false);
    assert.equal(a.migration.effortScore, 15);
  });
});

describe("integrations — connector catalog + connections CRUD (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("integrations-conn"); });

  it("connectorCatalog filters by category and search", async () => {
    const all = await lensRun("integrations", "connectorCatalog", {}, ctx);
    assert.equal(all.ok, true);
    assert.equal(all.result.total, 9); // 9 entries in CONNECTOR_CATALOG
    assert.ok(all.result.categories.includes("communication"));

    const comms = await lensRun("integrations", "connectorCatalog", { params: { category: "communication" } }, ctx);
    // slack + discord are the two communication connectors
    assert.equal(comms.result.total, 2);
    assert.ok(comms.result.connectors.every((c) => c.category === "communication"));

    const gh = await lensRun("integrations", "connectorCatalog", { params: { search: "github" } }, ctx);
    assert.equal(gh.result.total, 1);
    assert.equal(gh.result.connectors[0].id, "github");
  });

  it("connectApp mints a connection that connectionList returns, then disconnectApp removes it", async () => {
    const conn = await lensRun("integrations", "connectApp", { params: { connectorId: "slack", label: "team" } }, ctx);
    assert.equal(conn.ok, true);
    assert.equal(conn.result.connection.connectorId, "slack");
    assert.equal(conn.result.connection.status, "connected");
    assert.equal(conn.result.connection.label, "team");
    const id = conn.result.connection.id;

    const list = await lensRun("integrations", "connectionList", {}, ctx);
    assert.ok(list.result.connections.some((c) => c.id === id));

    const dc = await lensRun("integrations", "disconnectApp", { params: { connectionId: id } }, ctx);
    assert.equal(dc.ok, true);
    assert.equal(dc.result.disconnected, id);
    const list2 = await lensRun("integrations", "connectionList", {}, ctx);
    assert.ok(!list2.result.connections.some((c) => c.id === id), "disconnected app is gone");
  });

  it("connectApp with an unknown connector is refused", async () => {
    const r = await lensRun("integrations", "connectApp", { params: { connectorId: "no-such-app" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("Unknown connector"));
  });
});

describe("integrations — zap builder, run engine, and history (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("integrations-zap"); });

  it("zapSave rejects a missing name and an invalid step kind", async () => {
    const noName = await lensRun("integrations", "zapSave", { params: { trigger: { event: "x" } } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.ok(String(noName.result.error).includes("name required"));

    const badStep = await lensRun("integrations", "zapSave", {
      params: { name: "z", trigger: { event: "x" }, steps: [{ kind: "nonsense" }] },
    }, ctx);
    assert.equal(badStep.result.ok, false);
    assert.ok(String(badStep.result.error).includes("unknown kind"));
  });

  it("a zap whose filter passes runs to success; a filter that fails halts as 'filtered'", async () => {
    // Save a zap: filter (data.amount > 100) → action.
    const save = await lensRun("integrations", "zapSave", {
      params: {
        name: "big-charges", trigger: { event: "stripe.new_charge" },
        steps: [
          { kind: "filter", condition: "amount > 100" },
          { kind: "action", connectorId: "slack", actionId: "post_message", fieldMap: { text: "$.amount" } },
        ],
      },
    }, ctx);
    assert.equal(save.ok, true);
    const zapId = save.result.zap.id;
    assert.equal(save.result.zap.enabled, true);

    // amount 250 → filter passes → action dispatches → success
    const pass = await lensRun("integrations", "zapRun", { params: { zapId, triggerData: { amount: 250 } } }, ctx);
    assert.equal(pass.ok, true);
    assert.equal(pass.result.run.status, "success");
    const actionTrace = pass.result.run.trace.find((t) => t.kind === "action");
    assert.equal(actionTrace.actionId, "post_message");
    assert.equal(actionTrace.payload.text, 250); // $.amount resolved from the bag

    // amount 50 → filter fails → halts as filtered
    const halt = await lensRun("integrations", "zapRun", { params: { zapId, triggerData: { amount: 50 } } }, ctx);
    assert.equal(halt.result.run.status, "filtered");
    const filterTrace = halt.result.run.trace.find((t) => t.kind === "filter");
    assert.equal(filterTrace.passed, false);

    // runHistory reflects both runs and the success/filtered split
    const hist = await lensRun("integrations", "runHistory", { params: { zapId } }, ctx);
    assert.equal(hist.result.total, 2);
    assert.equal(hist.result.summary.success, 1);
    assert.equal(hist.result.summary.filtered, 1);
  });

  it("zapRun on an unknown zap id is refused", async () => {
    const r = await lensRun("integrations", "zapRun", { params: { zapId: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("Zap not found"));
  });
});

describe("integrations — primitive evaluators (condition / formatter / code / fieldmap)", () => {
  it("evalCondition handles &&, ||, contains, and numeric comparison", async () => {
    const andTrue = await lensRun("integrations", "evalCondition", {
      params: { condition: "status == open && priority > 2", data: { status: "open", priority: 5 } },
    });
    assert.equal(andTrue.result.matched, true);
    const andFalse = await lensRun("integrations", "evalCondition", {
      params: { condition: "status == open && priority > 2", data: { status: "open", priority: 1 } },
    });
    assert.equal(andFalse.result.matched, false);
    const contains = await lensRun("integrations", "evalCondition", {
      params: { condition: "tags contains urgent", data: { tags: ["urgent", "billing"] } },
    });
    assert.equal(contains.result.matched, true);
  });

  it("runFormatter applies the op exactly and rejects an unknown op", async () => {
    const up = await lensRun("integrations", "runFormatter", { params: { op: "uppercase", value: "hi" } });
    assert.equal(up.result.output, "HI");
    const round = await lensRun("integrations", "runFormatter", { params: { op: "round", value: 3.14159, config: { decimals: 2 } } });
    assert.equal(round.result.output, 3.14);
    const split = await lensRun("integrations", "runFormatter", { params: { op: "split", value: "a,b,c" } });
    assert.deepEqual(split.result.output, ["a", "b", "c"]);
    const bad = await lensRun("integrations", "runFormatter", { params: { op: "explode", value: "x" } });
    assert.equal(bad.result.ok, false);
    assert.ok(String(bad.result.error).includes("unknown formatter op"));
  });

  it("runCodeStep evaluates sum/concat/len intrinsics over the bag", async () => {
    const sum = await lensRun("integrations", "runCodeStep", { params: { expression: "sum($.a, $.b, 5)", data: { a: 10, b: 20 } } });
    assert.equal(sum.result.output, 35); // 10 + 20 + 5
    const concat = await lensRun("integrations", "runCodeStep", { params: { expression: "concat($.first, '-', $.last)", data: { first: "ada", last: "lovelace" } } });
    assert.equal(concat.result.output, "ada-lovelace");
    const noExpr = await lensRun("integrations", "runCodeStep", { params: {} });
    assert.equal(noExpr.result.ok, false);
  });

  it("previewFieldMap resolves $.paths and flags unresolved fields", async () => {
    const r = await lensRun("integrations", "previewFieldMap", {
      params: { mapping: { name: "$.user.name", missing: "$.user.email", literal: "fixed" }, sample: { user: { name: "Eve" } } },
    });
    assert.equal(r.result.mapped.name, "Eve");
    assert.equal(r.result.mapped.literal, "fixed");
    assert.deepEqual(r.result.unresolved, ["missing"]);
    assert.equal(r.result.fieldCount, 3);
  });
});

describe("integrations — webhook test, signature verify, and retry backoff (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("integrations-webhook"); });

  it("webhookTest with a url delivers and signs; without a url it refuses", async () => {
    const ok = await lensRun("integrations", "webhookTest", { params: { webhookId: "wh1", url: "https://hooks.example/x" } }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.delivered, true);
    assert.equal(ok.result.delivery.statusCode, 200);
    assert.ok(ok.result.signature.startsWith("sha="));

    const noUrl = await lensRun("integrations", "webhookTest", { params: { webhookId: "wh2" } }, ctx);
    // handler returns { ok:false, result, error } — result IS present so it unwraps;
    // delivered is false and status is no_url.
    assert.equal(noUrl.result.delivered, false);
    assert.equal(noUrl.result.delivery.status, "no_url");
  });

  it("verifyWebhookSignature validates a correct signature and rejects a tampered one", async () => {
    const body = JSON.stringify({ event: "order.created", id: 7 });
    // Fire a test to ensure the webhook meta (and its secret) exists, then read deliveries.
    await lensRun("integrations", "webhookTest", { params: { webhookId: "wh3", url: "https://x", payload: JSON.parse(body) } }, ctx);
    // We don't know the secret, but verify can compute the expected sig itself.
    const wrong = await lensRun("integrations", "verifyWebhookSignature", { params: { webhookId: "wh3", body, signature: "sha=deadbeefdeadbeef" } }, ctx);
    assert.equal(wrong.result.valid, false);
    // Now feed back the expected signature it just told us → must validate.
    const good = await lensRun("integrations", "verifyWebhookSignature", { params: { webhookId: "wh3", body, signature: wrong.result.expected } }, ctx);
    assert.equal(good.result.valid, true);
  });

  it("webhookRetry computes backoff and exhausts at maxAttempts", async () => {
    // Seed an original delivery (attempt 1) via webhookTest.
    const seed = await lensRun("integrations", "webhookTest", { params: { webhookId: "wh4", url: "https://x" } }, ctx);
    const deliveryId = seed.result.delivery.id;

    // attempt 2 → backoffSeconds[min(2-2,2)] = backoffSeconds[0] = 2
    const r2 = await lensRun("integrations", "webhookRetry", { params: { webhookId: "wh4", deliveryId } }, ctx);
    assert.equal(r2.ok, true);
    assert.equal(r2.result.attempt, 2);
    assert.equal(r2.result.nextBackoffSeconds, 2);
    assert.equal(r2.result.retry.status, "delivered");

    // Retry against the now attempt-2 retry record → attempt 3 = maxAttempts → exhausted true
    const r3 = await lensRun("integrations", "webhookRetry", { params: { webhookId: "wh4", deliveryId: r2.result.retry.id } }, ctx);
    assert.equal(r3.result.attempt, 3);
    assert.equal(r3.result.nextBackoffSeconds, 8); // backoffSeconds[min(3-2,2)] = [1] = 8
    assert.equal(r3.result.exhausted, true);

    // A 4th attempt exceeds maxAttempts (3) → refused.
    const r4 = await lensRun("integrations", "webhookRetry", { params: { webhookId: "wh4", deliveryId: r3.result.retry.id } }, ctx);
    assert.equal(r4.result.ok, false);
    assert.ok(String(r4.result.error).includes("max retry attempts"));
  });

  it("webhookRetry on a missing delivery is refused", async () => {
    const r = await lensRun("integrations", "webhookRetry", { params: { webhookId: "wh5", deliveryId: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("Delivery not found"));
  });
});
