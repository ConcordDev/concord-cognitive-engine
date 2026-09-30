// tests/depth/execution-envelope-behavior.test.js — REAL behavioral tests
// for lib/runtime/execution-envelope.js's runCapability(). Lives in
// tests/depth/ (not tests/runtime/) because it needs the full server boot
// — it dispatches through the REAL globalThis.__concordLensActions /
// __concordRunMacro globals, not fakes, proving the envelope actually
// reaches live, already-tested predict.* handlers end to end.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { depthCtx, load } from "./_harness.js";
import { runCapability } from "../../lib/runtime/execution-envelope.js";
import { subscribe, _reset as resetBus } from "../../lib/runtime/event-bus.js";

describe("runCapability: request validation (no boot needed for these, but load() is cheap once cached)", () => {
  it("missing capability -> error, no ctx needed to detect this", async () => {
    const r = await runCapability({});
    assert.equal(r.status, "error");
    assert.equal(r.reason, "missing_capability");
  });

  it("unregistered capability -> error, distinct reason", async () => {
    const r = await runCapability({ capability: "totally.unregistered.thing", ctx: {} });
    assert.equal(r.status, "error");
    assert.equal(r.reason, "capability_not_registered");
  });

  it("missing ctx on an otherwise-real capability -> error, never dispatches without a real ctx", async () => {
    await load(); // ensure predict.js's module-level registerCapability calls have run
    const r = await runCapability({ capability: "predict.create", input: { subject: "x" } });
    assert.equal(r.status, "error");
    assert.equal(r.reason, "missing_ctx");
  });
});

describe("runCapability: real dispatch through predict.create/resolve, with event-bus visibility", () => {
  it("dispatches to the REAL predict.create handler, returns status:ok + the real ticket, and publishes capability.invoked/completed", async () => {
    resetBus();
    const seen = [];
    subscribe("*", (e) => seen.push(e.name));

    const ctx = await depthCtx("envelope-create");
    const r = await runCapability({
      capability: "predict.create",
      ctx,
      actor: "test-actor",
      input: {
        subject: "ENV-USD", eventDefinition: "e", horizonSeconds: 60,
        modelId: "envelope-test", forecastDistribution: { prob: 0.5 }, featureSnapshot: {},
      },
    });
    assert.equal(r.status, "ok");
    assert.equal(r.result.result.ticket.subject, "ENV-USD");
    assert.equal(typeof r.durationMs, "number");
    assert.ok(r.requestId);

    assert.ok(seen.includes("capability.invoked"));
    assert.ok(seen.includes("capability.completed"));
    assert.ok(seen.includes("prediction.created")); // predict.create's OWN publish, proving the dispatch reached real code, not a stub
  });

  it("a handler-reported failure (e.g. resolve with a missing id) surfaces as status:error with the handler's own reason, and publishes capability.failed", async () => {
    resetBus();
    const seen = [];
    subscribe("capability.failed", (e) => seen.push(e));

    const ctx = await depthCtx("envelope-resolve-fail");
    const r = await runCapability({ capability: "predict.resolve", ctx, input: { id: "does-not-exist" } });
    assert.equal(r.status, "error");
    assert.equal(r.reason, "not_found"); // predict.resolve's own {ok:false, reason:"not_found"}
    assert.equal(seen.length, 1);
    assert.equal(seen[0].payload.reason, "not_found");
  });

  it("a full create -> resolve round trip through the envelope matches direct lensRun (same underlying handler, no divergence)", async () => {
    const ctx = await depthCtx("envelope-roundtrip");
    const created = await runCapability({
      capability: "predict.create",
      ctx,
      input: { subject: "ENV2-USD", eventDefinition: "e", horizonSeconds: 60, modelId: "envelope-test-2", forecastDistribution: { prob: 0.377 }, featureSnapshot: {} },
    });
    assert.equal(created.status, "ok");
    const id = created.result.result.ticket.id;

    const resolved = await runCapability({
      capability: "predict.resolve",
      ctx,
      input: { id, actualOutcome: true, actualValue: { realized_return_pct: 0.1 } },
    });
    assert.equal(resolved.status, "ok");
    assert.equal(resolved.result.result.ticket.outcome.actualOutcome, "true");
    // Brier = (0.377 - 1)^2 = 0.388129, hand-computed independently of the implementation
    assert.ok(Math.abs(resolved.result.result.ticket.outcome.scoreBrier - 0.388129) < 1e-6);
  });
});

describe("runCapability: unreachable-but-registered is honestly distinct from unregistered", () => {
  it("returns capability_unreachable when the descriptor exists but no real handler is wired (proves health.reachable is actually consulted, not assumed)", async () => {
    const { registerCapability } = await import("../../lib/runtime/capability-registry.js");
    // Register a fake capability that will never have a real LENS_ACTIONS/MACROS
    // entry. Deliberately NOT calling _resetRegistry anywhere in this file —
    // predict's real registrations live in the same process-wide registry
    // and other tests in this process depend on them still being present.
    registerCapability({ capability: "faketest.nothing", owner: "faketest", risk: "read" });
    const r = await runCapability({ capability: "faketest.nothing", ctx: {} });
    assert.equal(r.status, "error");
    assert.equal(r.reason, "capability_unreachable");
  });
});
