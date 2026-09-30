// tests/runtime/event-bus.test.js — REAL behavioral tests for
// lib/runtime/event-bus.js.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { publish, subscribe, recentEvents, _reset } from "../../lib/runtime/event-bus.js";

beforeEach(() => _reset());

describe("publish/subscribe: basic round trip", () => {
  it("a subscriber to an exact event name receives it, with name/payload/ts", () => {
    const received = [];
    subscribe("prediction.created", (e) => received.push(e));
    publish("prediction.created", { id: "p1" });
    assert.equal(received.length, 1);
    assert.equal(received[0].name, "prediction.created");
    assert.deepEqual(received[0].payload, { id: "p1" });
    assert.equal(typeof received[0].ts, "number");
  });

  it("a subscriber to a DIFFERENT event name receives nothing", () => {
    const received = [];
    subscribe("trade.executed", (e) => received.push(e));
    publish("prediction.created", { id: "p1" });
    assert.equal(received.length, 0);
  });

  it("wildcard '*' receives every event", () => {
    const received = [];
    subscribe("*", (e) => received.push(e.name));
    publish("prediction.created", {});
    publish("trade.executed", {});
    publish("literally.anything", {});
    assert.deepEqual(received, ["prediction.created", "trade.executed", "literally.anything"]);
  });

  it("unsubscribe stops further delivery", () => {
    const received = [];
    const unsub = subscribe("x.y", (e) => received.push(e));
    publish("x.y", { n: 1 });
    unsub();
    publish("x.y", { n: 2 });
    assert.equal(received.length, 1);
    assert.equal(received[0].payload.n, 1);
  });

  it("multiple subscribers to the same event all fire", () => {
    let a = 0, b = 0;
    subscribe("x.y", () => { a += 1; });
    subscribe("x.y", () => { b += 1; });
    publish("x.y", {});
    publish("x.y", {});
    assert.equal(a, 2);
    assert.equal(b, 2);
  });
});

describe("publish: isolation — a throwing subscriber never breaks the publisher or other subscribers", () => {
  it("publish does not throw even when a listener throws", () => {
    subscribe("x.y", () => { throw new Error("boom"); });
    assert.doesNotThrow(() => publish("x.y", {}));
  });

  it("a second, well-behaved subscriber still fires after an earlier one throws", () => {
    let ok = false;
    subscribe("x.y", () => { throw new Error("boom"); });
    subscribe("x.y", () => { ok = true; });
    publish("x.y", {});
    assert.equal(ok, true);
  });
});

describe("recentEvents: bounded ring, newest-first", () => {
  it("returns events in newest-first order", () => {
    publish("a.one", { n: 1 });
    publish("a.two", { n: 2 });
    publish("a.three", { n: 3 });
    const recent = recentEvents(10);
    assert.deepEqual(recent.map((e) => e.name), ["a.three", "a.two", "a.one"]);
  });

  it("respects the limit parameter", () => {
    publish("a.one", {});
    publish("a.two", {});
    publish("a.three", {});
    assert.equal(recentEvents(2).length, 2);
    assert.deepEqual(recentEvents(2).map((e) => e.name), ["a.three", "a.two"]);
  });

  it("is bounded — publishing well past the ring size still returns only the most recent entries", () => {
    for (let i = 0; i < 600; i++) publish("flood", { i });
    const recent = recentEvents(600);
    // RECENT_MAX is 500 — pinning the exact number would break if that
    // constant is ever retuned, so assert the CONTRACT (bounded, and the
    // newest entry is always present) rather than hardcoding 500 here.
    assert.ok(recent.length <= 500);
    assert.equal(recent[0].payload.i, 599);
  });
});
