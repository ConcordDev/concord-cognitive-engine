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

// ─── [M] Custom report builder — saved dashboards + widget layout ──────
describe("analytics.dashboard-save/list/get/delete", () => {
  it("saves a dashboard with widgets and lists it", () => {
    seedFunnel();
    const saved = call("dashboard-save", ctxA, {
      name: "Growth",
      widgets: [
        { kind: "metric", title: "Signups", config: { eventName: "signup", metric: "count" }, x: 0, y: 0, w: 4, h: 2 },
        { kind: "topEvents", title: "Top events", config: {}, x: 4, y: 0, w: 8, h: 4 },
      ],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.dashboard.widgets.length, 2);
    const list = call("dashboard-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.dashboards[0].widgetCount, 2);
  });
  it("dashboard-get computes live widget data", () => {
    seedFunnel();
    const saved = call("dashboard-save", ctxA, {
      name: "Live",
      widgets: [{ kind: "metric", title: "Signups", config: { eventName: "signup" } }],
    });
    const got = call("dashboard-get", ctxA, { id: saved.result.dashboard.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.dashboard.widgets[0].data.value, 3);
  });
  it("updates and deletes a dashboard", () => {
    const saved = call("dashboard-save", ctxA, { name: "Tmp", widgets: [] });
    const upd = call("dashboard-save", ctxA, { id: saved.result.dashboard.id, name: "Renamed", widgets: [] });
    assert.equal(upd.result.dashboard.name, "Renamed");
    call("dashboard-delete", ctxA, { id: saved.result.dashboard.id });
    assert.equal(call("dashboard-list", ctxA, {}).result.count, 0);
  });
  it("rejects an unnamed dashboard", () => {
    assert.equal(call("dashboard-save", ctxA, { widgets: [] }).ok, false);
  });
});

// ─── [M] User-path / flow analysis ────────────────────────────────────
describe("analytics.path-analysis", () => {
  it("builds a transition graph across user journeys", () => {
    seedFunnel();
    const p = call("path-analysis", ctxA, {});
    assert.equal(p.ok, true);
    // u1 (3 events) + u2 (2 events) qualify; u3 has a single event.
    assert.equal(p.result.journeys, 2);
    assert.ok(p.result.links.length > 0);
    assert.ok(p.result.nodes.some((n) => n.event === "signup" && n.depth === 0));
  });
  it("anchors a path to a given event", () => {
    seedFunnel();
    const p = call("path-analysis", ctxA, { anchorEvent: "activate" });
    assert.equal(p.result.anchorEvent, "activate");
    assert.equal(p.result.journeys, 1); // only u1 has 2+ events from activate
  });
  it("returns no-data when the log is empty", () => {
    const p = call("path-analysis", ctxB, {});
    assert.equal(p.result.journeys, 0);
  });
});

// ─── [S] Multi-dimensional property breakdown ─────────────────────────
describe("analytics.breakdown", () => {
  it("breaks an event down by one dimension", () => {
    seedFunnel();
    const b = call("breakdown", ctxA, { eventName: "activate", dimensions: ["plan"] });
    assert.equal(b.ok, true);
    assert.equal(b.result.total, 2);
    assert.equal(b.result.rows[0].dimensions[0], "pro");
    assert.equal(b.result.rows[0].count, 2);
  });
  it("supports the unique-users metric", () => {
    seedFunnel();
    const b = call("breakdown", ctxA, { eventName: "activate", dimensions: ["plan"], metric: "unique" });
    assert.equal(b.result.rows[0].value, 2);
  });
  it("rejects a breakdown with no dimensions", () => {
    assert.equal(call("breakdown", ctxA, { eventName: "activate" }).ok, false);
  });
});

// ─── [M] Live event stream / debugger view ────────────────────────────
describe("analytics.event-stream", () => {
  it("returns recent events newest-first with a cursor", () => {
    seedFunnel();
    const s = call("event-stream", ctxA, { limit: 10 });
    assert.equal(s.ok, true);
    assert.equal(s.result.returned, 6);
    assert.ok(s.result.cursor);
  });
  it("filters by name", () => {
    seedFunnel();
    const s = call("event-stream", ctxA, { name: "signup" });
    assert.equal(s.result.matched, 3);
  });
  it("filters incrementally by since cursor", () => {
    call("event-track", ctxA, { name: "a", distinctId: "u1", at: "2026-05-01T09:00:00.000Z" });
    call("event-track", ctxA, { name: "b", distinctId: "u1", at: "2026-05-02T09:00:00.000Z" });
    const s = call("event-stream", ctxA, { since: "2026-05-01T12:00:00.000Z" });
    assert.equal(s.result.matched, 1);
    assert.equal(s.result.events[0].name, "b");
  });
});

// ─── [S] Alerts on metric thresholds or anomalies ─────────────────────
describe("analytics.alert-save/list/evaluate/delete", () => {
  it("saves a threshold alert and evaluates firing state", () => {
    seedFunnel();
    const saved = call("alert-save", ctxA, {
      name: "Signups high", eventName: "signup", metric: "count", kind: "threshold", op: "gt", threshold: 2, window: 90,
    });
    assert.equal(saved.ok, true);
    const ev = call("alert-evaluate", ctxA, { id: saved.result.alert.id });
    assert.equal(ev.result.alert.value, 3);
    assert.equal(ev.result.alert.firing, true);
  });
  it("alert-list reports the firing count", () => {
    seedFunnel();
    call("alert-save", ctxA, { name: "Low bar", eventName: "purchase", metric: "count", kind: "threshold", op: "lt", threshold: 5, window: 90 });
    const list = call("alert-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.firing, 1);
  });
  it("rejects a threshold alert without a threshold", () => {
    assert.equal(call("alert-save", ctxA, { name: "x", kind: "threshold" }).ok, false);
  });
  it("deletes an alert", () => {
    const saved = call("alert-save", ctxA, { name: "x", kind: "threshold", threshold: 1 });
    call("alert-delete", ctxA, { id: saved.result.alert.id });
    assert.equal(call("alert-list", ctxA, {}).result.count, 0);
  });
});

// ─── [M] Behavioral cohort builder — did X but not Y ──────────────────
describe("analytics.cohort-build/save/list/delete", () => {
  it("computes users who did X but not Y", () => {
    seedFunnel();
    const c = call("cohort-build", ctxA, { includes: ["signup"], excludes: ["purchase"] });
    assert.equal(c.ok, true);
    assert.equal(c.result.size, 2); // u2, u3 signed up but did not purchase
    assert.equal(c.result.totalUsers, 3);
  });
  it("saves, lists with live result and deletes a cohort", () => {
    seedFunnel();
    const saved = call("cohort-save", ctxA, { name: "Non-buyers", includes: ["signup"], excludes: ["purchase"] });
    assert.equal(saved.ok, true);
    const list = call("cohort-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.cohorts[0].result.size, 2);
    call("cohort-delete", ctxA, { id: saved.result.cohort.id });
    assert.equal(call("cohort-list", ctxA, {}).result.count, 0);
  });
  it("rejects a cohort with no include or exclude", () => {
    assert.equal(call("cohort-build", ctxA, {}).ok, false);
  });
});

// ─── [S] Date-range comparison across reports ─────────────────────────
describe("analytics.range-compare", () => {
  it("compares an event metric between two windows", () => {
    const t = (d, h) => `2026-05-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
    call("event-track", ctxA, { name: "signup", distinctId: "u1", at: t(10, 9) });
    call("event-track", ctxA, { name: "signup", distinctId: "u2", at: t(10, 9) });
    call("event-track", ctxA, { name: "signup", distinctId: "u3", at: t(2, 9) });
    const r = call("range-compare", ctxA, {
      eventName: "signup",
      current: { from: "2026-05-08", to: "2026-05-14" },
      previous: { from: "2026-05-01", to: "2026-05-07" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.current.value, 2);
    assert.equal(r.result.previous.value, 1);
    assert.equal(r.result.delta, 1);
    assert.equal(r.result.direction, "up");
  });
  it("rejects a comparison missing a window bound", () => {
    assert.equal(call("range-compare", ctxA, { current: { from: "2026-05-01" } }).ok, false);
  });
});
