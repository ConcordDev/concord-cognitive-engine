// Contract tests for the parenting Huckleberry 2026-parity baby-care
// macros (children, feeds, sleep + SweetSpot, diapers, pumping, growth +
// WHO percentiles, CDC milestones, medicine, activities, dashboard).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerParentingActions from "../domains/parenting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`parenting.${name}`);
  assert.ok(fn, `parenting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerParentingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
// A birth date `months` months before today.
const birthMonthsAgo = (months) =>
  new Date(Date.now() - months * 30.4375 * 86400000).toISOString().slice(0, 10);

function newChild(ctx, months = 6, sex = "boy") {
  const r = call("child-add", ctx, { name: "Baby", birthDate: birthMonthsAgo(months), sex });
  assert.equal(r.ok, true);
  return r.result.child.id;
}

describe("parenting.child-*", () => {
  it("adds, lists with age, deletes; isolates per user", () => {
    const id = newChild(ctxA, 12);
    const list = call("child-list", ctxA, {});
    assert.equal(list.result.children.length, 1);
    assert.ok(list.result.children[0].ageMonths >= 11 && list.result.children[0].ageMonths <= 13);
    assert.equal(call("child-list", ctxB, {}).result.children.length, 0);
    assert.equal(call("child-delete", ctxA, { id }).result.deleted, id);
    assert.equal(call("child-list", ctxA, {}).result.children.length, 0);
  });

  it("rejects a bad birth date", () => {
    assert.equal(call("child-add", ctxA, { name: "X", birthDate: "not-a-date" }).ok, false);
  });
});

describe("parenting.feed-*", () => {
  it("logs feeds and aggregates today's stats", () => {
    const id = newChild(ctxA);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 120 });
    call("feed-log", ctxA, { childId: id, kind: "nursing", side: "left", durationMin: 15 });
    const stats = call("feed-stats", ctxA, { childId: id });
    assert.equal(stats.result.feedsToday, 2);
    assert.equal(stats.result.bottleMlToday, 120);
    assert.equal(stats.result.nursingMinToday, 15);
    assert.equal(call("feed-history", ctxA, { childId: id }).result.count, 2);
  });

  it("rejects a feed for an unknown child", () => {
    assert.equal(call("feed-log", ctxA, { childId: "nope", kind: "bottle" }).ok, false);
  });
});

describe("parenting.sleep-* and sweet-spot", () => {
  it("logs sleep and computes today's totals", () => {
    const id = newChild(ctxA);
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 60 });
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 45 });
    const stats = call("sleep-stats", ctxA, { childId: id });
    assert.equal(stats.result.sleepMinToday, 105);
    assert.equal(stats.result.napsToday, 2);
    assert.equal(stats.result.longestStretchMin, 60);
  });

  it("sweet-spot predicts a nap window from last wake + age wake window", () => {
    const id = newChild(ctxA, 6);
    const start = new Date(Date.now() - 90 * 60000).toISOString();
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 30, startAt: start });
    const r = call("sweet-spot", ctxA, { childId: id });
    assert.ok(r.result.predictedNap);
    assert.ok(r.result.wakeWindow.typical > 0);
    assert.ok(Date.parse(r.result.predictedNap.ideal) > Date.parse(r.result.predictedNap.earliest));
    assert.ok(Date.parse(r.result.predictedNap.latest) > Date.parse(r.result.predictedNap.ideal));
  });

  it("sweet-spot flags dropped naps for children over 3", () => {
    const id = newChild(ctxA, 42);
    const r = call("sweet-spot", ctxA, { childId: id });
    assert.equal(r.result.napsLikelyDropped, true);
  });
});

describe("parenting.diaper-* and pump-*", () => {
  it("logs diapers and counts today by kind", () => {
    const id = newChild(ctxA);
    call("diaper-log", ctxA, { childId: id, kind: "wet" });
    call("diaper-log", ctxA, { childId: id, kind: "dirty" });
    const r = call("diaper-history", ctxA, { childId: id });
    assert.equal(r.result.todayCount, 2);
    assert.equal(r.result.byKindToday.wet, 1);
  });

  it("logs pumping and sums today's ml", () => {
    call("pump-log", ctxA, { amountMl: 90, side: "left", durationMin: 20 });
    call("pump-log", ctxA, { amountMl: 60, side: "right", durationMin: 15 });
    assert.equal(call("pump-history", ctxA, {}).result.mlToday, 150);
  });
});

describe("parenting.growth-*", () => {
  it("logs growth and estimates WHO percentiles", () => {
    const id = newChild(ctxA, 12, "boy");
    call("growth-log", ctxA, { childId: id, weightKg: 9.6, heightCm: 75.7 });
    const r = call("growth-percentile", ctxA, { childId: id });
    // 12-month boy at the WHO median should land near the 50th percentile.
    assert.ok(r.result.weight.percentile >= 40 && r.result.weight.percentile <= 60);
    assert.ok(r.result.height.percentile >= 40 && r.result.height.percentile <= 60);
  });

  it("rejects an empty growth measurement", () => {
    const id = newChild(ctxA);
    assert.equal(call("growth-log", ctxA, { childId: id }).ok, false);
  });

  it("percentile errors when no measurement exists", () => {
    const id = newChild(ctxA);
    assert.equal(call("growth-percentile", ctxA, { childId: id }).ok, false);
  });
});

describe("parenting.milestone-*", () => {
  it("returns an age-appropriate CDC checklist and records progress", () => {
    const id = newChild(ctxA, 12);
    const list = call("milestone-checklist", ctxA, { childId: id });
    assert.equal(list.result.checkpoint, 12);
    assert.ok(list.result.items.length >= 4);
    const first = list.result.items[0];
    call("milestone-record", ctxA, { childId: id, milestoneId: first.id, achieved: true });
    const after = call("milestone-checklist", ctxA, { childId: id });
    assert.equal(after.result.achievedCount, 1);
  });

  it("milestone-progress aggregates by category", () => {
    const id = newChild(ctxA, 24);
    const prog = call("milestone-progress", ctxA, { childId: id });
    assert.ok(prog.result.eligibleCount > 0);
    assert.ok(prog.result.byCategory.movement.total > 0);
  });

  it("rejects an unknown milestone id", () => {
    const id = newChild(ctxA);
    assert.equal(call("milestone-record", ctxA, { childId: id, milestoneId: "zzz" }).ok, false);
  });
});

describe("parenting.medicine / activity / timeline / dashboard", () => {
  it("logs medicine and activities", () => {
    const id = newChild(ctxA);
    call("medicine-log", ctxA, { childId: id, name: "Vitamin D", dose: "400 IU" });
    call("activity-log", ctxA, { childId: id, kind: "tummy_time", durationMin: 10 });
    assert.equal(call("medicine-history", ctxA, { childId: id }).result.count, 1);
    assert.equal(call("activity-history", ctxA, { childId: id }).result.count, 1);
  });

  it("day-timeline merges all event types for a date", () => {
    const id = newChild(ctxA);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 100 });
    call("diaper-log", ctxA, { childId: id, kind: "wet" });
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 30 });
    const r = call("day-timeline", ctxA, { childId: id });
    assert.equal(r.result.count, 3);
  });

  it("dashboard reports the first child's day at a glance", () => {
    const id = newChild(ctxA);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 100 });
    const r = call("parenting-dashboard", ctxA, {});
    assert.equal(r.result.hasChild, true);
    assert.equal(r.result.feedsToday, 1);
    assert.equal(r.result.lastFeed.kind, "bottle");
  });

  it("dashboard reports no child gracefully", () => {
    const r = call("parenting-dashboard", ctxB, {});
    assert.equal(r.result.hasChild, false);
  });
});
