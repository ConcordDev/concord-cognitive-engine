// Tier-2 contract tests for server/domains/sponsorship.js — the creator-
// membership parity macros: tiered membership, discovery, pause/change-tier,
// sponsor-only content gating, leaderboard, billing dashboard, thank-you DMs.
// Pins per-user scoping and the { ok } envelope on every macro.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSponsorshipActions from "../domains/sponsorship.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`sponsorship.${name}`);
  if (!fn) throw new Error(`sponsorship.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSponsorshipActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("sponsorship — discovery", () => {
  it("lists the seeded creator catalog", () => {
    const r = call("discover", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 6);
    assert.ok(r.result.creators[0].tiers.length === 3);
  });

  it("filters by query and by world", () => {
    const q = call("discover", ctxA, { query: "spell" });
    assert.ok(q.result.creators.every((c) => /spell/i.test(`${c.name} ${c.craft} ${c.blurb}`)));
    const w = call("discover", ctxA, { world: "cyber" });
    assert.ok(w.result.creators.every((c) => c.world === "cyber"));
  });
});

describe("sponsorship — tiers", () => {
  it("returns three tiers for a known creator", () => {
    const r = call("list_tiers", ctxA, { creatorId: "npc_arden" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tiers.length, 3);
    assert.ok(r.result.tiers[2].monthlyCc > r.result.tiers[0].monthlyCc);
  });

  it("rejects missing creatorId", () => {
    assert.equal(call("list_tiers", ctxA, {}).ok, false);
  });
});

describe("sponsorship — subscribe / list / cancel", () => {
  it("subscribes to a tier and lists it", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_arden" }).result.tiers;
    const r = call("subscribe", ctxA, { creatorId: "npc_arden", tierId: tiers[1].tierId });
    assert.equal(r.ok, true);
    assert.equal(r.result.sponsorship.tierName, "Silver");
    const list = call("list_for_user", ctxA);
    assert.equal(list.result.count, 1);
  });

  it("rejects a second subscription to the same creator", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_arden" }).result.tiers;
    call("subscribe", ctxA, { creatorId: "npc_arden", tierId: tiers[0].tierId });
    const r = call("subscribe", ctxA, { creatorId: "npc_arden", tierId: tiers[1].tierId });
    assert.equal(r.ok, false);
    assert.match(r.error, /already sponsoring/);
  });

  it("INVARIANT: sponsorships scoped per-user", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_arden" }).result.tiers;
    call("subscribe", ctxA, { creatorId: "npc_arden", tierId: tiers[0].tierId });
    assert.equal(call("list_for_user", ctxB).result.count, 0);
  });

  it("cancel flips status and removes it from the active list", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_arden" }).result.tiers;
    const sp = call("subscribe", ctxA, { creatorId: "npc_arden", tierId: tiers[0].tierId }).result.sponsorship;
    const c = call("cancel", ctxA, { sponsorshipId: sp.id });
    assert.equal(c.ok, true);
    assert.equal(call("list_for_user", ctxA).result.count, 0);
  });
});

describe("sponsorship — pause / resume / change_tier", () => {
  it("pause keeps the relationship, resume reactivates", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_vael" }).result.tiers;
    const sp = call("subscribe", ctxA, { creatorId: "npc_vael", tierId: tiers[0].tierId }).result.sponsorship;
    assert.equal(call("pause", ctxA, { sponsorshipId: sp.id }).result.sponsorship.status, "paused");
    assert.equal(call("resume", ctxA, { sponsorshipId: sp.id }).result.sponsorship.status, "active");
  });

  it("change_tier swaps tier without a new relationship", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_vael" }).result.tiers;
    const sp = call("subscribe", ctxA, { creatorId: "npc_vael", tierId: tiers[0].tierId }).result.sponsorship;
    const r = call("change_tier", ctxA, { sponsorshipId: sp.id, tierId: tiers[2].tierId });
    assert.equal(r.ok, true);
    assert.equal(r.result.sponsorship.tierName, "Gold");
    assert.equal(r.result.changedFrom, "Bronze");
    assert.equal(call("list_for_user", ctxA).result.count, 1);
  });
});

describe("sponsorship — sponsor-only content gating", () => {
  it("locks posts above the sponsor's tier", () => {
    call("publish_post", ctxA, { creatorId: "npc_juno", title: "Public note", minTier: "public" });
    call("publish_post", ctxA, { creatorId: "npc_juno", title: "Gold secret", body: "hidden", minTier: "gold" });
    const tiers = call("list_tiers", ctxB, { creatorId: "npc_juno" }).result.tiers;
    call("subscribe", ctxB, { creatorId: "npc_juno", tierId: tiers[0].tierId }); // bronze
    const feed = call("feed", ctxB, { creatorId: "npc_juno" }).result.posts;
    const gold = feed.find((p) => p.title === "Gold secret");
    const pub = feed.find((p) => p.title === "Public note");
    assert.equal(gold.locked, true);
    assert.equal(gold.body, null);
    assert.equal(pub.locked, false);
  });
});

describe("sponsorship — dispatch history", () => {
  it("returns dispatch posts published after the sponsorship started", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_torian" }).result.tiers;
    const sp = call("subscribe", ctxA, { creatorId: "npc_torian", tierId: tiers[0].tierId }).result.sponsorship;
    call("publish_post", ctxA, { creatorId: "npc_torian", title: "Blueprint dispatch", body: "x", kind: "dispatch" });
    const r = call("dispatch_history", ctxA, { sponsorshipId: sp.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
  });
});

describe("sponsorship — leaderboard", () => {
  it("ranks sponsors of a creator by contribution", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_seris" }).result.tiers;
    call("subscribe", ctxA, { creatorId: "npc_seris", tierId: tiers[2].tierId }); // gold
    call("subscribe", ctxB, { creatorId: "npc_seris", tierId: tiers[0].tierId }); // bronze
    const r = call("leaderboard", ctxA, { creatorId: "npc_seris" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.sponsors[0].rank, 1);
    assert.ok(r.result.sponsors[0].totalContributed >= r.result.sponsors[1].totalContributed);
    assert.ok(["bronze", "silver", "gold"].includes(r.result.sponsors[0].badge));
  });
});

describe("sponsorship — billing dashboard", () => {
  it("aggregates committed spend, upcoming charges and trend", () => {
    const tiers = call("list_tiers", ctxA, { creatorId: "npc_mira" }).result.tiers;
    call("subscribe", ctxA, { creatorId: "npc_mira", tierId: tiers[1].tierId });
    const r = call("billing", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.monthlyCommitted > 0);
    assert.equal(r.result.activeCount, 1);
    assert.equal(r.result.upcomingCharges.length, 1);
    assert.equal(r.result.trend.length, 6);
    assert.ok(r.result.paymentHistory.length >= 1);
  });
});

describe("sponsorship — thank-you messaging", () => {
  it("creator sends a thank-you to an active sponsor, who can read it", () => {
    const tiers = call("list_tiers", ctxB, { creatorId: "npc_arden" }).result.tiers;
    call("subscribe", ctxB, { creatorId: "npc_arden", tierId: tiers[2].tierId });
    const s = call("send_thanks", ctxA, { toUserId: "user_b", creatorId: "npc_arden", body: "Thank you!" });
    assert.equal(s.ok, true);
    const list = call("list_messages", ctxB);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.unread, 1);
    const mr = call("mark_message_read", ctxB, { messageId: list.result.messages[0].id });
    assert.equal(mr.ok, true);
    assert.equal(call("list_messages", ctxB).result.unread, 0);
  });

  it("rejects a thank-you to a non-sponsor", () => {
    const r = call("send_thanks", ctxA, { toUserId: "user_b", creatorId: "npc_arden", body: "hi" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not an active sponsor/);
  });
});
