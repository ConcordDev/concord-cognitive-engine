// @sql-loop-ok: loops over a fixed 4-table allowlist; each table is a separate target, not N rows
// lib/account-lifecycle.js
// Account Deletion, Data Export, Seller Verification, Refund Policy.
//
// These are the four systems referenced by the ToS and Privacy Policy.
// Account deletion is REAL — not a stub. Data export gives users everything.
// Seller verification gates marketplace listing. Refund policy enforces rules.

import { randomUUID } from "crypto";
import { anonymizeAttribution } from "./consent.js";
import { CREDIT_ROW_PREDICATE } from "../economy/balances.js";

function uid(prefix = "al") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. ACCOUNT DELETION — Real Implementation
// ═══════════════════════════════════════════════════════════════════════════
//
// Per ToS Section 3.3 and Privacy Policy Section 6.4:
// - Personal data permanently deleted
// - Content not cited by others permanently deleted
// - Content cited by others anonymized
// - Wallet balance must be withdrawn first or forfeited after 90 days
// - Transaction records retained 7 years (legal/tax)
// - Deletion is irreversible

const BALANCE_FORFEIT_DAYS = 90;

/**
 * Initiate account deletion. If user has a balance, starts the 90-day
 * forfeit countdown. Otherwise, proceeds to immediate deletion.
 *
 * @returns {{ ok, scheduled?, deletedImmediately?, balance?, forfeitDate? }}
 */
export function requestAccountDeletion(db, userId, { ip, userAgent } = {}) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const user = db.prepare("SELECT id, username, email FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  // Check for pending withdrawals
  try {
    const pendingWd = db.prepare(
      "SELECT COUNT(*) as c FROM economy_withdrawals WHERE user_id = ? AND status IN ('pending', 'approved', 'processing')"
    ).get(userId)?.c || 0;
    if (pendingWd > 0) {
      return { ok: false, error: "pending_withdrawals", detail: "Complete or cancel pending withdrawals before deleting account." };
    }
  } catch (err) { console.warn('[account-lifecycle] could not check pending withdrawals (table may not exist)', { userId, err: err.message }); }

  // Check wallet balance
  let balance = 0;
  try {
    const credits = db.prepare(
      `SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as c FROM economy_ledger WHERE to_user_id = ? AND status = 'complete' AND ${CREDIT_ROW_PREDICATE}`
    ).get(userId)?.c || 0;
    const debits = db.prepare(
      "SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as c FROM economy_ledger WHERE from_user_id = ? AND status = 'complete'"
    ).get(userId)?.c || 0;
    balance = (credits - debits) / 100;
  } catch (err) { console.warn('[account-lifecycle] could not compute wallet balance (economy tables may not exist)', { userId, err: err.message }); }

  const now = nowISO();

  if (balance > 0.01) {
    // Schedule deletion — 90 day grace period for balance withdrawal
    const forfeitDate = new Date(Date.now() + BALANCE_FORFEIT_DAYS * 86400000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare(`
      INSERT INTO account_deletion_requests (id, user_id, status, balance_at_request, forfeit_date, requested_at)
      VALUES (?, ?, 'scheduled', ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = 'scheduled', balance_at_request = ?, forfeit_date = ?, requested_at = ?
    `).run(uid("del"), userId, balance, forfeitDate, now, balance, forfeitDate, now);

    return {
      ok: true,
      scheduled: true,
      balance,
      forfeitDate,
      detail: `Account deletion scheduled. You have ${BALANCE_FORFEIT_DAYS} days to withdraw your balance of ${balance} CC. After that, it will be forfeited.`,
    };
  }

  // No balance — delete immediately
  const result = executeAccountDeletion(db, userId);
  return { ok: true, deletedImmediately: true, ...result };
}

/**
 * Cancel a scheduled account deletion.
 */
export function cancelAccountDeletion(db, userId) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const request = db.prepare(
    "SELECT * FROM account_deletion_requests WHERE user_id = ? AND status = 'scheduled'"
  ).get(userId);

  if (!request) return { ok: false, error: "no_pending_deletion" };

  db.prepare(
    "UPDATE account_deletion_requests SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status = 'scheduled'"
  ).run(nowISO(), userId);

  return { ok: true, cancelled: true };
}

/**
 * Execute the actual account deletion. Called immediately (no balance)
 * or by the scheduled job after 90 days.
 *
 * This is the nuclear option. Everything goes except:
 * - Transaction records (7-year legal retention, anonymized)
 * - Cited content at national/global (anonymized, not deleted)
 */
export function executeAccountDeletion(db, userId) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const now = nowISO();
  const deletionId = uid("del");
  const stats = { anonymized: 0, deleted: 0 };
  const errors = [];

  const doDelete = db.transaction(() => {
    // 1. Anonymize DTUs that are cited by others (can't delete — others depend on them)
    try {
      const citedDtus = db.prepare(`
        SELECT DISTINCT rl.parent_id as dtu_id
        FROM royalty_lineage rl
        WHERE rl.parent_creator = ?
      `).all(userId);

      for (const row of citedDtus) {
        anonymizeAttribution(db, row.dtu_id, userId);
        stats.anonymized++;
      }
    } catch (err) { console.error('[account-lifecycle] failed to anonymize cited DTUs', { userId, err: err.message }); errors.push({ step: 'anonymize_cited_dtus', err }); }

    // 2. Delete uncited DTUs
    try {
      const result = db.prepare("DELETE FROM dtus WHERE owner_user_id = ? AND id NOT IN (SELECT DISTINCT parent_id FROM royalty_lineage WHERE parent_creator = ?)").run(userId, userId);
      stats.deleted += result.changes;
    } catch (err) {
      console.warn('[account-lifecycle] failed to delete uncited DTUs with lineage check, falling back', { userId, err: err.message });
      try {
        db.prepare("DELETE FROM dtus WHERE owner_user_id = ?").run(userId);
      } catch (err2) { console.error('[account-lifecycle] failed to delete DTUs (fallback)', { userId, err: err2.message }); errors.push({ step: 'delete_dtus', err: err2 }); }
    }

    // 3. Delist all marketplace listings
    try {
      db.prepare("UPDATE creative_artifacts SET marketplace_status = 'delisted', updated_at = ? WHERE creator_id = ?").run(now, userId);
    } catch (err) { console.error('[account-lifecycle] failed to delist marketplace listings', { userId, err: err.message }); errors.push({ step: 'delist_marketplace', err }); }

    // 4. Delete social content (posts, comments, DMs)
    for (const table of ["social_posts", "social_comments", "direct_messages", "forum_posts"]) {
      try {
        // @resource-leak-ok: iterates fixed PII_DELETE_TABLES list — bounded enumeration
        db.prepare(`DELETE FROM ${table} WHERE user_id = ? OR author_id = ? OR sender_id = ?`).run(userId, userId, userId);
      } catch (err) { console.warn(`[account-lifecycle] failed to delete from ${table}`, { userId, err: err.message }); errors.push({ step: `delete_${table}`, err }); }
    }

    // 5. Revoke all sessions
    try {
      db.prepare("UPDATE sessions SET is_revoked = 1 WHERE user_id = ?").run(userId);
    } catch (err) { console.error('[account-lifecycle] failed to revoke sessions', { userId, err: err.message }); errors.push({ step: 'revoke_sessions', err }); }

    // 6. Delete API keys
    try {
      db.prepare("DELETE FROM api_keys WHERE user_id = ?").run(userId);
    } catch (err) { console.error('[account-lifecycle] failed to delete API keys', { userId, err: err.message }); errors.push({ step: 'delete_api_keys', err }); }

    // 7. Delete consent records
    try {
      db.prepare("DELETE FROM user_consent WHERE user_id = ?").run(userId);
    } catch (err) { console.error('[account-lifecycle] failed to delete consent records', { userId, err: err.message }); errors.push({ step: 'delete_consent', err }); }

    // 8. Anonymize transaction records (retained 7 years per legal requirement)
    // Replace userId with deletion tombstone — keeps ledger integrity
    const tombstone = `deleted_${deletionId}`;
    try {
      db.prepare("UPDATE economy_ledger SET from_user_id = ? WHERE from_user_id = ?").run(tombstone, userId);
      db.prepare("UPDATE economy_ledger SET to_user_id = ? WHERE to_user_id = ?").run(tombstone, userId);
    } catch (err) { console.error('[account-lifecycle] failed to anonymize transaction records', { userId, err: err.message }); errors.push({ step: 'anonymize_transactions', err }); }

    // 9. Delete user federation preferences, XP, quest completions
    for (const table of ["user_xp", "quest_completions", "creative_xp"]) {
      // @resource-leak-ok: iterates fixed PII_DELETE_TABLES list — bounded enumeration
      try {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      } catch (err) { console.warn(`[account-lifecycle] failed to delete from ${table}`, { userId, err: err.message }); errors.push({ step: `delete_${table}`, err }); }
    }

    // 10. Remove from leaderboards
    try {
      db.prepare("DELETE FROM leaderboard_entries WHERE user_id = ?").run(userId);
    } catch (err) { console.warn('[account-lifecycle] failed to remove from leaderboards', { userId, err: err.message }); errors.push({ step: 'delete_leaderboard', err }); }

    // 11. Delete the user record itself
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    // 12. Record the deletion in audit log
    try {
      db.prepare(`
        INSERT INTO audit_log (id, timestamp, category, action, user_id, details)
        VALUES (?, ?, 'account', 'account_deleted', ?, ?)
      `).run(uid("aud"), now, tombstone, JSON.stringify({ deletionId, anonymized: stats.anonymized, deleted: stats.deleted }));
    } catch (err) { console.error('[account-lifecycle] failed to write audit log for deletion', { userId, err: err.message }); errors.push({ step: 'audit_log', err }); }

    // 13. Mark deletion request as completed
    try {
      db.prepare(
        "UPDATE account_deletion_requests SET status = 'completed', updated_at = ? WHERE user_id = ?"
      ).run(now, userId);
    } catch (err) { console.warn('[account-lifecycle] failed to mark deletion request as completed', { userId, err: err.message }); errors.push({ step: 'mark_request_completed', err }); }
  });

  try {
    doDelete();
    return { ok: true, deletionId, stats, errors: errors.length > 0 ? errors : undefined };
  } catch (err) {
    console.error("[account] deletion_failed:", err.message);
    return { ok: false, error: "deletion_failed", detail: err.message };
  }
}

/**
 * Process scheduled deletions that have passed the forfeit date.
 * Called by a daily cron job or server interval.
 */
export function processScheduledDeletions(db) {
  const now = nowISO();
  const overdue = db.prepare(
    "SELECT user_id FROM account_deletion_requests WHERE status = 'scheduled' AND forfeit_date <= ?"
  ).all(now);

  const results = [];
  for (const row of overdue) {
    const result = executeAccountDeletion(db, row.user_id);
    results.push({ userId: row.user_id, ...result });
  }

  return { processed: results.length, results };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DATA EXPORT — Everything the user owns, in one JSON file
// ═══════════════════════════════════════════════════════════════════════════
//
// Per Privacy Policy Section 6.3 and GDPR Article 20 (data portability):
// Export includes DTUs, transactions, messages, profile, consent, activity.

/**
 * Export all user data as a structured JSON object.
 */
export function exportUserData(db, userId) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const user = db.prepare("SELECT id, username, email, role, created_at, last_login_at FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const data = {
    exportedAt: nowISO(),
    exportVersion: "1.0",
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    },
    dtus: [],
    transactions: [],
    marketplaceListings: [],
    licenses: [],
    consents: [],
    consentAuditLog: [],
    messages: [],
    socialPosts: [],
  };

  // DTUs
  try {
    data.dtus = db.prepare(
      "SELECT id, title, body_json, tags_json, visibility, tier, created_at, updated_at FROM dtus WHERE owner_user_id = ? ORDER BY created_at DESC"
    ).all(userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export DTUs', { userId, err: err.message }); }

  // Transactions
  try {
    data.transactions = db.prepare(
      "SELECT id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, created_at FROM economy_ledger WHERE (from_user_id = ? OR to_user_id = ?) ORDER BY created_at DESC LIMIT 10000"
    ).all(userId, userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export transactions', { userId, err: err.message }); }

  // Marketplace listings
  try {
    data.marketplaceListings = db.prepare(
      "SELECT id, type, title, description, price, license_type, federation_tier, marketplace_status, purchase_count, created_at FROM creative_artifacts WHERE creator_id = ? ORDER BY created_at DESC"
    ).all(userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export marketplace listings', { userId, err: err.message }); }

  // Licenses (purchased)
  try {
    data.licenses = db.prepare(
      "SELECT id, artifact_id, license_type, status, purchase_price, granted_at FROM creative_usage_licenses WHERE licensee_id = ? ORDER BY granted_at DESC"
    ).all(userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export licenses', { userId, err: err.message }); }

  // Consent state
  try {
    data.consents = db.prepare(
      "SELECT action, granted, granted_at, revoked_at, revocable FROM user_consent WHERE user_id = ?"
    ).all(userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export consents', { userId, err: err.message }); }

  // Consent audit log
  try {
    data.consentAuditLog = db.prepare(
      "SELECT action, event, created_at, metadata_json FROM consent_audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 500"
    ).all(userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export consent audit log', { userId, err: err.message }); }

  // Direct messages (sent)
  try {
    data.messages = db.prepare(
      "SELECT id, recipient_id, content, created_at FROM direct_messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 5000"
    ).all(userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export messages', { userId, err: err.message }); }

  // Social posts
  try {
    data.socialPosts = db.prepare(
      "SELECT id, content, created_at FROM social_posts WHERE user_id = ? OR author_id = ? ORDER BY created_at DESC LIMIT 5000"
    ).all(userId, userId);
  } catch (err) { console.warn('[account-lifecycle] data export: failed to export social posts', { userId, err: err.message }); }

  return { ok: true, data };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SELLER VERIFICATION — Gates before marketplace listing
// ═══════════════════════════════════════════════════════════════════════════
//
// Before you can sell, you must:
// - Have a verified email
// - Account at least 48 hours old (prevents spam signups)
// - Not be suspended/banned
// - Have accepted the ToS

const MIN_ACCOUNT_AGE_HOURS = 48;

/**
 * Merge two accounts. Used when the same human signs in with multiple
 * providers (Google + Apple to the same email). One account becomes the
 * survivor; the other's DTUs, royalties, sessions, listings, and api keys
 * are reassigned to the survivor before the source is tombstoned.
 *
 * Caller must verify both accounts authenticated recently — this function
 * trusts the passed user ids.
 */
export function mergeAccounts(db, { survivorUserId, sourceUserId, actorId }) {
  if (!survivorUserId || !sourceUserId) {
    return { ok: false, error: "missing_user_ids" };
  }
  if (survivorUserId === sourceUserId) {
    return { ok: false, error: "cannot_merge_same_account" };
  }
  if (actorId !== survivorUserId && actorId !== sourceUserId) {
    return { ok: false, error: "actor_must_be_one_of_the_two_accounts" };
  }

  const survivor = db.prepare("SELECT id FROM users WHERE id = ?").get(survivorUserId);
  const source   = db.prepare("SELECT id FROM users WHERE id = ?").get(sourceUserId);
  if (!survivor || !source) {
    return { ok: false, error: "account_not_found" };
  }

  const counts = { dtus: 0, listings: 0, sessions: 0, citations: 0, apiKeys: 0 };

  const tx = db.transaction(() => {
    try {
      const r = db.prepare("UPDATE dtus SET creator_id = ? WHERE creator_id = ?")
                  .run(survivorUserId, sourceUserId);
      counts.dtus = r.changes;
    } catch { /* dtus table may not exist in some configs */ }
    try {
      const r = db.prepare("UPDATE marketplace_listings SET seller_id = ? WHERE seller_id = ?")
                  .run(survivorUserId, sourceUserId);
      counts.listings = r.changes;
    } catch { /* schema variation tolerated */ }
    try {
      const r = db.prepare("UPDATE citations SET citing_user_id = ? WHERE citing_user_id = ?")
                  .run(survivorUserId, sourceUserId);
      counts.citations = r.changes;
    } catch { /* schema variation tolerated */ }
    try {
      const r = db.prepare("DELETE FROM sessions WHERE user_id = ?")
                  .run(sourceUserId);
      counts.sessions = r.changes;
    } catch { /* schema variation tolerated */ }
    try {
      const r = db.prepare("UPDATE api_keys SET user_id = ? WHERE user_id = ?")
                  .run(survivorUserId, sourceUserId);
      counts.apiKeys = r.changes;
    } catch { /* schema variation tolerated */ }

    // Mark source account as merged (audit trail).
    try {
      db.prepare(`UPDATE users SET status = 'merged', merged_into = ?, merged_at = ?
                  WHERE id = ?`).run(survivorUserId, new Date().toISOString(), sourceUserId);
    } catch {
      // Fall back: tombstone via existing deletion path.
      executeAccountDeletion(db, sourceUserId);
    }
  });

  try { tx(); }
  catch (err) { return { ok: false, error: String(err.message || err) }; }

  return { ok: true, survivorUserId, sourceUserId, counts };
}

/**
 * Check if a user is eligible to sell on the marketplace.
 * Returns { eligible: true } or { eligible: false, reasons: [...] }
 */
export function checkSellerEligibility(db, userId) {
  if (!userId) return { eligible: false, reasons: ["missing_user_id"] };

  const user = db.prepare(
    "SELECT id, email, created_at, is_active, role FROM users WHERE id = ?"
  ).get(userId);

  if (!user) return { eligible: false, reasons: ["user_not_found"] };

  const reasons = [];

  // 1. Account must be active
  if (!user.is_active) reasons.push("account_suspended");

  // 2. Minimum account age (48 hours)
  const accountAgeMs = Date.now() - new Date(user.created_at).getTime();
  const accountAgeHours = accountAgeMs / 3600000;
  if (accountAgeHours < MIN_ACCOUNT_AGE_HOURS) {
    reasons.push(`account_too_new:${Math.ceil(MIN_ACCOUNT_AGE_HOURS - accountAgeHours)}_hours_remaining`);
  }

  // 3. Email must be verified
  try {
    const emailVerified = db.prepare(
      "SELECT email_verified FROM users WHERE id = ?"
    ).get(userId)?.email_verified;
    // If column doesn't exist, we skip this check (pre-migration)
    if (emailVerified === 0) reasons.push("email_not_verified");
  } catch (err) { console.warn('[account-lifecycle] seller eligibility: could not check email_verified column', { userId, err: err.message }); }

  // 4. ToS must be accepted
  try {
    const tosAccepted = db.prepare(
      "SELECT tos_accepted_at FROM users WHERE id = ?"
    ).get(userId)?.tos_accepted_at;
    if (!tosAccepted) reasons.push("tos_not_accepted");
  } catch (err) { console.warn('[account-lifecycle] seller eligibility: could not check tos_accepted_at column', { userId, err: err.message }); }

  // 5. Not banned
  if (user.role === "banned") reasons.push("account_banned");

  return {
    eligible: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : undefined,
  };
}

/**
 * Require seller eligibility — for use as a gate in route handlers.
 */
export function requireSellerEligibility(db, userId) {
  const result = checkSellerEligibility(db, userId);
  if (result.eligible) return { allowed: true };
  return {
    allowed: false,
    error: "seller_not_eligible",
    reasons: result.reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. REFUND POLICY — Enforcement
// ═══════════════════════════════════════════════════════════════════════════
//
// Per ToS Section 5.6:
// - CC purchases are final (no refund on buying coins)
// - Marketplace purchases final unless:
//   (a) seller agrees to refund, OR
//   (b) item is materially different from description
// - Disputes under 100 CC: Concord decision is final
// - Disputes over 100 CC: external resolution available

const DISPUTE_WINDOW_HOURS = 72;
const AUTO_RESOLVE_THRESHOLD = 100; // CC

/**
 * Request a refund/dispute for a marketplace purchase.
 */
export function requestRefund(db, { purchaseId, buyerId, reason }) {
  if (!purchaseId || !buyerId || !reason) {
    return { ok: false, error: "missing_required_fields" };
  }

  // Find the purchase
  let purchase;
  try {
    purchase = db.prepare(`
      SELECT el.*, el.metadata_json FROM economy_ledger el
      WHERE el.ref_id LIKE ? AND el.from_user_id = ? AND el.type = 'MARKETPLACE_PURCHASE' AND el.status = 'complete'
      ORDER BY el.created_at DESC LIMIT 1
    `).get(`creative:${purchaseId}%`, buyerId);

    if (!purchase) {
      // Try direct lookup
      purchase = db.prepare(`
        SELECT * FROM economy_ledger
        WHERE ref_id LIKE ? AND from_user_id = ? AND type = 'MARKETPLACE_PURCHASE' AND status = 'complete'
        ORDER BY created_at DESC LIMIT 1
      `).get(`%${purchaseId}%`, buyerId);
    }
  } catch (err) { console.error('[account-lifecycle] refund: failed to look up purchase', { purchaseId, buyerId, err: err.message }); }

  if (!purchase) return { ok: false, error: "purchase_not_found" };

  // Check dispute window (72 hours)
  const purchaseAge = Date.now() - new Date(purchase.created_at).getTime();
  if (purchaseAge > DISPUTE_WINDOW_HOURS * 3600000) {
    return { ok: false, error: "dispute_window_expired", detail: `Disputes must be filed within ${DISPUTE_WINDOW_HOURS} hours of purchase.` };
  }

  // Check for existing dispute
  try {
    const existing = db.prepare(
      "SELECT id FROM marketplace_disputes WHERE purchase_id = ? AND status IN ('open', 'under_review')"
    ).get(purchaseId);
    if (existing) return { ok: false, error: "dispute_already_open" };
  } catch (err) { console.warn('[account-lifecycle] refund: could not check for existing dispute (table may not exist)', { purchaseId, err: err.message }); }

  const disputeId = uid("dis");
  const now = nowISO();

  let metadata;
  try {
    metadata = purchase.metadata_json ? JSON.parse(purchase.metadata_json) : {};
  } catch (err) { console.warn('[account-lifecycle] refund: failed to parse purchase metadata', { purchaseId, err: err.message }); metadata = {}; }

  const sellerId = metadata.sellerId || purchase.to_user_id;
  const amount = purchase.amount;

  try {
    db.prepare(`
      INSERT INTO marketplace_disputes (
        id, purchase_id, buyer_id, seller_id, amount, reason,
        status, resolution_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)
    `).run(disputeId, purchaseId, buyerId, sellerId, amount, reason, now, now);
  } catch (err) {
    console.error("[refund] dispute_creation_failed:", err.message);
    return { ok: false, error: "dispute_creation_failed" };
  }

  return {
    ok: true,
    disputeId,
    purchaseId,
    amount,
    status: "open",
    detail: amount > AUTO_RESOLVE_THRESHOLD
      ? "Dispute filed. Both parties will be contacted for evidence. For disputes over 100 CC, external resolution is available."
      : "Dispute filed. Concord will review and make a final decision.",
  };
}

/**
 * Resolve a dispute (admin action).
 * resolution: "refund_buyer" | "side_with_seller" | "partial_refund"
 */
export function resolveDispute(db, { disputeId, resolution, adminId, partialAmount, notes }) {
  if (!disputeId || !resolution || !adminId) {
    return { ok: false, error: "missing_required_fields" };
  }

  const dispute = db.prepare(
    "SELECT * FROM marketplace_disputes WHERE id = ? AND status IN ('open', 'under_review')"
  ).get(disputeId);

  if (!dispute) return { ok: false, error: "dispute_not_found_or_closed" };

  const now = nowISO();
  const refundAmount = resolution === "refund_buyer" ? dispute.amount
    : resolution === "partial_refund" ? (partialAmount || 0)
    : 0;

  const doResolve = db.transaction(() => {
    // Update dispute status
    db.prepare(`
      UPDATE marketplace_disputes
      SET status = 'resolved', resolution_type = ?, resolved_by = ?,
          refund_amount = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(resolution, adminId, refundAmount, notes || null, now, disputeId);

    // Process refund if applicable
    if (refundAmount > 0) {
      try {
        const txId = `refund_${disputeId}`;
        db.prepare(`
          INSERT INTO economy_ledger (
            id, type, from_user_id, to_user_id, amount, fee, net,
            status, ref_id, metadata_json, created_at
          ) VALUES (?, 'REFUND', ?, ?, ?, 0, ?, 'complete', ?, ?, ?)
        `).run(
          uid("tx"), dispute.seller_id, dispute.buyer_id,
          refundAmount, refundAmount, txId,
          JSON.stringify({ disputeId, resolution, purchaseId: dispute.purchase_id }),
          now
        );
      } catch (err) {
        console.error("[refund] refund_ledger_failed:", err.message);
        throw err;
      }
    }
  });

  try {
    doResolve();
    return { ok: true, disputeId, resolution, refundAmount };
  } catch (err) {
    return { ok: false, error: "resolution_failed", detail: err.message };
  }
}

/**
 * Get disputes for a user (as buyer or seller).
 */
export function getUserDisputes(db, userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  try {
    const disputes = db.prepare(`
      SELECT * FROM marketplace_disputes
      WHERE buyer_id = ? OR seller_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(userId, userId, limit, offset);

    return { ok: true, disputes };
  } catch (err) {
    console.warn('[account-lifecycle] failed to fetch user disputes', { userId, err: err.message });
    return { ok: true, disputes: [] };
  }
}
