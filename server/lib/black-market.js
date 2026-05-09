/**
 * Black Market for Intercepted Messages
 *
 * When a Link Walker journey ends in interception (see concord-link-walkers
 * advanceJourneyTick), the message status is set to 'intercepted'. Some
 * fraction of those (60% by default) get surfaced as listings under a fence
 * NPC. Players can browse listings (sender/receiver redacted, payload kept
 * server-side until purchase), buy with sparks, and decrypt the original
 * message at higher prices for higher encryption tiers.
 *
 * The fence operator is broker_sael by default — their authored backstory
 * already names them as the holder of intercepted-archive material. Other
 * fences can register by setting `black_market_fence:true` on an authored NPC.
 *
 * Currency is sparks only. No real-money codepaths.
 */

import crypto from "crypto";

// Price tiers by encryption level. Buyers with negative rep pay extra; buyers
// with positive standing get a discount up to ~25%.
const BASE_PRICE = Object.freeze({
  none:   25,
  basic:  60,
  high:   180,
  shadow: 500,
});

const SURFACE_PROBABILITY = 0.6;
const REP_DELTA_PURCHASE  = 2;   // each clean purchase
const REP_DELTA_FAILED    = -1;  // failed purchase attempt (insufficient funds)
const REP_FLOOR           = -50;
const REP_CEIL            = 100;

/**
 * Surface an intercepted message as a black-market listing. Called by the
 * walker journey tick when a delivery is intercepted on its final hop.
 * Idempotent: a second call for the same message_id is a no-op.
 *
 * @returns {{ ok: true, listing?: object, surfaced: boolean } | { ok: false, reason: string }}
 */
export function surfaceInterceptedMessage(db, messageId, { fenceNpcId = "broker_sael", probability = SURFACE_PROBABILITY } = {}) {
  if (!db || !messageId) return { ok: false, reason: "missing_inputs" };

  // Idempotency
  const existing = db.prepare(`SELECT id FROM black_market_listings WHERE message_id = ?`).get(messageId);
  if (existing) return { ok: true, surfaced: false, listing: null };

  // Some intercepts are simply lost — narrative variance.
  if (Math.random() >= probability) {
    return { ok: true, surfaced: false, listing: null };
  }

  const msg = db.prepare(`
    SELECT id, payload, encryption_level, source_world, dest_world, sent_at
      FROM concord_link_messages WHERE id = ? AND status = 'intercepted'
  `).get(messageId);
  if (!msg) return { ok: false, reason: "message_not_found_or_not_intercepted" };

  const price = BASE_PRICE[msg.encryption_level] ?? BASE_PRICE.basic;
  const preview = redactPayload(msg.payload || "", msg.encryption_level);
  const id = `bml_${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(`
    INSERT INTO black_market_listings (
      id, message_id, fence_npc_id, price_sparks, encryption_level,
      redacted_preview, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch() + 86400 * 7)
  `).run(id, messageId, fenceNpcId, price, msg.encryption_level, preview);


  const listing = db.prepare(`SELECT * FROM black_market_listings WHERE id = ?`).get(id);
  return { ok: true, surfaced: true, listing };
}

/**
 * Build a redacted preview the buyer can see before purchase. Higher-encryption
 * messages reveal less; sender + receiver are never previewed.
 */
function redactPayload(payload, encryption) {
  const len = (payload || "").length;
  if (len === 0) return "[empty payload]";
  const opening = payload.slice(0, 40).replace(/[A-Za-z0-9]/g, "·");
  if (encryption === "shadow")    return `[${len} chars · shadow-encrypted · cipher unknown]`;
  if (encryption === "high")      return `[${len} chars · high-encryption · ${opening}…]`;
  if (encryption === "basic")     return `[${len} chars · ${payload.slice(0, 30)}…]`;
  return `[${len} chars · ${payload.slice(0, 60)}…]`;
}

/**
 * List active listings, optionally scoped to a single fence. Most-recent first.
 */
export function browseListings(db, { fenceNpcId = null, limit = 50 } = {}) {
  const rows = fenceNpcId
    ? db.prepare(`
        SELECT id, message_id, fence_npc_id, price_sparks, encryption_level,
               redacted_preview, created_at, expires_at
          FROM black_market_listings
         WHERE status = 'active' AND fence_npc_id = ? AND expires_at > unixepoch()
         ORDER BY created_at DESC LIMIT ?
      `).all(fenceNpcId, limit)
    : db.prepare(`
        SELECT id, message_id, fence_npc_id, price_sparks, encryption_level,
               redacted_preview, created_at, expires_at
          FROM black_market_listings
         WHERE status = 'active' AND expires_at > unixepoch()
         ORDER BY created_at DESC LIMIT ?
      `).all(limit);
  return rows;
}

/**
 * Purchase a listing. Atomic: spark debit + listing flip + reputation update
 * + decryption returned to buyer. If the buyer can't afford, returns failed
 * with a small rep penalty (the fence remembers).
 *
 * Returns: { ok, listing, message?, sparksSpent, buyerRep }
 */
export function purchaseListing(db, { listingId, buyerId }) {
  if (!db || !listingId || !buyerId) return { ok: false, reason: "missing_inputs" };


  const listing = db.prepare(`SELECT * FROM black_market_listings WHERE id = ?`).get(listingId);
  if (!listing)                            return { ok: false, reason: "listing_not_found" };
  if (listing.status !== "active")          return { ok: false, reason: "listing_not_active" };
  if (listing.expires_at <= Math.floor(Date.now() / 1000)) {
    db.prepare(`UPDATE black_market_listings SET status='expired' WHERE id=?`).run(listingId);
    return { ok: false, reason: "listing_expired" };
  }

  const price = effectivePrice(db, buyerId, listing);
  const userRow = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(buyerId);
  if (!userRow)                             return { ok: false, reason: "buyer_not_found" };
  if ((userRow.sparks ?? 0) < price) {
    bumpReputation(db, buyerId, listing.fence_npc_id, REP_DELTA_FAILED);
    return { ok: false, reason: "insufficient_sparks", price, have: userRow.sparks ?? 0 };
  }

  let revealed = null;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET sparks = sparks - ? WHERE id = ?`).run(price, buyerId);
    db.prepare(`
      UPDATE black_market_listings
         SET status='sold', buyer_id=?, sold_at=unixepoch(), sale_price=?
       WHERE id=?
    `).run(buyerId, price, listingId);

    bumpReputation(db, buyerId, listing.fence_npc_id, REP_DELTA_PURCHASE);


    const msg = db.prepare(`SELECT * FROM concord_link_messages WHERE id = ?`).get(listing.message_id);
    if (msg) revealed = msg;
  });
  tx();


  const repRow = db.prepare(`SELECT * FROM black_market_reputation WHERE user_id=? AND fence_npc_id=?`).get(buyerId, listing.fence_npc_id);

  return {
    ok: true,
    sparksSpent: price,
    listing: db.prepare(`SELECT * FROM black_market_listings WHERE id=?`).get(listingId),
    message: revealed,
    buyerRep: repRow?.buyer_rep ?? 0,
  };
}

/**
 * Compute effective price for a buyer + listing pair. Reputation in [-50,100]
 * scales price by ±25%. Higher rep = lower price (the fence trusts you).
 */
function effectivePrice(db, buyerId, listing) {
  const row = db.prepare(`
    SELECT buyer_rep FROM black_market_reputation WHERE user_id=? AND fence_npc_id=?
  `).get(buyerId, listing.fence_npc_id);
  const rep = clamp(row?.buyer_rep ?? 0, REP_FLOOR, REP_CEIL);
  // rep=100 → 0.75x; rep=0 → 1.0x; rep=-50 → 1.25x
  const factor = 1.0 - (rep / 100) * 0.25;
  return Math.max(1, Math.round(listing.price_sparks * factor));
}

function bumpReputation(db, userId, fenceId, delta) {
  db.prepare(`
    INSERT INTO black_market_reputation (user_id, fence_npc_id, buyer_rep, purchases, last_trade_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, fence_npc_id) DO UPDATE SET
      buyer_rep    = MAX(?, MIN(?, buyer_rep + ?)),
      purchases    = purchases + CASE WHEN ?>0 THEN 1 ELSE 0 END,
      last_trade_at = unixepoch()
  `).run(userId, fenceId, clamp(delta, REP_FLOOR, REP_CEIL), delta > 0 ? 1 : 0, REP_FLOOR, REP_CEIL, delta, delta);
}

/**
 * Heartbeat-driven: expire listings whose expires_at has passed.
 */
export function expireListings(db) {
  const r = db.prepare(`
    UPDATE black_market_listings SET status='expired'
     WHERE status='active' AND expires_at <= unixepoch()
  `).run();
  return { expired: r.changes };
}

/**
 * Read a buyer's reputation across all fences.
 */
export function getBuyerReputation(db, buyerId) {
  return db.prepare(`
    SELECT fence_npc_id, buyer_rep, purchases, last_trade_at
      FROM black_market_reputation
     WHERE user_id = ?
     ORDER BY last_trade_at DESC
  `).all(buyerId);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
