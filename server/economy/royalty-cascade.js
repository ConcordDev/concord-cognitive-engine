// economy/royalty-cascade.js
// Perpetual royalty cascade engine.
// Every piece of knowledge carries perpetual attribution.
// Royalties halve with each generation but never reach zero (0.05% floor).
//
// Formula: royalty(n) = max(initialRate / 2^n, 0.0005)

import { randomUUID } from "crypto";
import { recordTransactionBatch, generateTxId } from "./ledger.js";
import { PLATFORM_ACCOUNT_ID } from "./fees.js";
import { canCiteDtu, canCiteSpecificDtu } from "../lib/consent.js";
import {
  grantEarnedStorage,
  countTriggersSinceLastGrant,
  STORAGE_EARN_PER_ROYALTY_BATCH_BYTES,
  ROYALTY_BATCH_SIZE,
  STORAGE_REASONS,
} from "../lib/storage-quota.js";

function uid(prefix = "roy") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Royalty constants
const CONCORD_ROYALTY_RATE = 0.30;       // 30% for Concord-produced content
const CONCORD_PASSTHROUGH_RATE = 0.70;   // 70% of Concord's royalty flows to sources
const ROYALTY_FLOOR = 0.0005;            // 0.05% — royalties never reach zero
const DEFAULT_INITIAL_RATE = 0.21;       // 21% initial rate for cascades
const MAX_CASCADE_DEPTH = 50;            // Maximum lineage depth to traverse
const CONCORD_SYSTEM_ID = "__CONCORD__"; // System account for Concord-produced content

/**
 * Calculate the royalty rate for a given generation.
 * royalty(n) = max(initialRate / 2^n, 0.0005)
 *
 * @param {number} generation — 0-indexed generation (0 = original source)
 * @param {number} [initialRate=0.21] — base rate for gen 0
 * @returns {number} royalty rate as decimal
 */
export function calculateGenerationalRate(generation, initialRate = DEFAULT_INITIAL_RATE) {
  if (generation < 0) return 0;
  const rate = initialRate / Math.pow(2, generation);
  return Math.max(rate, ROYALTY_FLOOR);
}

/**
 * Register a citation/derivation in the royalty lineage.
 * When content B cites or derives from content A, record that relationship
 * so royalties flow back to A's creator on any transaction involving B.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.childId — the new/derivative content ID
 * @param {string} opts.parentId — the cited/source content ID
 * @param {string} opts.creatorId — creator of the child content
 * @param {string} opts.parentCreatorId — creator of the parent content
 * @param {number} [opts.generation=1] — generation distance (1 = direct citation)
 */
export function registerCitation(db, { childId, parentId, creatorId, parentCreatorId, parentDtu, hasPurchasedLicense, generation = 1 }) {
  if (!childId || !parentId) return { ok: false, error: "missing_content_ids" };
  if (childId === parentId) return { ok: false, error: "self_citation_not_allowed" };
  if (!creatorId || !parentCreatorId) return { ok: false, error: "missing_creator_ids" };

  // Citation gate, three paths:
  //   1. Parent is public / published / global-scoped (DTU-aware check)
  //   2. Parent creator toggled allow_citation globally
  //   3. Caller holds a purchased usage/remix license on the parent —
  //      selling usage rights IS consenting to citation by that buyer.
  //      Otherwise buyers would pay for remix rights and then find
  //      their derivatives stranded out of the royalty cascade.
  let cited = false;
  if (hasPurchasedLicense === true) {
    cited = true;
  } else if (parentDtu) {
    cited = canCiteSpecificDtu(db, parentDtu);
  } else {
    cited = canCiteDtu(db, parentCreatorId);
  }
  if (!cited) {
    return { ok: false, error: "citation_consent_not_granted" };
  }

  // Check for cycles — prevent A→B→C→A
  if (wouldCreateCycle(db, childId, parentId)) {
    return { ok: false, error: "citation_cycle_detected" };
  }

  const id = uid("lin");
  try {
    db.prepare(`
      INSERT OR IGNORE INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, childId, parentId, generation, creatorId, parentCreatorId, nowISO());

    return { ok: true, lineageId: id, childId, parentId, generation };
  } catch (err) {
    if (err.message?.includes("UNIQUE")) return { ok: true, existing: true };
    console.error("[economy] citation_registration_failed:", err.message);
    return { ok: false, error: "citation_registration_failed" };
  }
}

/**
 * Get the complete ancestor chain for a piece of content.
 * Returns all ancestors with their generation distance.
 */
export function getAncestorChain(db, contentId, maxDepth = MAX_CASCADE_DEPTH) {
  const ancestors = [];
  const visited = new Set();
  const queue = [{ id: contentId, generation: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.id) || current.generation > maxDepth) continue;
    visited.add(current.id);

    const parents = db.prepare(`
      SELECT parent_id, parent_creator, generation
      FROM royalty_lineage WHERE child_id = ?
    `).all(current.id);

    for (const parent of parents) {
      const totalGeneration = current.generation + parent.generation;
      if (totalGeneration <= maxDepth && !visited.has(parent.parent_id)) {
        ancestors.push({
          contentId: parent.parent_id,
          creatorId: parent.parent_creator,
          generation: totalGeneration,
          rate: calculateGenerationalRate(totalGeneration),
        });
        queue.push({ id: parent.parent_id, generation: totalGeneration });
      }
    }
  }

  return ancestors;
}

/**
 * Calculate and distribute royalties for a transaction.
 * Called after a marketplace purchase to send royalties to all ancestors.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.contentId — the content being transacted
 * @param {number} opts.transactionAmount — the gross transaction amount
 * @param {string} opts.sourceTxId — the originating transaction ID
 * @param {string} [opts.buyerId] — who bought it (for ledger entries)
 * @param {string} [opts.sellerId] — who sold it
 * @param {string} [opts.refId] — idempotency reference
 * @returns {{ ok: boolean, totalRoyalties: number, payouts: array }}
 */
export function distributeRoyalties(db, { contentId, transactionAmount, sourceTxId, buyerId, sellerId, refId, requestId, ip }) {
  if (!contentId || !transactionAmount || transactionAmount <= 0) {
    return { ok: false, error: "invalid_royalty_params" };
  }

  // Idempotency: if any royalty_payouts row already exists for this
  // sourceTxId, this distribution has already been made. Webhook retries
  // and at-least-once delivery semantics demand this — the unique partial
  // index in migration 004 only guards `role='debit'` rows, not the
  // `role='royalty'` rows we write here.
  if (sourceTxId) {
    try {
      const prior = db.prepare(`SELECT COUNT(*) AS n FROM royalty_payouts WHERE source_tx_id = ?`).get(sourceTxId);
      if ((prior?.n ?? 0) > 0) {
        return { ok: true, idempotent: true, totalRoyalties: 0, payouts: [], message: "already_distributed" };
      }
    } catch { /* royalty_payouts may not exist on minimal builds — proceed */ }
  }

  // Get the ancestor chain
  const ancestors = getAncestorChain(db, contentId);
  if (ancestors.length === 0) {
    return { ok: true, totalRoyalties: 0, payouts: [], message: "no_ancestors" };
  }

  // Deduplicate by creator (a creator only gets one payout per transaction, at their best rate)
  const creatorPayouts = new Map();
  for (const ancestor of ancestors) {
    const existing = creatorPayouts.get(ancestor.creatorId);
    if (!existing || ancestor.rate > existing.rate) {
      creatorPayouts.set(ancestor.creatorId, ancestor);
    }
  }

  // Calculate payout amounts with 30% cap
  // Seller protection: royalties never exceed 30% of sale price
  // Seller always keeps at least 64.54% (100% - 5.46% fees - 30% max royalties)
  const MAX_ROYALTY_RATE = 0.30;
  const maxRoyaltyPool = Math.round(transactionAmount * MAX_ROYALTY_RATE * 100) / 100;
  const payouts = [];
  let totalRoyalties = 0;

  // Sort by generation (closest ancestors first, they get priority)
  const sortedCreators = [...creatorPayouts.entries()].sort(
    ([, a], [, b]) => a.generation - b.generation
  );

  for (const [creatorId, ancestor] of sortedCreators) {
    // Don't pay royalties to the seller (they already got paid)
    if (creatorId === sellerId) continue;
    // Don't pay royalties to the buyer
    if (creatorId === buyerId) continue;

    let royaltyAmount = Math.round(transactionAmount * ancestor.rate * 100) / 100;
    if (royaltyAmount < 0.01) continue; // Skip sub-penny royalties

    // Cap check: would this payment exceed 30%?
    if (totalRoyalties + royaltyAmount > maxRoyaltyPool) {
      royaltyAmount = Math.round((maxRoyaltyPool - totalRoyalties) * 100) / 100;
      if (royaltyAmount < 0.01) break; // nothing left to pay
    }

    payouts.push({
      recipientId: creatorId,
      contentId: ancestor.contentId,
      generation: ancestor.generation,
      rate: ancestor.rate,
      amount: royaltyAmount,
    });

    totalRoyalties += royaltyAmount;
    if (totalRoyalties >= maxRoyaltyPool) break; // cap reached
  }

  if (payouts.length === 0) {
    return { ok: true, totalRoyalties: 0, payouts: [], message: "no_payable_royalties" };
  }

  totalRoyalties = Math.round(totalRoyalties * 100) / 100;

  // Execute royalty payments atomically
  const royaltyRefId = refId || `royalty:${sourceTxId}:${contentId}`;
  const batchId = generateTxId();

  const doRoyalties = db.transaction(() => {
    const ledgerEntries = [];
    const payoutRecords = [];

    for (const payout of payouts) {
      const txId = generateTxId();

      // Ledger entry: royalty payment (fee-free).
      // Type MUST be "ROYALTY_PAYOUT" — the economy_ledger CHECK constraint
      // (migration 002) enumerates exactly these values:
      // TOKEN_PURCHASE / TRANSFER / MARKETPLACE_PURCHASE / ROYALTY_PAYOUT /
      // WITHDRAWAL / FEE / REVERSAL. Inserting any other string silently
      // fails the whole transaction (CHECK constraint failed); the only
      // observable symptom is "[economy] royalty_distribution_failed" in
      // logs while every cascade silently produces zero ledger rows.
      ledgerEntries.push({
        id: txId,
        type: "ROYALTY_PAYOUT",
        from: sellerId || PLATFORM_ACCOUNT_ID,
        to: payout.recipientId,
        amount: payout.amount,
        fee: 0,
        net: payout.amount,
        status: "complete",
        refId: royaltyRefId,
        metadata: {
          batchId,
          role: "royalty",
          contentId: payout.contentId,
          generation: payout.generation,
          rate: payout.rate,
          sourceTxId,
        },
        requestId,
        ip,
      });

      // Payout record for tracking
      payoutRecords.push({
        id: uid("rpy"),
        transactionId: txId,
        contentId: payout.contentId,
        recipientId: payout.recipientId,
        amount: payout.amount,
        generation: payout.generation,
        royaltyRate: payout.rate,
        sourceTxId,
      });
    }

    const results = recordTransactionBatch(db, ledgerEntries);

    // Record payout details
    const stmt = db.prepare(`
      INSERT INTO royalty_payouts (id, transaction_id, content_id, recipient_id, amount, generation, royalty_rate, source_tx_id, ledger_entry_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `);

    for (let i = 0; i < payoutRecords.length; i++) {
      const pr = payoutRecords[i];
      stmt.run(pr.id, pr.transactionId, pr.contentId, pr.recipientId, pr.amount, pr.generation, pr.royaltyRate, pr.sourceTxId, results[i]?.id || null, nowISO());
    }

    // Earned-storage hook. Every ROYALTY_BATCH_SIZE payouts received by a
    // single recipient grants STORAGE_EARN_PER_ROYALTY_BATCH_BYTES (default
    // 1 GiB per 100 payouts). Active creators expand storage organically;
    // lurkers stay at the 5 GiB baseline. Idempotent via grant_key.
    try {
      const recipientCounts = new Map();
      for (const pr of payoutRecords) {
        recipientCounts.set(pr.recipientId, (recipientCounts.get(pr.recipientId) || 0) + 1);
      }
      for (const [recipientId, _addedNow] of recipientCounts.entries()) {
        if (!recipientId || recipientId === PLATFORM_ACCOUNT_ID) continue;
        const totalReceived = db.prepare(
          `SELECT COUNT(*) AS n FROM royalty_payouts WHERE recipient_id = ?`
        ).get(recipientId)?.n || 0;
        const grantsAlreadyMade = countTriggersSinceLastGrant(db, recipientId, STORAGE_REASONS.EARNED_ROYALTY);
        const targetGrants = Math.floor(totalReceived / ROYALTY_BATCH_SIZE);
        for (let g = grantsAlreadyMade + 1; g <= targetGrants; g++) {
          grantEarnedStorage(
            db,
            recipientId,
            STORAGE_REASONS.EARNED_ROYALTY,
            STORAGE_EARN_PER_ROYALTY_BATCH_BYTES,
            `royalty_batch:${recipientId}:${g}`,
          );
        }
      }
    } catch (e) {
      // Storage grants are best-effort. The royalty distribution itself
      // must never fail because of an accounting hiccup.
      try { console.warn("[royalty-cascade] storage grant failed", e?.message); } catch { /* ignore */ }
    }

    return results;
  });

  try {
    const results = doRoyalties();
    return {
      ok: true,
      batchId,
      totalRoyalties,
      payouts: payouts.map((p, i) => ({
        ...p,
        ledgerEntryId: results[i]?.id,
      })),
      transactionCount: results.length,
    };
  } catch (err) {
    console.error("[economy] royalty_distribution_failed:", err.message);
    return { ok: false, error: "royalty_distribution_failed" };
  }
}

/**
 * Get royalty history for a creator.
 */
export function getCreatorRoyalties(db, creatorId, { limit = 50, offset = 0 } = {}) {
  const items = db.prepare(`
    SELECT * FROM royalty_payouts
    WHERE recipient_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(creatorId, limit, offset);

  const total = db.prepare(
    "SELECT COUNT(*) as c FROM royalty_payouts WHERE recipient_id = ?"
  ).get(creatorId)?.c || 0;

  const totalEarned = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM royalty_payouts WHERE recipient_id = ?"
  ).get(creatorId)?.total || 0;

  return { items, total, totalEarned: Math.round(totalEarned * 100) / 100, limit, offset };
}

/**
 * Get royalty payouts for a specific content item.
 */
export function getContentRoyalties(db, contentId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT * FROM royalty_payouts
    WHERE content_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(contentId, limit);
}

/**
 * Get all descendants of a content item (items that cite it).
 */
export function getDescendants(db, contentId, maxDepth = MAX_CASCADE_DEPTH) {
  const descendants = [];
  const visited = new Set();
  const queue = [{ id: contentId, generation: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.id) || current.generation > maxDepth) continue;
    visited.add(current.id);

    const children = db.prepare(`
      SELECT child_id, creator_id, generation
      FROM royalty_lineage WHERE parent_id = ?
    `).all(current.id);

    for (const child of children) {
      const totalGeneration = current.generation + child.generation;
      if (!visited.has(child.child_id)) {
        descendants.push({
          contentId: child.child_id,
          creatorId: child.creator_id,
          generation: totalGeneration,
        });
        queue.push({ id: child.child_id, generation: totalGeneration });
      }
    }
  }

  return descendants;
}

/**
 * Check if adding a citation from childId → parentId would create a cycle.
 */
function wouldCreateCycle(db, childId, parentId) {
  // Check if parentId is already a descendant of childId
  const visited = new Set();
  const queue = [parentId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === childId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = db.prepare(
      "SELECT parent_id FROM royalty_lineage WHERE child_id = ?"
    ).all(current);

    for (const p of parents) {
      if (!visited.has(p.parent_id)) {
        queue.push(p.parent_id);
      }
    }

    // Safety: don't traverse more than MAX_CASCADE_DEPTH
    if (visited.size > MAX_CASCADE_DEPTH) break;
  }

  return false;
}

export {
  CONCORD_ROYALTY_RATE,
  CONCORD_PASSTHROUGH_RATE,
  ROYALTY_FLOOR,
  DEFAULT_INITIAL_RATE,
  MAX_CASCADE_DEPTH,
  CONCORD_SYSTEM_ID,
};
