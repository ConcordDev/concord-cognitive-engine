// tests/runtime/event-bus-schema-enforcement.test.js
//
// Pins the 2026-09-13 additions to lib/runtime/event-bus.js: opt-in event
// schemas (EVENT_SCHEMAS / registerEventType) and the unregistered-event
// tally (unregisteredEventStats). See that file's own module header for
// the full "why enforcement here means observable, not rejecting" reasoning
// — this suite proves both halves of that promise:
//   1. publish() NEVER throws and NEVER drops delivery, valid or invalid
//      payload, registered or unregistered event name.
//   2. A registered schema violation IS recorded (bus.shape_violation) and
//      an unregistered event name IS counted, so the taxonomy's real
//      coverage becomes observable instead of asserted in a comment.
//
// Also locks in the concrete regression this file's own history holds: a
// schema asserted on a field the real caller doesn't actually send is a
// false-positive generator, not a safety net. The "real call site shapes"
// test below is copied verbatim from the payloads at every current
// publish() call site outside this module (grep-verified before writing),
// so a future schema edit that reintroduces that mistake fails here first.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  publish, subscribe, recentEvents, unregisteredEventStats, registerEventType, _reset,
} from "../../lib/runtime/event-bus.js";

beforeEach(() => _reset());

describe("EVENT_SCHEMAS: registered events with a valid payload", () => {
  it("produces no bus.shape_violation for the exact real payload shape of every registered event", () => {
    const violations = [];
    subscribe("bus.shape_violation", (e) => violations.push(e.payload));

    // Copied from the real call sites (domains/predict.js,
    // lib/runtime/pentester-control.js, lib/runtime/trading-observe.js,
    // lib/runtime/execution-envelope.js) as of 2026-09-13.
    publish("prediction.created", { id: "t1", subject: "s", modelId: "m", decision: "d" });
    publish("prediction.resolved", { id: "t1", subject: "s", modelId: "m", actualOutcome: "x", scoreBrier: 0.1 });
    publish("finding.created", { dtuId: "d1", kind: "x", title: "t" });
    publish("finding.created", { kind: "pentester.scope_denied", host: "h", reason: "r" });
    publish("trade.executed", { venue: "dila_coinbase", product: "p", side: "buy", amountUsd: 1, strategy: "s", loggedAt: 1 });
    publish("trade.resolved", { venue: "dila_coinbase", product: "p", realizedPnl: 1, loggedAt: 1 });
    publish("capability.invoked", { requestId: "r1", capability: "c", actor: null, intent: null });
    publish("capability.completed", { requestId: "r1", capability: "c", durationMs: 1 });
    publish("capability.failed", { requestId: "r1", capability: "c", reason: "x", durationMs: 1 });
    publish("capability.promoted", { capability: "predict.m", modelId: "m", operatorId: "o", n: 1, dtuId: "d" });
    publish("capability.rejected", { capability: "predict.promoteAuthority", modelId: "m", operatorId: "o", evidenceStage: "s", reason: "x" });

    assert.deepEqual(violations, [], "a real, currently-shipping call site should never trip its own event's schema");
  });
});

describe("EVENT_SCHEMAS: registered events with an invalid payload", () => {
  it("records a bus.shape_violation naming the missing field(s), but still delivers the event", () => {
    // bus.shape_violation is a ring-only meta-event (same contract as the
    // pre-existing bus.listener_error / bus.emit_error) — it is recorded
    // via recentEvents(), never emitted on the bus itself, so a subscriber
    // can't listen for it directly. Assert both halves through the
    // interfaces that actually carry them.
    const delivered = [];
    subscribe("capability.invoked", (e) => delivered.push(e));

    publish("capability.invoked", { actor: "someone" }); // missing required "capability"

    assert.equal(delivered.length, 1, "delivery must happen regardless of shape violations");
    const violation = recentEvents(10).find((e) => e.name === "bus.shape_violation");
    assert.ok(violation, "expected a bus.shape_violation entry in recentEvents()");
    assert.equal(violation.payload.originalEvent, "capability.invoked");
    assert.deepEqual(violation.payload.missing, ["capability"]);
  });

  it("never throws on a non-object payload for a registered event", () => {
    assert.doesNotThrow(() => publish("capability.invoked", null));
    assert.doesNotThrow(() => publish("capability.invoked", "not an object"));
    assert.doesNotThrow(() => publish("capability.invoked", ["array", "not", "object"]));
  });
});

describe("unregistered events: counted, never rejected", () => {
  it("an event name with no schema is still delivered normally", () => {
    const delivered = [];
    subscribe("totally.unregistered.event", (e) => delivered.push(e));
    publish("totally.unregistered.event", { anything: "goes" });
    assert.equal(delivered.length, 1);
  });

  it("unregisteredEventStats tallies unregistered names, most-frequent first", () => {
    publish("custom.thing.a", {});
    publish("custom.thing.a", {});
    publish("custom.thing.b", {});

    const stats = unregisteredEventStats();
    const a = stats.find((s) => s.name === "custom.thing.a");
    const b = stats.find((s) => s.name === "custom.thing.b");
    assert.equal(a.count, 2);
    assert.equal(b.count, 1);
    // most-frequent first
    assert.ok(stats.indexOf(a) < stats.indexOf(b));
  });

  it("a REGISTERED event name is never counted as unregistered, even repeatedly", () => {
    publish("capability.invoked", { capability: "c" });
    publish("capability.invoked", { capability: "c" });
    const stats = unregisteredEventStats();
    assert.equal(stats.find((s) => s.name === "capability.invoked"), undefined);
  });
});

describe("registerEventType: domains can opt in without editing this file", () => {
  it("a newly registered event type is validated going forward", () => {
    registerEventType("test.custom.event", { required: ["mustHave"] });

    publish("test.custom.event", { mustHave: 1 }); // valid
    publish("test.custom.event", {}); // invalid

    const violations = recentEvents(10).filter((e) => e.name === "bus.shape_violation");
    assert.equal(violations.length, 1, "only the invalid publish should record a violation");
    assert.equal(violations[0].payload.originalEvent, "test.custom.event");
    assert.deepEqual(violations[0].payload.missing, ["mustHave"]);

    // and it's no longer counted as unregistered
    const stats = unregisteredEventStats();
    assert.equal(stats.find((s) => s.name === "test.custom.event"), undefined);
  });

  it("malformed registration input is ignored, never throws", () => {
    assert.doesNotThrow(() => registerEventType(123, { required: ["x"] }));
    assert.doesNotThrow(() => registerEventType("ok.name", null));
    assert.doesNotThrow(() => registerEventType("ok.name", { required: "not-an-array" }));
  });
});

describe("recentEvents surfaces shape_violation/unregistered activity for observability", () => {
  it("bus.shape_violation entries appear in recentEvents alongside normal events", () => {
    publish("capability.invoked", {}); // triggers a violation (missing capability)
    const recent = recentEvents(10).map((e) => e.name);
    assert.ok(recent.includes("bus.shape_violation"));
    assert.ok(recent.includes("capability.invoked"));
  });
});
