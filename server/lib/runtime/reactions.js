// server/lib/runtime/reactions.js
//
// Concord Runtime — the reaction graph (docs/CONCORD_RUNTIME_MASTER_SPEC.md
// §9's event bus, put to actual use). A full-Concord cross-lens audit
// (2026-09-13) found the platform's knowledge/economic substrate (DTUs,
// royalty cascade) is genuinely cross-lens, but the action/event layer was
// "materially weaker and more bespoke" — the ingredients (event bus,
// capability registry, DTU object, royalty graph) already existed, but
// nothing turned them into an actual reaction: "I changed something in
// Lens A" didn't automatically become "Lens B knows and reacts."
//
// This file is that missing wiring. Two real chains so far, both wired
// through the bus instead of a direct import — the shape every future
// reaction should follow, not a one-off special case:
//   1. A player crafts an item -> the crafting lens publishes item.crafted
//      (lib/crafting/craft-engine.js) -> a real notification to the
//      crafter, through the already-shared notification substrate
//      (emergent/social-layer.js's createNotification).
//   2. ANY lens creates a DTU through the canonical dtu.create macro ->
//      server.js's ConcordEventBus fires dtu.created -> the "Concord
//      Runtime bridge" in server.js mirrors it onto THIS bus -> this
//      file notifies the creator's followers. This is the platform-wide
//      one, not Concordia-specific: every lens whose real output is a
//      DTU (the audit's own framing) now feeds this without that lens
//      knowing this file exists. Known, stated limit: only DTUs created
//      via the canonical macro reach this — a domain's own raw `INSERT
//      INTO dtus` (39 files do this) isn't covered by this reactor;
//      each of those needs its own explicit publish(), the same way
//      craft-engine.js got one, not a blanket fix from here.
//   3. A marketplace sale publishes marketplace.purchased
//      (server.js's marketplace.purchaseWithRoyalties macro) -> a
//      PERSISTENT notification for the seller, complementing (not
//      replacing) that macro's existing real-time-only socket toast,
//      which a disconnected seller would otherwise never see at all.
//   4. Any of the 38 authored achievements unlocking (combat, economy,
//      exploration, mastery, social — most of it outside Concordia)
//      publishes achievement.unlocked -> a persistent notification, same
//      "the existing toast is real-time-only" gap as #3, and the same
//      idempotent-PK substrate the audit itself named as already
//      cross-cutting, just missing the durable half.
//   5. A royalty cascade payout (economy/royalty-cascade.js's
//      distributeRoyalties, fired by ANY marketplace sale with ancestor
//      DTUs, not just #3's direct seller) publishes royalty.paid -> a
//      notification for the ancestor creator. Before this, an ancestor
//      earning real money from a citation chain got NO signal at all —
//      not even a toast. This is the audit's own "Creator system sees
//      authorship" arm of the forge-sword diagram.
//   6. registerCitation (the ACT of building on someone's work, separate
//      from and often prior to any royalty.paid) publishes dtu.cited for
//      a genuinely NEW citation (gated on the real INSERT OR IGNORE
//      .changes count, not just "the call succeeded" — a repeat citation
//      of the same pair must never re-notify) -> a notification that
//      someone built on their work, whether or not money ever follows.
//   7. lib/auctions.js's settleAuction (a heartbeat-driven sweep, not a
//      live user action — the seller/winner are very plausibly offline
//      at the exact settlement moment) publishes auction.settled -> a
//      durable notification for BOTH the seller and the winning bidder.
//   8. lib/quest-rewards.js's grantQuestRewards publishes
//      quest.reward_granted (non-empty-reward-only, mirroring that same
//      gate on the existing real-time-only "system:notice" toast) -> a
//      durable summary of what was actually granted.
//
// Deliberately additive and best-effort in both directions:
//   - publishing an event NEVER depends on a reactor existing (see the
//     event-bus module header — publish() never blocks, never throws).
//   - a reactor NEVER affects the action that triggered it: subscribe()'s
//     own wrapper already isolates a throwing listener from the publisher
//     (event-bus.js), and every reactor body below still wraps its own
//     work in try/catch as defense-in-depth, matching this codebase's
//     "a heartbeat/reactor must never throw" doctrine.
import { subscribe } from "./event-bus.js";
import { createNotification, getFollowers } from "../../emergent/social-layer.js";

const FOLLOWER_NOTIFY_CAP = 50; // matches getFollowers' own default limit — a deliberate cap, not a truncation bug

let _initialized = false;
let _unsubscribers = [];

function _craftedNotificationBody(payload) {
  const name = payload?.itemName || "an item";
  if (payload?.failed) return `Your ${name} came out flawed — the craft partially failed.`;
  const q = Number(payload?.qualityMultiplier);
  if (Number.isFinite(q) && q >= 1.5) return `You forged ${name} — exceptional quality!`;
  if (Number.isFinite(q) && q >= 1.1) return `You forged ${name} — solid quality.`;
  return `You forged ${name}.`;
}

/**
 * Wire the real reactors. Idempotent — safe to call more than once (a
 * second call is a no-op), so a boot-order edge case can never double-
 * subscribe and double-fire a reaction.
 */
export function initReactions() {
  if (_initialized) return;
  _initialized = true;

  // item.crafted -> a real notification for the crafter. Uses
  // globalThis.STATE (the same late-bound access pattern server.js's own
  // route handlers use for modules that don't have STATE in closure —
  // see server.js's `STATE: globalThis.STATE || null`) since this module
  // is imported before STATE exists at module-eval time; the actual call
  // happens well after boot, when a real craft fires the event.
  _unsubscribers.push(subscribe("item.crafted", (envelope) => {
    try {
      const { userId } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!userId || !STATE) return; // no user or no runtime STATE yet — honest no-op, never fabricate a notification
      createNotification(STATE, {
        userId,
        type: "item_crafted",
        content: _craftedNotificationBody(envelope.payload),
      });
    } catch { /* a reactor must never affect the craft that triggered it */ }
  }));

  // dtu.created -> notify the creator's followers. Platform-wide: fires
  // for any lens's DTU that went through the canonical macro (see this
  // file's header for the raw-insert coverage gap this does NOT close).
  _unsubscribers.push(subscribe("dtu.created", (envelope) => {
    try {
      const { id, title, creatorId, domain } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!id || !creatorId || !STATE) return; // honest no-op — never fabricate a notification for a DTU/creator we can't identify
      const { followers } = getFollowers(STATE, creatorId, FOLLOWER_NOTIFY_CAP);
      if (!followers || followers.length === 0) return; // no followers — real no-op, not a failure
      const label = title || (domain ? `a new ${domain} item` : "something new");
      for (const f of followers) {
        if (!f?.userId) continue;
        createNotification(STATE, {
          userId: f.userId,
          type: "dtu_created",
          fromUserId: creatorId,
          content: `Someone you follow created ${label}.`,
        });
      }
    } catch { /* a reactor must never affect the DTU create that triggered it */ }
  }));

  // marketplace.purchased -> a durable notification for the seller.
  _unsubscribers.push(subscribe("marketplace.purchased", (envelope) => {
    try {
      const { sellerId, title, price, dtuId } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!sellerId || !STATE) return; // honest no-op — never fabricate a sale notification with no identifiable seller
      const label = title || "your item";
      const amount = Number.isFinite(Number(price)) ? `$${Number(price).toFixed(2)}` : "an item";
      createNotification(STATE, {
        userId: sellerId,
        type: "marketplace_sale",
        content: `${label} sold for ${amount}.`,
        postId: dtuId || null,
      });
    } catch { /* a reactor must never affect the sale that triggered it */ }
  }));

  // achievement.unlocked -> a durable notification, complementing the
  // real-time-only achievement:unlocked toast.
  _unsubscribers.push(subscribe("achievement.unlocked", (envelope) => {
    try {
      const { userId, title, rewardSparks, rewardTitle } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!userId || !STATE) return; // honest no-op
      const name = title || "an achievement";
      let content = `Achievement unlocked: ${name}.`;
      const extras = [];
      if (Number(rewardSparks) > 0) extras.push(`+${rewardSparks} sparks`);
      if (rewardTitle) extras.push(`title "${rewardTitle}"`);
      if (extras.length) content += ` (${extras.join(", ")})`;
      createNotification(STATE, { userId, type: "achievement_unlocked", content });
    } catch { /* a reactor must never affect the unlock that triggered it */ }
  }));

  // royalty.paid -> a notification for the ancestor creator who earned it.
  _unsubscribers.push(subscribe("royalty.paid", (envelope) => {
    try {
      const { recipientId, amount } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!recipientId || !STATE) return; // honest no-op
      const amt = Number.isFinite(Number(amount)) ? `$${Number(amount).toFixed(2)}` : "a royalty payment";
      createNotification(STATE, {
        userId: recipientId,
        type: "royalty_paid",
        content: `You earned ${amt} in royalties from work built on yours.`,
      });
    } catch { /* a reactor must never affect the payout that triggered it */ }
  }));

  // dtu.cited -> notify the parent creator that their work was built on.
  _unsubscribers.push(subscribe("dtu.cited", (envelope) => {
    try {
      const { parentCreatorId, childId } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!parentCreatorId || !STATE) return; // honest no-op
      createNotification(STATE, {
        userId: parentCreatorId,
        type: "dtu_cited",
        postId: childId || null,
        content: "Someone built on your work.",
      });
    } catch { /* a reactor must never affect the citation that triggered it */ }
  }));

  // auction.settled -> durable notifications for both parties. A sold
  // auction always has a winning bidder (bid_count > 0 is the gate before
  // this ever publishes — see settleAuction), so buyerUserId is expected,
  // but each notification is still independently guarded rather than
  // assuming the other party's id is present.
  _unsubscribers.push(subscribe("auction.settled", (envelope) => {
    try {
      const { sellerUserId, buyerUserId, winningBidCc, sellerPayout } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!STATE) return;
      if (sellerUserId) {
        const amt = Number.isFinite(Number(sellerPayout)) ? `$${Number(sellerPayout).toFixed(2)}` : "payment";
        createNotification(STATE, { userId: sellerUserId, type: "auction_sold", content: `Your auction sold for ${amt}.` });
      }
      if (buyerUserId) {
        const amt = Number.isFinite(Number(winningBidCc)) ? `${winningBidCc} CC` : "the winning bid";
        createNotification(STATE, { userId: buyerUserId, type: "auction_won", content: `You won an auction for ${amt}.` });
      }
    } catch { /* a reactor must never affect the settlement that triggered it */ }
  }));

  // quest.reward_granted -> a durable summary of the granted reward.
  _unsubscribers.push(subscribe("quest.reward_granted", (envelope) => {
    try {
      const { userId, summary } = envelope.payload || {};
      const STATE = globalThis.STATE;
      if (!userId || !STATE) return;
      createNotification(STATE, {
        userId,
        type: "quest_reward",
        content: summary ? `Quest reward: ${summary}` : "You received a quest reward.",
      });
    } catch { /* a reactor must never affect the grant that triggered it */ }
  }));
}

/** @internal Test-only — undo initReactions() so a test suite can call it fresh. */
export function _resetReactions() {
  for (const unsub of _unsubscribers) {
    try { unsub?.(); } catch { /* test cleanup only */ }
  }
  _unsubscribers = [];
  _initialized = false;
}
