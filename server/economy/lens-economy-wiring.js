// economy/lens-economy-wiring.js
// Connective tissue: Wire CC transactions, merit credit, bounties, and
// tipping into every lens.  Provides one-call helpers that the lens routes
// can invoke — no business logic leaks into route handlers.

import { randomUUID } from "crypto";
import { executeTransfer } from "./transfer.js";
import { recordTransaction, generateTxId } from "./ledger.js";
import { registerCitation, distributeRoyalties } from "./royalty-cascade.js";
import { getBalance } from "./balances.js";
import logger from '../logger.js';

function uid(prefix = "lew") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ═══════════════════════════════════════════════════════════════════════════
// CC TIPPING — any lens, any content
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tip a piece of content (message, DTU, contribution) with CC.
 * Creates a TRANSFER ledger entry + a tip record for tracking.
 */
export function tipContent(db, {
  tipperId, creatorId, contentId, contentType, lensId, amount,
  requestId, ip,
}) {
  if (!tipperId || !creatorId) return { ok: false, error: "missing_user_ids" };
  if (!contentId) return { ok: false, error: "missing_content_id" };
  if (!amount || amount <= 0) return { ok: false, error: "invalid_tip_amount" };
  if (tipperId === creatorId) return { ok: false, error: "cannot_tip_self" };

  const refId = `tip:${tipperId}:${contentId}:${Date.now()}`;
  const transferResult = executeTransfer(db, {
    from: tipperId,
    to: creatorId,
    amount,
    type: "TRANSFER",
    metadata: {
      subtype: "TIP",
      contentId,
      contentType: contentType || "unknown",
      lensId: lensId || "unknown",
    },
    refId,
    requestId,
    ip,
  });

  if (!transferResult.ok) return transferResult;

  // Record tip in tips table
  try {
    db.prepare(`
      INSERT INTO tips (id, tipper_id, creator_id, content_id, content_type,
        lens_id, amount, ledger_ref_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid("tip"), tipperId, creatorId, contentId,
      contentType || "unknown", lensId || "unknown", amount, refId, nowISO());
  } catch (_e) { logger.debug('lens-economy-wiring', 'table may not exist yet — tip still happened via ledger', { error: _e?.message }); }

  // Award merit credit for tipping activity
  awardMeritCredit(db, tipperId, "tip_given", 1, { contentId, lensId });
  awardMeritCredit(db, creatorId, "tip_received", 2, { contentId, lensId });

  return { ok: true, tip: { tipperId, creatorId, contentId, amount, refId } };
}

// ═══════════════════════════════════════════════════════════════════════════
// BOUNTIES — QuestMarket + any lens
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Post a bounty (CC is escrowed).
 */
export function postBounty(db, {
  posterId, title, description, lensId, amount, tags = [], expiresAt,
  requestId, ip,
}) {
  if (!posterId) return { ok: false, error: "missing_poster_id" };
  if (!amount || amount <= 0) return { ok: false, error: "invalid_bounty_amount" };
  if (!title) return { ok: false, error: "missing_title" };

  // Check balance
  const { balance } = getBalance(db, posterId);
  if (balance < amount) return { ok: false, error: "insufficient_balance", balance, required: amount };

  const bountyId = uid("bnt");
  const refId = `bounty_escrow:${bountyId}`;
  const now = nowISO();

  const doPost = db.transaction(() => {
    // Escrow: transfer from poster to escrow holding account
    // Fee-drain fix (2026-07-30, migration 399): BOUNTY_ESCROW is fee-exempt
    // (absent from fees.js's FEES map, same as STAKE_ESCROW) — using
    // "TRANSFER" here charged FEES.TRANSFER on the way into __ESCROW__, so
    // the escrow account never held the full bounty.amount claimBounty
    // later tries to release, and every real claim failed with
    // insufficient_balance regardless of identity.
    const escrowResult = executeTransfer(db, {
      from: posterId,
      to: "__ESCROW__",
      amount,
      type: "BOUNTY_ESCROW",
      metadata: { subtype: "BOUNTY_ESCROW", bountyId },
      refId,
      requestId,
      ip,
    });
    if (!escrowResult.ok) throw new Error(escrowResult.error || "escrow_failed");

    // Record bounty
    db.prepare(`
      INSERT INTO bounties (id, poster_id, title, description, lens_id, amount,
        tags_json, status, escrow_ref_id, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)
    `).run(bountyId, posterId, title, description || "",
      lensId || "questmarket", amount, JSON.stringify(tags),
      refId, expiresAt || null, now, now);

    return { bountyId };
  });

  try {
    const result = doPost();
    awardMeritCredit(db, posterId, "bounty_posted", 3, { bountyId, lensId });
    return { ok: true, bounty: { id: result.bountyId, status: "OPEN", amount } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Claim a bounty — poster awards it to a claimer.
 */
export function claimBounty(db, {
  bountyId, claimerId, posterId, solutionDtuId,
  requestId, ip,
}) {
  if (!bountyId || !claimerId || !posterId) return { ok: false, error: "missing_ids" };

  const bounty = db.prepare("SELECT * FROM bounties WHERE id = ? AND status = 'OPEN'").get(bountyId);
  if (!bounty) return { ok: false, error: "bounty_not_found_or_closed" };
  if (bounty.poster_id !== posterId) return { ok: false, error: "only_poster_can_award" };

  const refId = `bounty_claim:${bountyId}:${claimerId}`;
  const now = nowISO();

  const doClaim = db.transaction(() => {
    // Release escrow to claimer. BOUNTY_CLAIM is fee-exempt (migration 399,
    // see postBounty's escrow move above) — the claimer gets the full
    // originally-posted amount, not a fee-shrunk fraction of it.
    const releaseResult = executeTransfer(db, {
      from: "__ESCROW__",
      to: claimerId,
      amount: bounty.amount,
      type: "BOUNTY_CLAIM",
      metadata: { subtype: "BOUNTY_CLAIM", bountyId, solutionDtuId },
      refId,
      requestId,
      ip,
    });
    if (!releaseResult.ok) throw new Error(releaseResult.error || "claim_failed");

    // Update bounty status
    db.prepare(`
      UPDATE bounties SET status = 'CLAIMED', claimed_by = ?, solution_dtu_id = ?,
        claimed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(claimerId, solutionDtuId || null, now, now, bountyId);
  });

  try {
    doClaim();
    awardMeritCredit(db, claimerId, "bounty_claimed", 10, { bountyId });
    return { ok: true, bounty: { id: bountyId, status: "CLAIMED", claimerId } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MERIT CREDIT — universal activity scoring
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Award merit credit for any activity.
 * Merit credit is non-transferable, non-purchasable — purely earned.
 */
export function awardMeritCredit(db, userId, activityType, points, metadata = {}) {
  if (!userId || !activityType || !points) return { ok: false };

  try {
    db.prepare(`
      INSERT INTO merit_credit (id, user_id, activity_type, points, lens_id,
        metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uid("mc"), userId, activityType, points,
      metadata.lensId || null, JSON.stringify(metadata), nowISO());

    return { ok: true, userId, points, activityType };
  } catch (err) { console.error('[lens-economy-wiring] awardMeritCredit failed', { userId, activityType, err: err.message }); return { ok: false }; }
}

/**
 * Get a user's total merit credit score.
 */
export function getMeritCredit(db, userId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(points), 0) as total
    FROM merit_credit WHERE user_id = ?
  `).get(userId);

  const breakdown = db.prepare(`
    SELECT activity_type, SUM(points) as subtotal, COUNT(*) as count
    FROM merit_credit WHERE user_id = ?
    GROUP BY activity_type ORDER BY subtotal DESC
  `).all(userId);

  return { userId, total: row?.total || 0, breakdown };
}

/**
 * Check 0% loan eligibility based on merit credit.
 */
export function checkLoanEligibility(db, userId) {
  const { total, breakdown } = getMeritCredit(db, userId);
  const { balance } = getBalance(db, userId);

  // Eligibility tiers
  const tier = total >= 1000 ? "platinum" :
               total >= 500  ? "gold" :
               total >= 100  ? "silver" :
               total >= 25   ? "bronze" : "none";

  const maxLoan = tier === "platinum" ? balance * 10 :
                  tier === "gold"     ? balance * 5 :
                  tier === "silver"   ? balance * 2 :
                  tier === "bronze"   ? balance * 1 : 0;

  return {
    userId,
    meritCredit: total,
    tier,
    eligible: tier !== "none",
    maxLoanAmount: Math.round(maxLoan * 100) / 100,
    currentBalance: balance,
    breakdown,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE PURCHASE — with automatic citation royalties
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Purchase a DTU from the marketplace.
 * Applies 95% creator / 5% platform split with royalty cascades.
 */
export function purchaseDTU(db, {
  buyerId, dtuId, sellerId, amount, lensId,
  requestId, ip,
}) {
  if (!buyerId || !sellerId || !dtuId) return { ok: false, error: "missing_ids" };
  if (!amount || amount <= 0) return { ok: false, error: "invalid_amount" };
  if (buyerId === sellerId) return { ok: false, error: "cannot_purchase_own" };

  const refId = `dtu_purchase:${buyerId}:${dtuId}:${Date.now()}`;

  // Execute the marketplace transfer (fee calculation is built into executeTransfer)
  const transferResult = executeTransfer(db, {
    from: buyerId,
    to: sellerId,
    amount,
    type: "MARKETPLACE_PURCHASE",
    metadata: { dtuId, lensId: lensId || "marketplace", subtype: "DTU_PURCHASE" },
    refId,
    requestId,
    ip,
  });

  if (!transferResult.ok) return transferResult;

  // Record the purchase in the DTU ownership table
  try {
    db.prepare(`
      INSERT OR IGNORE INTO dtu_ownership (id, dtu_id, owner_id, acquired_via,
        purchase_amount, ledger_ref_id, created_at)
      VALUES (?, ?, ?, 'PURCHASE', ?, ?, ?)
    `).run(uid("own"), dtuId, buyerId, amount, refId, nowISO());
  } catch (_e) { logger.debug('lens-economy-wiring', 'ownership table may not exist yet', { error: _e?.message }); }

  // Execute royalty cascade if this DTU cites others
  try {
    distributeRoyalties(db, { contentId: dtuId, transactionAmount: amount, buyerId, sellerId, requestId, ip });
  } catch (_e) { logger.debug('lens-economy-wiring', 'cascade is supplementary, purchase still valid', { error: _e?.message }); }

  // Award merit
  awardMeritCredit(db, buyerId, "dtu_purchased", 2, { dtuId, lensId });
  awardMeritCredit(db, sellerId, "dtu_sold", 5, { dtuId, lensId });

  return { ok: true, purchase: { buyerId, dtuId, sellerId, amount, refId } };
}
