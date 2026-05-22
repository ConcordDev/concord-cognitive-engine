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

// ── Parity backlog — YouTube Studio + Patreon feature gaps ──────────

describe("creator [M] revenue-timeseries", () => {
  it("buckets logged revenue into month series with a grand total", () => {
    call("revenue-add", ctxA, { source: "sponsorship", amount: 300, date: today() });
    call("revenue-add", ctxA, { source: "tips", amount: 50, date: today() });
    const r = call("revenue-timeseries", ctxA, { bucket: "month", days: 365 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bucket, "month");
    assert.equal(r.result.grandTotal, 350);
    assert.ok(r.result.series.length >= 1);
    assert.equal(r.result.series[0].bySource.sponsorship, 300);
  });

  it("returns an empty series when no revenue is logged", () => {
    const r = call("revenue-timeseries", ctxB, { bucket: "day" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.grandTotal, 0);
  });
});

describe("creator [M] content performance", () => {
  it("content-track moves a real performance counter", () => {
    const c = call("content-add", ctxA, { title: "Tracked" }).result.item;
    const r = call("content-track", ctxA, { id: c.id, metric: "views", delta: 1200 });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 1200);
  });

  it("content-track rejects an unknown metric", () => {
    const c = call("content-add", ctxA, { title: "T2" }).result.item;
    assert.equal(call("content-track", ctxA, { id: c.id, metric: "bogus", delta: 1 }).ok, false);
  });

  it("content-performance returns derived per-artifact rates", () => {
    const c = call("content-add", ctxA, { title: "Perf" }).result.item;
    call("content-track", ctxA, { id: c.id, metric: "views", delta: 1000 });
    call("content-track", ctxA, { id: c.id, metric: "clicks", delta: 100 });
    call("content-track", ctxA, { id: c.id, metric: "conversions", delta: 25 });
    const r = call("content-performance", ctxA, {});
    assert.equal(r.ok, true);
    const row = r.result.rows.find((x) => x.id === c.id);
    assert.equal(row.clickRate, 10);
    assert.equal(row.conversionRate, 2.5);
    assert.equal(r.result.totals.views, 1000);
  });
});

describe("creator [M] audience demographics", () => {
  it("logs a segment and rolls it up with share %", () => {
    call("audience-demographic-log", ctxA, { segment: "geography", label: "United States", count: 600 });
    call("audience-demographic-log", ctxA, { segment: "geography", label: "Canada", count: 400 });
    const r = call("audience-demographics", ctxA, { segment: "geography" });
    assert.equal(r.ok, true);
    assert.equal(r.result.segments.geography.total, 1000);
    assert.equal(r.result.segments.geography.breakdown[0].share, 60);
  });

  it("rejects an unknown segment", () => {
    assert.equal(call("audience-demographic-log", ctxA, { segment: "x", label: "y", count: 1 }).ok, false);
  });
});

describe("creator [M] membership tiers & subscriptions", () => {
  it("adds a tier, records a supporter and computes MRR", () => {
    const tier = call("membership-tier-add", ctxA, { name: "Gold", priceMonthly: 10, perks: ["badge"] }).result.tier;
    call("subscription-add", ctxA, { tierId: tier.id, supporter: "fan1" });
    const list = call("membership-tier-list", ctxA, {});
    assert.equal(list.result.tiers[0].activeSubscribers, 1);
    const sum = call("membership-summary", ctxA, {});
    assert.equal(sum.result.mrr, 10);
    assert.equal(sum.result.arr, 120);
  });

  it("cancels a subscription and blocks deleting a tier with active subs", () => {
    const tier = call("membership-tier-add", ctxA, { name: "Silver", priceMonthly: 5 }).result.tier;
    const sub = call("subscription-add", ctxA, { tierId: tier.id, supporter: "fan2" }).result.subscription;
    assert.equal(call("membership-tier-delete", ctxA, { id: tier.id }).ok, false);
    call("subscription-cancel", ctxA, { id: sub.id });
    assert.equal(call("membership-tier-delete", ctxA, { id: tier.id }).ok, true);
  });

  it("rejects a tier with a non-positive price", () => {
    assert.equal(call("membership-tier-add", ctxA, { name: "Free", priceMonthly: 0 }).ok, false);
  });
});

describe("creator [S] payout history ledger", () => {
  it("records a payout and totals it by status", () => {
    call("payout-record", ctxA, { amount: 250, method: "bank", status: "completed" });
    call("payout-record", ctxA, { amount: 100, method: "stripe", status: "pending" });
    const r = call("payout-history", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.completed, 250);
    assert.equal(r.result.totals.pending, 100);
  });

  it("updates a payout status to completed and stamps completedAt", () => {
    const p = call("payout-record", ctxA, { amount: 80, status: "pending" }).result.payout;
    const r = call("payout-update-status", ctxA, { id: p.id, status: "completed" });
    assert.equal(r.ok, true);
    assert.ok(r.result.payout.completedAt);
  });

  it("rejects a non-positive payout", () => {
    assert.equal(call("payout-record", ctxA, { amount: 0 }).ok, false);
  });
});

describe("creator [S] scheduled publishing", () => {
  it("queues a release and lists it as scheduled", () => {
    const releaseAt = new Date(Date.now() + 86400000).toISOString();
    call("publish-queue-add", ctxA, { title: "Future post", format: "post", releaseAt });
    const r = call("publish-queue-list", ctxA, { status: "scheduled" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.queue[0].overdue, false);
  });

  it("publishes due items via publish-queue-run-due", () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    call("publish-queue-add", ctxA, { title: "Overdue", releaseAt: past });
    const r = call("publish-queue-run-due", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
  });

  it("cancels a scheduled item and rejects a bad timestamp", () => {
    const releaseAt = new Date(Date.now() + 86400000).toISOString();
    const q = call("publish-queue-add", ctxA, { title: "Cancelme", releaseAt }).result.queued;
    assert.equal(call("publish-queue-cancel", ctxA, { id: q.id }).ok, true);
    assert.equal(call("publish-queue-add", ctxA, { title: "Bad", releaseAt: "not-a-date" }).ok, false);
  });
});

describe("creator [S] comment / community management", () => {
  it("adds a comment and counts it by status", () => {
    call("comment-add", ctxA, { author: "viewer1", body: "great video" });
    const r = call("comment-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.byStatus.open, 1);
  });

  it("replies to a comment, moving it to replied", () => {
    const c = call("comment-add", ctxA, { author: "viewer2", body: "question?" }).result.comment;
    const r = call("comment-update", ctxA, { id: c.id, reply: "here is the answer" });
    assert.equal(r.ok, true);
    assert.equal(r.result.comment.status, "replied");
  });

  it("pins, resolves and deletes a comment", () => {
    const c = call("comment-add", ctxA, { author: "viewer3", body: "pin this" }).result.comment;
    assert.equal(call("comment-update", ctxA, { id: c.id, pinned: true }).result.comment.pinned, true);
    assert.equal(call("comment-update", ctxA, { id: c.id, status: "resolved" }).result.comment.status, "resolved");
    assert.equal(call("comment-delete", ctxA, { id: c.id }).ok, true);
    assert.equal(call("comment-list", ctxA, {}).result.count, 0);
  });

  it("rejects a comment with no body", () => {
    assert.equal(call("comment-add", ctxA, { author: "x", body: "" }).ok, false);
  });
});
