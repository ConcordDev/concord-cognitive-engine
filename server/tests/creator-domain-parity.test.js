// Contract tests for the creator YouTube Studio + Buffer + Patreon
// 2026-parity creator studio (platforms, content pipeline, audience,
// revenue, calendar, goals).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCreatorActions from "../domains/creator.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`creator.${name}`);
  assert.ok(fn, `creator.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCreatorActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);

describe("creator.platform-*", () => {
  it("adds, lists and deletes platforms", () => {
    const p = call("platform-add", ctxA, { name: "YouTube", handle: "@me" }).result.platform;
    assert.equal(call("platform-list", ctxA, {}).result.count, 1);
    call("platform-delete", ctxA, { id: p.id });
    assert.equal(call("platform-list", ctxA, {}).result.count, 0);
  });

  it("isolates platforms per user", () => {
    call("platform-add", ctxA, { name: "X" });
    assert.equal(call("platform-list", ctxB, {}).result.count, 0);
  });

  it("rejects an unnamed platform", () => {
    assert.equal(call("platform-add", ctxA, { name: "" }).ok, false);
  });
});

describe("creator content pipeline", () => {
  it("adds content, advances it through stages and counts by stage", () => {
    const c = call("content-add", ctxA, { title: "Episode 1", format: "video" }).result.item;
    assert.equal(c.stage, "idea");
    call("content-advance", ctxA, { id: c.id });
    call("content-advance", ctxA, { id: c.id });
    const list = call("content-list", ctxA, {});
    assert.equal(list.result.byStage.in_production, 1);
  });

  it("stamps publishedAt when content reaches published", () => {
    const c = call("content-add", ctxA, { title: "Short", format: "short" }).result.item;
    call("content-update", ctxA, { id: c.id, stage: "published" });
    const item = call("content-list", ctxA, {}).result.items[0];
    assert.ok(item.publishedAt);
  });

  it("filters content by stage and deletes", () => {
    const c1 = call("content-add", ctxA, { title: "A" }).result.item;
    call("content-add", ctxA, { title: "B" });
    call("content-advance", ctxA, { id: c1.id });
    assert.equal(call("content-list", ctxA, { stage: "scripted" }).result.count, 1);
    call("content-delete", ctxA, { id: c1.id });
    assert.equal(call("content-list", ctxA, {}).result.count, 1);
  });
});

describe("creator audience tracking", () => {
  it("logs follower snapshots and summarises growth", () => {
    const p = call("platform-add", ctxA, { name: "YouTube" }).result.platform;
    call("audience-log", ctxA, { platformId: p.id, followers: 1000, date: "2026-01-01" });
    call("audience-log", ctxA, { platformId: p.id, followers: 1500, date: "2026-05-01" });
    const summary = call("audience-summary", ctxA, {});
    assert.equal(summary.result.totalFollowers, 1500);
    assert.equal(summary.result.totalGrowth, 500);
    assert.equal(call("audience-history", ctxA, { platformId: p.id }).result.count, 2);
  });

  it("rejects an audience log for an unknown platform", () => {
    assert.equal(call("audience-log", ctxA, { platformId: "nope", followers: 10 }).ok, false);
  });
});

describe("creator revenue", () => {
  it("adds revenue and summarises by source", () => {
    call("revenue-add", ctxA, { source: "sponsorship", amount: 500, date: today() });
    call("revenue-add", ctxA, { source: "ad_revenue", amount: 120.5, date: today() });
    const sum = call("revenue-summary", ctxA, {});
    assert.equal(sum.result.total, 620.5);
    assert.equal(sum.result.bySource.sponsorship, 500);
    assert.equal(call("revenue-list", ctxA, {}).result.count, 2);
  });

  it("rejects non-positive revenue", () => {
    assert.equal(call("revenue-add", ctxA, { source: "tips", amount: 0 }).ok, false);
  });
});

describe("creator calendar & goals", () => {
  it("content-calendar buckets scheduled content by day", () => {
    call("content-add", ctxA, { title: "Planned", scheduledDate: "2026-06-12" });
    const cal = call("content-calendar", ctxA, { year: 2026, month: 6 });
    assert.equal(cal.result.days["12"].length, 1);
  });

  it("tracks a followers goal against logged audience", () => {
    const p = call("platform-add", ctxA, { name: "YT" }).result.platform;
    call("audience-log", ctxA, { platformId: p.id, followers: 800 });
    call("creator-goal-set", ctxA, { metric: "followers", target: 1000 });
    const status = call("creator-goal-status", ctxA, {});
    assert.equal(status.result.current, 800);
    assert.equal(status.result.target, 1000);
    assert.equal(status.result.met, false);
  });

  it("reports no goal cleanly", () => {
    assert.equal(call("creator-goal-status", ctxA, {}).result.hasGoal, false);
  });

  it("dashboard rolls up the studio", () => {
    const p = call("platform-add", ctxA, { name: "YT" }).result.platform;
    call("audience-log", ctxA, { platformId: p.id, followers: 2000 });
    call("content-add", ctxA, { title: "Idea one" });
    call("revenue-add", ctxA, { source: "tips", amount: 40, date: today() });
    const d = call("creator-dashboard", ctxA, {});
    assert.equal(d.result.totalFollowers, 2000);
    assert.equal(d.result.ideas, 1);
    assert.equal(d.result.revenueThisMonth, 40);
  });
});
