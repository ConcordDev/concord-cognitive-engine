// tests/depth/creator-behavior.test.js
//
// Q63 tranche 2 (GH #850) — REAL behavioral tests for the creator
// lens-action macros the macro-depth grader carried as important but
// untested (frontend-used, implemented, no behavioral invocation):
// platform/audience tracking, content tracking + calendar, comments,
// membership tiers + subscriptions, revenue, the publish queue,
// payouts, and creator goals. Each test drives the domain's own
// actions through the depth harness and asserts on returned state.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("creator — platforms and audience", () => {
  let ctx;
  let platformId;
  before(async () => { ctx = await depthCtx("q63-creator-audience"); });

  it("platform-add requires a name; audience-log accrues followers read back by audience-summary", async () => {
    const bad = await lensRun("creator", "platform-add", { params: {} }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "platform name required");
    const plat = await lensRun("creator", "platform-add", { params: { name: "YouTube" } }, ctx);
    assert.equal(plat.ok, true);
    platformId = plat.result.platform.id;
    const log = await lensRun("creator", "audience-log", { params: { platformId, followers: 1200 } }, ctx);
    assert.equal(log.ok, true);
    const summary = await lensRun("creator", "audience-summary", {}, ctx);
    assert.equal(summary.result.totalFollowers, 1200);
    assert.equal(summary.result.platforms[0].name, "YouTube");
  });

  it("audience-demographic-log validates the segment, then records the entry", async () => {
    const bad = await lensRun("creator", "audience-demographic-log", { params: { segment: "zodiac", label: "Aries", count: 3 } }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /segment must be one of/);
    const entry = await lensRun("creator", "audience-demographic-log", { params: { segment: "geography", label: "United States", count: 600 } }, ctx);
    assert.equal(entry.ok, true);
    assert.equal(entry.result.entry.segment, "geography");
    assert.equal(entry.result.entry.count, 600);
  });

  it("audience-log against a missing platform is refused; platform-delete removes the platform", async () => {
    const ghost = await lensRun("creator", "audience-log", { params: { platformId: "nope", followers: 5 } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "platform not found");
    const del = await lensRun("creator", "platform-delete", { params: { id: platformId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, platformId);
  });
});

describe("creator — content, calendar, comments", () => {
  let ctx;
  let contentId;
  before(async () => { ctx = await depthCtx("q63-creator-content"); });

  it("content-add requires a title; the item is trackable and lands on the calendar", async () => {
    const bad = await lensRun("creator", "content-add", { params: {} }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "content title required");
    const today = new Date().toISOString().slice(0, 10);
    const added = await lensRun("creator", "content-add", { params: { title: "Launch Video", platform: "YouTube", scheduledDate: today } }, ctx);
    assert.equal(added.ok, true);
    contentId = added.result.item.id;
    const noMetric = await lensRun("creator", "content-track", { params: { id: contentId } }, ctx);
    assert.equal(noMetric.ok, false);
    assert.match(noMetric.error, /metric must be/);
    const tracked = await lensRun("creator", "content-track", { params: { id: contentId, metric: "views", delta: 150 } }, ctx);
    assert.equal(tracked.ok, true);
    assert.equal(tracked.result.value, 150);
    const cal = await lensRun("creator", "content-calendar", { params: {} }, ctx);
    assert.equal(cal.ok, true);
    assert.ok(JSON.stringify(cal.result.days).includes("Launch Video"), "scheduled content appears on the calendar");
  });

  it("comment-add + comment-delete round-trip on the content", async () => {
    const comment = await lensRun("creator", "comment-add", { params: { contentId, author: "fan1", body: "Great video" } }, ctx);
    assert.equal(comment.ok, true);
    const del = await lensRun("creator", "comment-delete", { params: { id: comment.result.comment.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("creator", "comment-delete", { params: { id: comment.result.comment.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "comment not found");
  });

  it("content-delete removes it; content-track then reports not found", async () => {
    const del = await lensRun("creator", "content-delete", { params: { id: contentId } }, ctx);
    assert.equal(del.ok, true);
    const tracked = await lensRun("creator", "content-track", { params: { id: contentId, metric: "views", delta: 1 } }, ctx);
    assert.equal(tracked.ok, false);
    assert.equal(tracked.error, "content not found");
  });
});

describe("creator — membership, revenue, queue, payouts, goals", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q63-creator-money"); });

  it("membership tiers + subscriptions drive membership-summary MRR", async () => {
    const bad = await lensRun("creator", "membership-tier-add", { params: { name: "Supporter" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "priceMonthly must be positive");
    const tier = await lensRun("creator", "membership-tier-add", { params: { name: "Supporter", priceMonthly: 5 } }, ctx);
    assert.equal(tier.ok, true);
    const tierId = tier.result.tier.id;
    const tiers = await lensRun("creator", "membership-tier-list", {}, ctx);
    assert.equal(tiers.result.count, 1);
    const sub = await lensRun("creator", "subscription-add", { params: { tierId, supporter: "@fan1" } }, ctx);
    assert.equal(sub.ok, true);
    const subs = await lensRun("creator", "subscription-list", {}, ctx);
    assert.equal(subs.result.count, 1);
    const summary = await lensRun("creator", "membership-summary", {}, ctx);
    assert.equal(summary.result.tierCount, 1);
    assert.equal(summary.result.activeSubscribers, 1);
    assert.equal(summary.result.mrr, 5);
    const cancel = await lensRun("creator", "subscription-cancel", { params: { id: sub.result.subscription.id } }, ctx);
    assert.equal(cancel.ok, true);
    const after = await lensRun("creator", "membership-summary", {}, ctx);
    assert.equal(after.result.activeSubscribers, 0);
    const delTier = await lensRun("creator", "membership-tier-delete", { params: { id: tierId } }, ctx);
    assert.equal(delTier.ok, true);
  });

  it("revenue-add rejects non-positive amounts; revenue-summary totals by source", async () => {
    const bad = await lensRun("creator", "revenue-add", { params: { amount: 0 } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "amount must be positive");
    await lensRun("creator", "revenue-add", { params: { amount: 250, source: "sponsorship" } }, ctx);
    await lensRun("creator", "revenue-add", { params: { amount: 50, source: "tips" } }, ctx);
    const list = await lensRun("creator", "revenue-list", {}, ctx);
    assert.equal(list.result.count, 2);
    const summary = await lensRun("creator", "revenue-summary", {}, ctx);
    assert.equal(summary.result.total, 300);
    assert.equal(summary.result.bySource.sponsorship, 250);
    assert.equal(summary.result.bySource.tips, 50);
  });

  it("publish-queue-add requires a valid releaseAt; cancel removes the item", async () => {
    const bad = await lensRun("creator", "publish-queue-add", { params: { title: "Launch Video" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "releaseAt must be a valid ISO timestamp");
    const releaseAt = new Date(Date.now() + 86400000).toISOString();
    const queued = await lensRun("creator", "publish-queue-add", { params: { title: "Launch Video", releaseAt } }, ctx);
    assert.equal(queued.ok, true);
    const list = await lensRun("creator", "publish-queue-list", {}, ctx);
    assert.equal(list.result.count, 1);
    const itemId = queued.result.queued.id;
    const cancel = await lensRun("creator", "publish-queue-cancel", { params: { id: itemId } }, ctx);
    assert.equal(cancel.ok, true);
    // Cancel is a status, not a deletion: the scheduled view empties,
    // the full list keeps the item marked cancelled.
    const scheduled = await lensRun("creator", "publish-queue-list", { params: { status: "scheduled" } }, ctx);
    assert.equal(scheduled.result.count, 0);
    const all = await lensRun("creator", "publish-queue-list", {}, ctx);
    assert.equal(all.result.count, 1);
    assert.equal(all.result.queue[0].status, "cancelled");
  });

  it("payout-record -> payout-update-status completes the payout with a timestamp", async () => {
    const payout = await lensRun("creator", "payout-record", { params: { amount: 400 } }, ctx);
    assert.equal(payout.ok, true);
    assert.equal(payout.result.payout.status, "pending");
    const upd = await lensRun("creator", "payout-update-status", { params: { id: payout.result.payout.id, status: "completed" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.payout.status, "completed");
    assert.ok(upd.result.payout.completedAt, "completed payout carries completedAt");
    const missing = await lensRun("creator", "payout-update-status", { params: { id: "nope", status: "completed" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "payout not found");
  });

  it("creator-goal-set stores the target it is given", async () => {
    const goal = await lensRun("creator", "creator-goal-set", { params: { metric: "followers", target: 5000 } }, ctx);
    assert.equal(goal.ok, true);
    assert.equal(goal.result.metric, "followers");
    assert.equal(goal.result.target, 5000);
  });
});
