// Contract tests for the analytics lens — Mixpanel / Amplitude-shape
// event analytics substrate in server/domains/analytics.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnalyticsActions from "../domains/analytics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`analytics.${name}`);
  assert.ok(fn, `analytics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAnalyticsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Seed a small funnel: 3 users sign up, 2 activate, 1 purchases.
function seedFunnel(ctx = ctxA) {
  const t = (d, h) => `2026-05-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
  for (const u of ["u1", "u2", "u3"]) call("event-track", ctx, { name: "signup", distinctId: u, at: t(1, 9) });
  for (const u of ["u1", "u2"]) call("event-track", ctx, { name: "activate", distinctId: u, at: t(1, 10), properties: { plan: "pro" } });
  call("event-track", ctx, { name: "purchase", distinctId: "u1", at: t(1, 11), properties: { plan: "pro" } });
}

describe("analytics.event-track", () => {
  it("tracks events scoped per user", () => {
    call("event-track", ctxA, { name: "signup", distinctId: "u1" });
    assert.equal(call("event-stats", ctxA, {}).result.totalEvents, 1);
    assert.equal(call("event-stats", ctxB, {}).result.totalEvents, 0);
  });
  it("rejects an unnamed event", () => {
    assert.equal(call("event-track", ctxA, {}).ok, false);
  });
  it("event-stats counts unique users and top events", () => {
    seedFunnel();
    const st = call("event-stats", ctxA, {});
    assert.equal(st.result.uniqueUsers, 3);
    assert.equal(st.result.topEvents[0].name, "signup");
    assert.equal(st.result.topEvents[0].count, 3);
  });
});

describe("analytics.funnel", () => {
  it("computes conversion through ordered steps", () => {
    seedFunnel();
    const f = call("funnel-build", ctxA, { steps: ["signup", "activate", "purchase"] });
    assert.equal(f.ok, true);
    assert.equal(f.result.steps[0].count, 3);
    assert.equal(f.result.steps[1].count, 2);
    assert.equal(f.result.steps[2].count, 1);
    assert.equal(f.result.overallConversion, 33.3);
  });
  it("rejects a funnel with fewer than 2 steps", () => {
    assert.equal(call("funnel-build", ctxA, { steps: ["signup"] }).ok, false);
  });
  it("saves, lists (with live result) and deletes a funnel", () => {
    seedFunnel();
    const saved = call("funnel-save", ctxA, { name: "Activation", steps: ["signup", "activate"] });
    assert.equal(saved.ok, true);
    const list = call("funnel-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.funnels[0].result.steps[1].count, 2);
    call("funnel-delete", ctxA, { id: saved.result.funnel.id });
    assert.equal(call("funnel-list", ctxA, {}).result.count, 0);
  });
});

describe("analytics.segment + retention", () => {
  it("segments an event by a property", () => {
    seedFunnel();
    const seg = call("segment", ctxA, { eventName: "activate", propertyKey: "plan" });
    assert.equal(seg.result.total, 2);
    assert.equal(seg.result.segments[0].value, "pro");
    assert.equal(seg.result.segments[0].count, 2);
  });
  it("retention-report computes a day-0 cohort", () => {
    seedFunnel();
    const r = call("retention-report", ctxA, { cohortEvent: "signup", returnEvent: "activate" });
    assert.equal(r.result.cohortSize, 3);
    assert.equal(r.result.retention[0].retained, 2); // u1 + u2 activated same day
  });
});

describe("analytics.dashboard + legacy", () => {
  it("dashboard aggregates events and users", () => {
    seedFunnel();
    const d = call("analytics-dashboard", ctxA, {});
    assert.equal(d.result.totalEvents, 6);
    assert.equal(d.result.uniqueUsers, 3);
    assert.equal(d.result.eventTypes, 3);
  });
  it("legacy funnelAnalysis still responds", () => {
    assert.equal(call("funnelAnalysis", ctxA, {}).ok, true);
  });
});
