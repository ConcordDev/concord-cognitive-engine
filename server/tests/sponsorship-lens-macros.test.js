// Behavioral macro tests for server/domains/sponsorship.js — the Patreon-shaped
// creator-membership substrate the /lenses/sponsorship lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention.
// Our harness therefore calls `fn(ctx, virtualArtifact, input)`, NOT (ctx,input),
// so a regression that confuses the param positions surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL values + the
// money-path accounting: subscribe charges the real tier CC and stamps
// totalContributed; the billing dashboard sums the real charge history with no
// CC minted; tier-gating unlocks content at the right rank; per-user isolation
// holds; cancel/pause/resume keep the relationship. A poisoned-numeric case
// pins that the lens money path takes NO user-supplied amount (it is
// fail-CLOSED by construction — all CC comes from the seeded catalog/tiers, so
// an injected 1e308/Infinity can never reach the contribution totals).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSponsorshipActions from "../domains/sponsorship.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "sponsorship", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`sponsorship.${name} not registered`);
  const virtualArtifact = { id: null, domain: "sponsorship", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerSponsorshipActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const CREATOR = "npc_vael"; // baseMonthly 8 → bronze 8, silver 16, gold 32

describe("sponsorship — registration (every lens-driven macro present)", () => {
  it("registers all 18 macros the lens calls via lensRun", () => {
    for (const m of [
      "discover", "list_tiers", "subscribe", "list_for_user",
      "pause", "resume", "change_tier", "cancel",
      "publish_post", "feed", "dispatch_history", "leaderboard",
      "billing", "send_thanks", "list_messages", "mark_message_read",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing sponsorship.${m}`);
    }
  });
});

describe("sponsorship — discovery + tiers", () => {
  it("discover returns the seeded catalog with tiers + worlds", () => {
    const r = call("discover", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 6, "at least 6 seeded creators");
    assert.ok(Array.isArray(r.result.worlds) && r.result.worlds.length >= 2);
    const vael = r.result.creators.find((c) => c.creatorId === CREATOR);
    assert.ok(vael, "Vael present");
    assert.equal(vael.lowestTierCc, 8, "bronze == baseMonthly");
    assert.equal(vael.tiers.length, 3);
    assert.equal(vael.sponsorCount, 0, "no sponsors yet");
  });

  it("discover filters by query and by world", () => {
    const q = call("discover", ctxA, { query: "glyph" });
    assert.equal(q.ok, true);
    assert.equal(q.result.creators.length, 1);
    assert.equal(q.result.creators[0].creatorId, CREATOR);

    const w = call("discover", ctxA, { world: "concordia-hub" });
    assert.equal(w.ok, true);
    assert.ok(w.result.creators.every((c) => c.world === "concordia-hub"));
    assert.ok(w.result.creators.length >= 2);
  });

  it("list_tiers gives the 1×/2×/4× CC ladder", () => {
    const r = call("list_tiers", ctxA, { creatorId: CREATOR });
    assert.equal(r.ok, true);
    const cc = r.result.tiers.map((t) => t.monthlyCc);
    assert.deepEqual(cc, [8, 16, 32]);
    assert.equal(r.result.creator.name, "Vael Stormcaller");
  });

  it("list_tiers rejects a missing creatorId", () => {
    assert.equal(call("list_tiers", ctxA, {}).error, "creatorId required");
  });
});

describe("sponsorship — subscribe → list → billing (money path, no CC minted)", () => {
  it("subscribe charges the exact tier CC and stamps totalContributed", () => {
    const r = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_silver` });
    assert.equal(r.ok, true);
    const sp = r.result.sponsorship;
    assert.equal(sp.creatorId, CREATOR);
    assert.equal(sp.tierName, "Silver");
    assert.equal(sp.monthlyCc, 16, "silver == base*2");
    assert.equal(sp.status, "active");
    // The first charge equals the tier price exactly — nothing minted, nothing lost.
    assert.equal(sp.totalContributed, 16);

    // list_for_user shows exactly the one active sponsorship.
    const l = call("list_for_user", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.sponsorships[0].id, sp.id);
  });

  it("double-subscribe to the same creator is rejected (use change_tier)", () => {
    call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_bronze` });
    const again = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_gold` });
    assert.equal(again.ok, false);
    assert.match(again.error, /already sponsoring/);
  });

  it("subscribe rejects an unknown tier / missing fields", () => {
    assert.equal(call("subscribe", ctxA, { creatorId: CREATOR, tierId: "nope" }).error, "tier not found");
    assert.equal(call("subscribe", ctxA, {}).error, "creatorId and tierId required");
  });

  it("billing sums the real charge history with conservation (sum == per-charge sum)", () => {
    // user_a sponsors two creators at known prices.
    call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_silver` });   // 16
    call("subscribe", ctxA, { creatorId: "npc_seris", tierId: "npc_seris_bronze" }); // 10

    const b = call("billing", ctxA, {});
    assert.equal(b.ok, true);
    assert.equal(b.result.activeCount, 2);
    assert.equal(b.result.pausedCount, 0);
    // monthlyCommitted == sum of the two tier prices, exactly.
    assert.equal(b.result.monthlyCommitted, 26);
    // totalContributed == sum of the recorded charge rows, exactly (no mint).
    const chargeSum = b.result.paymentHistory
      .filter((h) => h.kind === "charge")
      .reduce((s, h) => s + h.amountCc, 0);
    assert.equal(b.result.totalContributed, chargeSum);
    assert.equal(b.result.totalContributed, 26);
    // Two upcoming charges, sorted by due date.
    assert.equal(b.result.upcomingCharges.length, 2);
    assert.equal(b.result.trend.length, 6);
  });
});

describe("sponsorship — change_tier / pause / resume / cancel lifecycle", () => {
  it("change_tier reprices the live commitment and logs the change at 0 CC", () => {
    const s = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_bronze` });
    const id = s.result.sponsorship.id;

    const c = call("change_tier", ctxA, { sponsorshipId: id, tierId: `${CREATOR}_gold` });
    assert.equal(c.ok, true);
    assert.equal(c.result.changedFrom, "Bronze");
    assert.equal(c.result.sponsorship.tierName, "Gold");
    assert.equal(c.result.sponsorship.monthlyCc, 32);

    // A tier_change is a 0-CC ledger row (no charge on swap).
    const b = call("billing", ctxA, {});
    const change = b.result.paymentHistory.find((h) => h.kind === "tier_change");
    assert.ok(change);
    assert.equal(change.amountCc, 0);
    // monthlyCommitted now reflects the gold price.
    assert.equal(b.result.monthlyCommitted, 32);
  });

  it("pause removes it from committed billing but keeps the relationship; resume restores it", () => {
    const s = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_silver` });
    const id = s.result.sponsorship.id;

    assert.equal(call("pause", ctxA, { sponsorshipId: id }).result.sponsorship.status, "paused");
    let b = call("billing", ctxA, {});
    assert.equal(b.result.activeCount, 0);
    assert.equal(b.result.pausedCount, 1);
    assert.equal(b.result.monthlyCommitted, 0, "paused does not commit CC");
    // The relationship survives in list_for_user (not cancelled).
    assert.equal(call("list_for_user", ctxA, {}).result.count, 1);

    assert.equal(call("resume", ctxA, { sponsorshipId: id }).result.sponsorship.status, "active");
    b = call("billing", ctxA, {});
    assert.equal(b.result.activeCount, 1);
    assert.equal(b.result.monthlyCommitted, 16);
  });

  it("cancel drops it from list_for_user; pause/resume/change after cancel are rejected", () => {
    const s = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_bronze` });
    const id = s.result.sponsorship.id;
    assert.equal(call("cancel", ctxA, { sponsorshipId: id }).result.status, "cancelled");
    assert.equal(call("list_for_user", ctxA, {}).result.count, 0);
    assert.match(call("pause", ctxA, { sponsorshipId: id }).error, /cannot pause/);
    assert.match(call("change_tier", ctxA, { sponsorshipId: id, tierId: `${CREATOR}_gold` }).error, /resubscribe/);
  });

  it("acting on an unknown sponsorship id is not_found, never a throw", () => {
    for (const m of ["pause", "resume", "change_tier", "cancel", "dispatch_history"]) {
      const r = call(m, ctxA, { sponsorshipId: "ghost", tierId: `${CREATOR}_gold` });
      assert.equal(r.ok, false);
      assert.match(r.error, /not found/);
    }
  });
});

describe("sponsorship — sponsor-only content gating (tier rank math)", () => {
  it("locks posts above the caller's tier and unlocks at/below it", () => {
    // Creator publishes one public, one silver-gated, one gold-gated post.
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Public note", body: "open", minTier: "public" });
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Silver scroll", body: "secret-s", minTier: "silver" });
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Gold tome", body: "secret-g", minTier: "gold" });

    // user_b subscribes at SILVER → sees public + silver bodies, gold is locked.
    call("subscribe", ctxB, { creatorId: CREATOR, tierId: `${CREATOR}_silver` });
    const f = call("feed", ctxB, { creatorId: CREATOR });
    assert.equal(f.ok, true);
    const byTitle = Object.fromEntries(f.result.posts.map((p) => [p.title, p]));
    assert.equal(byTitle["Public note"].locked, false);
    assert.equal(byTitle["Public note"].body, "open");
    assert.equal(byTitle["Silver scroll"].locked, false);
    assert.equal(byTitle["Silver scroll"].body, "secret-s");
    assert.equal(byTitle["Gold tome"].locked, true);
    assert.equal(byTitle["Gold tome"].body, null, "locked body is withheld, not leaked");
  });

  it("a non-sponsor only sees public bodies", () => {
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Pub", body: "p", minTier: "public" });
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Br", body: "b", minTier: "bronze" });
    const f = call("feed", ctxB, { creatorId: CREATOR });
    const byTitle = Object.fromEntries(f.result.posts.map((p) => [p.title, p]));
    assert.equal(byTitle["Pub"].locked, false);
    assert.equal(byTitle["Br"].locked, true);
    assert.equal(byTitle["Br"].body, null);
  });

  it("dispatch_history only returns dispatches published after the sponsorship started", () => {
    const s = call("subscribe", ctxB, { creatorId: CREATOR, tierId: `${CREATOR}_gold` });
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Weekly dispatch", body: "d1", kind: "dispatch" });
    call("publish_post", ctxA, { creatorId: CREATOR, title: "Not a dispatch", body: "x", kind: "post" });
    const h = call("dispatch_history", ctxB, { sponsorshipId: s.result.sponsorship.id });
    assert.equal(h.ok, true);
    assert.equal(h.result.count, 1);
    assert.equal(h.result.dispatches[0].title, "Weekly dispatch");
  });

  it("publish_post rejects missing creatorId/title", () => {
    assert.equal(call("publish_post", ctxA, { creatorId: CREATOR }).error, "creatorId and title required");
    assert.equal(call("publish_post", ctxA, { title: "x" }).error, "creatorId and title required");
  });
});

describe("sponsorship — leaderboard ranks by contribution", () => {
  it("ranks active sponsors by total contributed, badges by tier", () => {
    call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_gold` });   // 32
    call("subscribe", ctxB, { creatorId: CREATOR, tierId: `${CREATOR}_bronze` }); // 8
    const lb = call("leaderboard", ctxA, { creatorId: CREATOR });
    assert.equal(lb.ok, true);
    assert.equal(lb.result.count, 2);
    // Highest contributor first.
    assert.equal(lb.result.sponsors[0].userId, "user_a");
    assert.equal(lb.result.sponsors[0].rank, 1);
    assert.equal(lb.result.sponsors[0].badge, "gold");
    assert.equal(lb.result.sponsors[0].totalContributed, 32);
    assert.equal(lb.result.sponsors[1].userId, "user_b");
    assert.equal(lb.result.sponsors[1].rank, 2);
    assert.equal(lb.result.sponsors[1].badge, "bronze");
  });

  it("cancelled sponsors are excluded from the leaderboard", () => {
    const s = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_bronze` });
    call("cancel", ctxA, { sponsorshipId: s.result.sponsorship.id });
    assert.equal(call("leaderboard", ctxA, { creatorId: CREATOR }).result.count, 0);
  });
});

describe("sponsorship — thank-you messaging", () => {
  it("a creator can thank an active sponsor; non-sponsors are rejected", () => {
    call("subscribe", ctxB, { creatorId: CREATOR, tierId: `${CREATOR}_gold` });
    const ok = call("send_thanks", ctxA, { toUserId: "user_b", creatorId: CREATOR, body: "Thank you!" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.message.body, "Thank you!");

    // user_c is not a sponsor → rejected.
    const no = call("send_thanks", ctxA, { toUserId: "user_c", creatorId: CREATOR, body: "Hi" });
    assert.equal(no.ok, false);
    assert.match(no.error, /not an active sponsor/);

    // user_b sees the message as unread, then marks it read.
    const inbox = call("list_messages", ctxB, {});
    assert.equal(inbox.result.count, 1);
    assert.equal(inbox.result.unread, 1);
    const mid = inbox.result.messages[0].id;
    assert.equal(call("mark_message_read", ctxB, { messageId: mid }).result.read, true);
    assert.equal(call("list_messages", ctxB, {}).result.unread, 0);
  });

  it("send_thanks rejects missing fields; mark_message_read rejects unknown id", () => {
    assert.equal(call("send_thanks", ctxA, {}).error, "toUserId, creatorId and body required");
    assert.equal(call("mark_message_read", ctxB, { messageId: "nope" }).error, "message not found");
  });
});

describe("sponsorship — per-user isolation", () => {
  it("one user's sponsorships, billing, and inbox never leak to another", () => {
    call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_gold` });
    assert.equal(call("list_for_user", ctxA, {}).result.count, 1);
    assert.equal(call("list_for_user", ctxB, {}).result.count, 0);
    assert.equal(call("billing", ctxB, {}).result.activeCount, 0);
    assert.equal(call("list_messages", ctxB, {}).result.count, 0);
  });
});

describe("sponsorship — fail-CLOSED money path (no user-supplied amount)", () => {
  it("an injected poisoned monthlyCc/amountCc is IGNORED — contributions come only from the seeded tier", () => {
    // The lens money path takes NO numeric amount from the caller. Even if an
    // attacker injects an absurd amount on subscribe, the recorded charge and
    // totalContributed are the SEEDED tier price (16 for silver), never 1e308.
    for (const poison of [1e308, Infinity, -1, NaN, "9".repeat(40)]) {
      globalThis._concordSTATE = {};
      const r = call("subscribe", ctxA, {
        creatorId: CREATOR,
        tierId: `${CREATOR}_silver`,
        monthlyCc: poison, amountCc: poison, totalContributed: poison, price: poison,
      });
      assert.equal(r.ok, true, `subscribe still ok for poison=${String(poison)}`);
      assert.equal(r.result.sponsorship.monthlyCc, 16, "tier price wins, injected amount ignored");
      assert.equal(r.result.sponsorship.totalContributed, 16);

      const b = call("billing", ctxA, {});
      assert.equal(b.result.monthlyCommitted, 16);
      assert.equal(b.result.totalContributed, 16, `no CC minted from poison=${String(poison)}`);
      assert.ok(Number.isFinite(b.result.totalContributed), "totalContributed stays finite");
    }
  });

  it("change_tier likewise ignores an injected amount and reprices from the tier", () => {
    const s = call("subscribe", ctxA, { creatorId: CREATOR, tierId: `${CREATOR}_bronze` });
    const id = s.result.sponsorship.id;
    const c = call("change_tier", ctxA, { sponsorshipId: id, tierId: `${CREATOR}_gold`, monthlyCc: 1e308 });
    assert.equal(c.ok, true);
    assert.equal(c.result.sponsorship.monthlyCc, 32, "gold tier price, not 1e308");
    assert.ok(Number.isFinite(call("billing", ctxA, {}).result.monthlyCommitted));
  });
});
