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

  // Phase AA1 — detect cross-world citation. Read parent + child world_id;
  // if they differ, the cascade is a real cross-world hop and we stamp
  // the lineage row's metadata. Observability-only — never block citation
  // on the lookup failing.
  let parentWorldId = null;
  let childWorldId = null;
  let crossWorldHop = false;
  try {
    const colCheck = db.prepare(
      `SELECT name FROM pragma_table_info('dtus') WHERE name = 'world_id'`,
    ).get();
    if (colCheck) {
      const pRow = db.prepare(`SELECT world_id FROM dtus WHERE id = ?`).get(parentId);
      const cRow = db.prepare(`SELECT world_id FROM dtus WHERE id = ?`).get(childId);
      parentWorldId = pRow?.world_id ?? null;
      childWorldId = cRow?.world_id ?? null;
      if (parentWorldId && childWorldId && parentWorldId !== childWorldId) {
        crossWorldHop = true;
      }
    }
  } catch { /* world_id read is observability-only — never block citation */ }

  const id = uid("lin");
  try {
    db.prepare(`
      INSERT OR IGNORE INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, childId, parentId, generation, creatorId, parentCreatorId, nowISO());

    // Phase AA1 — emit a cross-world hop realtime event when applicable.
    // The cross-world feed surfacing reads this; the heatmap aggregates.
    if (crossWorldHop) {
      try {
        globalThis._concordRealtimeEmit?.("royalty:cross-world", {
          lineageId: id, parentId, childId,
          parentWorldId, childWorldId,
          generation, creatorId, parentCreatorId,
        });
      } catch { /* emit best-effort */ }
    }

    // Layer 3 signal: a citation is the strongest "the parent's content
    // proved useful" signal we have. If the parent was generated by a
    // brain interaction (production_brain_interaction_id stored on the
    // DTU), mark that interaction as positive so the daily refresh
    // weights it accordingly. Lazy-import + try/catch so this is
    // strictly additive — never blocks citation registration.
    try {
      const parentInteractionId = _resolveBrainInteractionForDtu(db, parentId);
      if (parentInteractionId) {
        import("../lib/brain-training/outcome-signals.js")
          .then(({ emitOutcomeSignal }) => {
            try {
              emitOutcomeSignal(db, parentInteractionId, "positive", {
                source: "citation_registered",
                childId, parentId, generation,
              });
            } catch { /* swallow */ }
          })
          .catch(() => { /* module may not be loaded yet */ });
      }
    } catch { /* signal emission must not affect citation outcome */ }

    // Layer 14 signal: feed the citation into the Understanding loop —
    // every active understanding of the parent gets a confirm-evidence
    // beat. Lazy-import + try/catch so this is strictly additive; the
    // citation registration must succeed regardless of the hook.
    try {
      import("../lib/understanding-consumers.js")
        .then(({ noteCitationAsEvidence }) => {
          try {
            noteCitationAsEvidence(db, { parentId, childId, lineageId: id });
          } catch { /* swallow */ }
        })
        .catch(() => { /* module may not be loaded yet */ });
    } catch { /* understanding hook must not affect citation outcome */ }

    return { ok: true, lineageId: id, childId, parentId, generation };
  } catch (err) {
    if (err.message?.includes("UNIQUE")) return { ok: true, existing: true };
    console.error("[economy] citation_registration_failed:", err.message);
    return { ok: false, error: "citation_registration_failed" };
  }
}

/**
 * Look up the brain_interaction id that produced a DTU, if any. The
 * DTU schema may not expose this column on every row — return null
 * gracefully when the lookup fails.
 *
 * Convention: when a DTU is created from a brain reply, callers store
 * the interaction id in the DTU's metadata (body_json.brainInteractionId
 * or a top-level production_brain_interaction_id column). This helper
 * checks both.
 */
function _resolveBrainInteractionForDtu(db, dtuId) {
  if (!db || !dtuId) return null;
  try {
    // Top-level column path (preferred when migration adds it).
    const colCheck = db.prepare(
      `SELECT name FROM pragma_table_info('dtus') WHERE name = 'production_brain_interaction_id'`,
    ).get();
    if (colCheck) {
      const row = db.prepare(
        `SELECT production_brain_interaction_id AS id FROM dtus WHERE id = ?`,
      ).get(dtuId);
      if (row?.id) return row.id;
    }
    // Body-json fallback path.
    const row = db.prepare(`SELECT body_json FROM dtus WHERE id = ?`).get(dtuId);
    if (row?.body_json) {
      try {
        const parsed = JSON.parse(row.body_json);
        return parsed?.brainInteractionId || parsed?.production_brain_interaction_id || null;
      } catch { return null; }
    }
  } catch { return null; }
  return null;
}

/**
 * Get the complete ancestor chain for a piece of content.
 * Returns all ancestors with their generation distance.
 *
 * Phase 2 perf fix (May 2026): single recursive CTE replaces N round-trips.
 * The MIN(generation) GROUP BY preserves BFS-shortest-path dedup semantics
 * of the prior queue-based implementation. Pinned by
 * tests/royalty-cascade-parity.test.js.
 */
export function getAncestorChain(db, contentId, maxDepth = MAX_CASCADE_DEPTH) {
  const rows = db.prepare(`
    WITH RECURSIVE chain(content_id, creator_id, generation) AS (
      SELECT parent_id, parent_creator, generation
        FROM royalty_lineage WHERE child_id = ?
      UNION ALL
      SELECT rl.parent_id, rl.parent_creator, c.generation + rl.generation
        FROM royalty_lineage rl JOIN chain c ON rl.child_id = c.content_id
       WHERE c.generation + rl.generation <= ?
    )
    SELECT content_id, creator_id, MIN(generation) AS generation
      FROM chain
     WHERE content_id != ?
     GROUP BY content_id
     ORDER BY generation ASC, content_id ASC
  `).all(contentId, maxDepth, contentId);

  return rows.map(r => ({
    contentId: r.content_id,
    creatorId: r.creator_id,
    generation: r.generation,
    rate: calculateGenerationalRate(r.generation),
  }));
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

  // Phase AA1 — fetch the child content's world_id (and each ancestor's)
  // so we can stamp crossWorldHop on the ledger metadata. Cached lookup
  // — minimal builds without the column return null and the stamp is
  // simply omitted.
  let childWorldId = null;
  const ancestorWorldIds = new Map(); // contentId → world_id
  try {
    const colCheck = db.prepare(
      `SELECT name FROM pragma_table_info('dtus') WHERE name = 'world_id'`,
    ).get();
    if (colCheck) {
      const selWorldId = db.prepare(`SELECT world_id FROM dtus WHERE id = ?`);
      const cRow = selWorldId.get(contentId);
      childWorldId = cRow?.world_id ?? null;
      for (const p of payouts) {
        const pid = p.contentId;
        if (!ancestorWorldIds.has(pid)) {
          const aRow = selWorldId.get(pid);
          ancestorWorldIds.set(pid, aRow?.world_id ?? null);
        }
      }
    }
  } catch { /* world_id read is observability-only — never block payout */ }

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
      // Phase AA1 — stamp cross-world hop on the ledger metadata when
      // the ancestor lives in a different world than the child content.
      const parentWorld = ancestorWorldIds.get(payout.contentId) ?? null;
      const crossWorldHop = !!(childWorldId && parentWorld && parentWorld !== childWorldId);

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
          // Cross-world observability. Omitted (null) when the parent or
          // child world_id is unknown so concord-link-frontier can
          // distinguish "didn't cross" from "couldn't determine".
          crossWorldHop,
          parentWorldId: parentWorld,
          childWorldId,
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
 *
 * Phase 2 perf fix: symmetric CTE shape to getAncestorChain, walking
 * parent_id → child_id instead.
 */
export function getDescendants(db, contentId, maxDepth = MAX_CASCADE_DEPTH) {
  const rows = db.prepare(`
    WITH RECURSIVE chain(content_id, creator_id, generation) AS (
      SELECT child_id, creator_id, generation
        FROM royalty_lineage WHERE parent_id = ?
      UNION ALL
      SELECT rl.child_id, rl.creator_id, c.generation + rl.generation
        FROM royalty_lineage rl JOIN chain c ON rl.parent_id = c.content_id
       WHERE c.generation + rl.generation <= ?
    )
    SELECT content_id, creator_id, MIN(generation) AS generation
      FROM chain
     WHERE content_id != ?
     GROUP BY content_id
     ORDER BY generation ASC, content_id ASC
  `).all(contentId, maxDepth, contentId);

  return rows.map(r => ({
    contentId: r.content_id,
    creatorId: r.creator_id,
    generation: r.generation,
  }));
}

/**
 * Check if adding a citation from childId → parentId would create a cycle.
 *
 * Phase 2 perf fix: single recursive CTE with LIMIT 1 short-circuit.
 * Walks UP from parentId looking for childId — if reachable, the citation
 * would close a cycle.
 */
function wouldCreateCycle(db, childId, parentId) {
  // Self-cycle: parent === child means citation creates a 1-step cycle.
  if (childId === parentId) return true;
  const hit = db.prepare(`
    WITH RECURSIVE up(id, depth) AS (
      SELECT CAST(? AS TEXT), 0
      UNION
      SELECT rl.parent_id, up.depth + 1
        FROM royalty_lineage rl JOIN up ON rl.child_id = up.id
       WHERE up.depth < ?
    )
    SELECT 1 AS hit FROM up WHERE id = ? LIMIT 1
  `).get(parentId, MAX_CASCADE_DEPTH, childId);
  return !!hit;
}

export {
  CONCORD_ROYALTY_RATE,
  CONCORD_PASSTHROUGH_RATE,
  ROYALTY_FLOOR,
  DEFAULT_INITIAL_RATE,
  MAX_CASCADE_DEPTH,
  CONCORD_SYSTEM_ID,
};
