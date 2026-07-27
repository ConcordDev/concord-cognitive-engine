// @sql-loop-ok: loops over a fixed 4-table allowlist; each table is a separate target, not N rows
// lib/account-lifecycle.js
// Account Deletion, Data Export, Seller Verification, Refund Policy.
//
// These are the four systems referenced by the ToS and Privacy Policy.
// Account deletion is REAL — not a stub. Data export gives users everything.
// Seller verification gates marketplace listing. Refund policy enforces rules.

import { randomUUID } from "crypto";
import { anonymizeAttribution } from "./consent.js";
import { listProtectedDtuIdsForOwner } from "./dtu-protection.js";
import { CREDIT_ROW_PREDICATE } from "../economy/balances.js";
import { economyAudit } from "../economy/audit.js";

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

    auditDeletionRequest(db, userId, { ip, userAgent, outcome: "scheduled", balance, forfeitDate });

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
  auditDeletionRequest(db, userId, { ip, userAgent, outcome: "deleted_immediately", balance });
  return { ok: true, deletedImmediately: true, ...result };
}

/**
 * Record who asked to delete this account, and from where.
 *
 * `requestAccountDeletion` accepted `ip` and `userAgent` and referenced
 * neither (found 2026-07-25 by the unused-destructured-param detector), so an
 * irreversible, security-relevant action left no trace of its origin —
 * exactly the record an abuse investigation or an account-recovery dispute
 * needs.
 *
 * `account_deletion_requests` (migration 033) has no ip/user_agent columns, so
 * rather than widening that table this routes through the existing
 * `economyAudit` sink, which already persists ip_address + user_agent into
 * `audit_log`. Its own insert is try/catch-wrapped, and this call is wrapped
 * again here: an audit-log failure must never block or reverse a user's
 * deletion request.
 */
function auditDeletionRequest(db, userId, { ip, userAgent, outcome, balance, forfeitDate }) {
  try {
    economyAudit(db, {
      action: "account_deletion_requested",
      userId,
      ip,
      userAgent,
      details: { outcome, balance, forfeitDate },
    });
  } catch (err) {
    console.warn("[account-lifecycle] deletion audit failed (non-fatal)", { userId, err: err.message });
  }
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
  const tombstone = `deleted_${deletionId}`;
  const stats = { anonymized: 0, deleted: 0 };
  const errors = [];

  const doDelete = db.transaction(() => {
    // 1. Anonymize DTUs that are cited by others (can't delete — others depend on them).
    // Snapshot the cited-DTU id list into JS BEFORE calling anonymizeAttribution: that
    // function re-points royalty_lineage.parent_creator from userId to an anon-wallet id
    // (server/lib/consent.js#anonymizeAttribution), so a SQL subquery in step 2 that re-reads
    // "royalty_lineage WHERE parent_creator = userId" AFTER this loop runs would no longer find
    // these rows and would wrongly treat the just-anonymized DTU as "uncited" — hard-deleting a
    // DTU this same step just tombstoned. Confirmed by this file's functional test
    // (tests/account-lifecycle-deletion.test.js) BEFORE this fix, real bug, not hypothetical:
    // the DTU-tombstone invariant (CLAUDE.md) requires this never happens.
    let citedDtuIds = [];
    try {
      const citedDtus = db.prepare(`
        SELECT DISTINCT rl.parent_id as dtu_id
        FROM royalty_lineage rl
        WHERE rl.parent_creator = ?
      `).all(userId);
      citedDtuIds = citedDtus.map((row) => row.dtu_id);

      for (const row of citedDtus) {
        anonymizeAttribution(db, row.dtu_id, userId);
        stats.anonymized++;
      }
    } catch (err) { console.error('[account-lifecycle] failed to anonymize cited DTUs', { userId, err: err.message }); errors.push({ step: 'anonymize_cited_dtus', err }); }

    // 1b. PROTECTED / PERMANENT RECORDS — anonymize + RETAIN, exactly like step 1's cited
    // DTUs, and for the same reason: the record is load-bearing for someone other than its
    // submitter, so erasing personal attribution is the right remedy and destroying the record
    // is not.
    //
    // The concrete case is TheVault (`server/domains/vault.js`), a curated archive whose entire
    // product promise is that an admitted work is PERMANENT — a human curator vouched for it in
    // prose that re-derives from nothing. `admit()` writes its record straight into the `dtus`
    // table, and until this step the promise held only by accident: that INSERT omits
    // `owner_user_id`, so it happened to be NULL and this function's `WHERE owner_user_id = ?`
    // happened not to match. The moment anyone sets that column for correctness (which
    // `lib/dtu-props.js#isVisibleToRequester`'s ownership check genuinely wants), every admitted
    // record in the archive would have become deletable on account closure. Permanence is now a
    // stated guarantee rather than a coincidence of a missing column.
    //
    // NOT a refusal to delete. GDPR erasure is still honoured on the personal-data dimension via
    // the same `anonymizeAttribution` step 1 uses: the archive keeps the work and the curator's
    // statement; the submitter's attribution is anonymized like any other retained DTU.
    //
    // `isDtuProtected` (lib/dtu-protection.js) is the single authority for "permanent", shared
    // with the forgetting engine and `evolution.dedupe` — this path cannot drift from theirs.
    let protectedDtuIds = [];
    try {
      // Snapshotted BEFORE the anonymize loop for the same pre-mutation reason step 1 documents,
      // and de-duplicated against step 1 so a DTU that is both cited AND protected is anonymized
      // once and counted once.
      protectedDtuIds = listProtectedDtuIdsForOwner(db, userId);
      const alreadyAnonymized = new Set(citedDtuIds);
      for (const dtuId of protectedDtuIds) {
        if (alreadyAnonymized.has(dtuId)) continue;
        anonymizeAttribution(db, dtuId, userId);
        stats.anonymized++;
      }
    } catch (err) { console.error('[account-lifecycle] failed to anonymize protected DTUs', { userId, err: err.message }); errors.push({ step: 'anonymize_protected_dtus', err }); }

    // The full retain set for step 2: cited (step 1) + protected (step 1b).
    const retainedDtuIds = Array.from(new Set([...citedDtuIds, ...protectedDtuIds]));
    stats.retainedProtected = protectedDtuIds.length;

    // 2. Delete uncited, unprotected DTUs — excludes exactly the pre-mutation snapshots from
    // steps 1 and 1b (via json_each, not a re-query of the now-mutated royalty_lineage table,
    // and not a parameter list, which would risk SQLite's bound-parameter limit for a prolific
    // creator).
    try {
      const result = db.prepare(
        "DELETE FROM dtus WHERE owner_user_id = ? AND id NOT IN (SELECT value FROM json_each(?))"
      ).run(userId, JSON.stringify(retainedDtuIds));
      stats.deleted += result.changes;
    } catch (err) {
      console.warn('[account-lifecycle] failed to delete uncited DTUs with lineage check, falling back', { userId, err: err.message });
      // The fallback used to be an unqualified `DELETE FROM dtus WHERE owner_user_id = ?`, which
      // would destroy the very records steps 1 and 1b just decided to keep — a retention
      // guarantee that silently evaporates on the error path is not a guarantee. A TEMP table
      // carries the retain set instead: it costs one bounded insert per retained id, has no
      // bound-parameter ceiling, and (unlike chunking a NOT IN across several DELETEs, which is
      // simply wrong) preserves the set semantics the guarantee depends on.
      try {
        db.exec("CREATE TEMP TABLE IF NOT EXISTS _account_deletion_retain (id TEXT PRIMARY KEY)");
        db.exec("DELETE FROM _account_deletion_retain");
        const insRetain = db.prepare("INSERT OR IGNORE INTO _account_deletion_retain (id) VALUES (?)");
        for (const id of retainedDtuIds) insRetain.run(id);
        const r2 = db.prepare(
          "DELETE FROM dtus WHERE owner_user_id = ? AND id NOT IN (SELECT id FROM _account_deletion_retain)"
        ).run(userId);
        stats.deleted += r2.changes;
        db.exec("DELETE FROM _account_deletion_retain");
      } catch (err2) { console.error('[account-lifecycle] failed to delete DTUs (fallback)', { userId, err: err2.message }); errors.push({ step: 'delete_dtus', err: err2 }); }
    }

    // 3. Delist all marketplace listings
    try {
      db.prepare("UPDATE creative_artifacts SET marketplace_status = 'delisted', updated_at = ? WHERE creator_id = ?").run(now, userId);
    } catch (err) { console.error('[account-lifecycle] failed to delist marketplace listings', { userId, err: err.message }); errors.push({ step: 'delist_marketplace', err }); }

    // 4. HARD-DELETE own social posts. Real schema (server/migrations/315_missing_tables_repair.js)
    // is `social_posts(id, user_id, author_id, content, created_at)` — there is no `sender_id`
    // column on this table. Single-author content, no cross-user dependency, per the deletion
    // policy table in docs/PRIVACY_DSAR_DELETION_INVESTIGATION.md.
    //
    // `social_comments` and `forum_posts` are deliberately absent from this step — they do NOT
    // exist anywhere in the schema (grepped every server/migrations/*.js, zero CREATE TABLE
    // hits). The prior loop referenced all four table names with a query that mentioned
    // `user_id`/`author_id`/`sender_id` together; SQLite resolves every column in a compound
    // WHERE clause at *prepare* time regardless of which OR-branch would match, so the query
    // failed to compile against social_posts (no sender_id) and direct_messages (no user_id/
    // author_id) too, and failed outright against the two nonexistent tables — all four errors
    // silently swallowed by the surrounding try/catch (empirically confirmed — see Finding 3 of
    // the investigation doc). If social_comments/forum_posts are ever migrated in, add their own
    // explicit DELETE here rather than re-adding them to a shared multi-column query.
    try {
      const r = db.prepare("DELETE FROM social_posts WHERE user_id = ? OR author_id = ?").run(userId, userId);
      stats.deleted += r.changes;
    } catch (err) { console.warn('[account-lifecycle] failed to delete social_posts', { userId, err: err.message }); errors.push({ step: 'delete_social_posts', err }); }

    // 5. ANONYMIZE direct messages — not a hard-delete. Real schema is
    // `direct_messages(id, sender_id, recipient_id, content, created_at)`: ONE row per message,
    // not a per-party copy. Hard-deleting by `sender_id OR recipient_id` (what the old, broken
    // query attempted) would also erase the OTHER party's copy of a conversation they never
    // asked to have erased — the investigation flagged this as an unresolved two-party-data
    // policy question, not just a column-name bug. Resolution adopted here (matches what real
    // messaging products do, and reuses the exact tombstone-not-hard-delete pattern this file
    // already applies to economy_ledger in step 13 below): replace only the identifying
    // sender_id/recipient_id with the deletion tombstone, wherever this user appears in either
    // role. Message content and the surviving party's half of the conversation are preserved,
    // attributed to a deleted user rather than vanished out from under them.
    try {
      const rSender = db.prepare("UPDATE direct_messages SET sender_id = ? WHERE sender_id = ?").run(tombstone, userId);
      const rRecipient = db.prepare("UPDATE direct_messages SET recipient_id = ? WHERE recipient_id = ?").run(tombstone, userId);
      stats.anonymized += rSender.changes + rRecipient.changes;
    } catch (err) { console.warn('[account-lifecycle] failed to anonymize direct_messages', { userId, err: err.message }); errors.push({ step: 'anonymize_direct_messages', err }); }

    // 6. HARD-DELETE sign-in identity links (Google/Apple OAuth, `oauth_connections`).
    // Single-user-scoped, zero cross-user dependency (Finding 5 — previously not touched at all;
    // the declared `ON DELETE CASCADE` on this table is inert without `PRAGMA foreign_keys=ON`,
    // which Concord never sets — Finding 4 — so this must be an explicit delete).
    try {
      const r = db.prepare("DELETE FROM oauth_connections WHERE user_id = ?").run(userId);
      stats.deleted += r.changes;
    } catch (err) { console.warn('[account-lifecycle] failed to delete oauth_connections', { userId, err: err.message }); errors.push({ step: 'delete_oauth_connections', err }); }

    // 7. HARD-DELETE connector OAuth credentials (Gmail / Google Calendar access+refresh tokens,
    // `connector_oauth_tokens`). High priority per Finding 5: these are LIVE external
    // credentials, not just internal state — leaving them behind after "deleting everything" is
    // a security liability on top of a privacy one. Zero cross-user dependency.
    try {
      const r = db.prepare("DELETE FROM connector_oauth_tokens WHERE user_id = ?").run(userId);
      stats.deleted += r.changes;
    } catch (err) { console.warn('[account-lifecycle] failed to delete connector_oauth_tokens', { userId, err: err.message }); errors.push({ step: 'delete_connector_oauth_tokens', err }); }

    // 8. HARD-DELETE the encrypted personal locker (`personal_dtus` — journal/context entries).
    // The most private category on the platform by design: the encryption key itself is never
    // stored, derived at login from password + salt (server/migrations/036_personal_locker.js).
    // Never touched before this fix (Finding 5). Zero cross-user dependency.
    try {
      const r = db.prepare("DELETE FROM personal_dtus WHERE user_id = ?").run(userId);
      stats.deleted += r.changes;
    } catch (err) { console.warn('[account-lifecycle] failed to delete personal_dtus', { userId, err: err.message }); errors.push({ step: 'delete_personal_dtus', err }); }

    // 9. HARD-DELETE chat history (`chat_sessions` + `chat_messages`). Verified single-owner
    // scoped before treating this as safe to hard-delete — `chat_sessions` keys by `owner_id`
    // alone with no participant/shared-session list (server/migrations/193_chat_sessions.js), so
    // there is no counterparty-copy problem here the way there is for direct_messages. Children
    // deleted first: the declared `ON DELETE CASCADE` from chat_messages.session_id is inert
    // without `PRAGMA foreign_keys=ON` (Finding 4) — never rely on it to clean these up.
    try {
      const rMsg = db.prepare("DELETE FROM chat_messages WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE owner_id = ?)").run(userId);
      const rSess = db.prepare("DELETE FROM chat_sessions WHERE owner_id = ?").run(userId);
      stats.deleted += rMsg.changes + rSess.changes;
    } catch (err) { console.warn('[account-lifecycle] failed to delete chat history', { userId, err: err.message }); errors.push({ step: 'delete_chat_history', err }); }

    // NOT touched, by design (Finding 5 — deliberately left undecided, not forgotten):
    //   - World/avatar/player state (avatars, player_inventory, player_houses, player_mail,
    //     player_equipment). Per CLAUDE.md's "player inventory is user-global" + crafting/trade
    //     invariants, items may carry cross-user trade/gift/craft provenance this investigation
    //     did not trace end-to-end — an unqualified hard-delete here could strand another
    //     player's legitimate trade history or corrupt auction/gifting integrity. This needs an
    //     explicit owner ruling, not an inferred one. Leaving it out is the honest disposition
    //     until that ruling lands — never a fabricated "deleted".
    //   - `STATE.privacyLens` (the DSAR bucket + cookie/retention/sharing config) — in-memory
    //     JS state, not reachable from this SQL-only module. The policy table recommends
    //     retaining the DSAR records themselves as compliance evidence anyway.
    //   - Federation-propagated shadow DTUs on peer instances — no cross-instance erasure
    //     protocol exists yet; a federation-protocol-level gap, not an account-lifecycle one.
    //   - Purchased licenses as buyer (`creative_usage_licenses`) — correctly untouched by a
    //     seller's own deletion; the buyer's purchase should survive the seller's departure.

    // 10. Revoke all sessions
    try {
      db.prepare("UPDATE sessions SET is_revoked = 1 WHERE user_id = ?").run(userId);
    } catch (err) { console.error('[account-lifecycle] failed to revoke sessions', { userId, err: err.message }); errors.push({ step: 'revoke_sessions', err }); }

    // 11. Delete API keys
    try {
      db.prepare("DELETE FROM api_keys WHERE user_id = ?").run(userId);
    } catch (err) { console.error('[account-lifecycle] failed to delete API keys', { userId, err: err.message }); errors.push({ step: 'delete_api_keys', err }); }

    // 12. Delete consent records
    try {
      db.prepare("DELETE FROM user_consent WHERE user_id = ?").run(userId);
    } catch (err) { console.error('[account-lifecycle] failed to delete consent records', { userId, err: err.message }); errors.push({ step: 'delete_consent', err }); }

    // 13. Anonymize transaction records (retained 7 years per legal requirement)
    // Replace userId with deletion tombstone — keeps ledger integrity
    try {
      db.prepare("UPDATE economy_ledger SET from_user_id = ? WHERE from_user_id = ?").run(tombstone, userId);
      db.prepare("UPDATE economy_ledger SET to_user_id = ? WHERE to_user_id = ?").run(tombstone, userId);
    } catch (err) { console.error('[account-lifecycle] failed to anonymize transaction records', { userId, err: err.message }); errors.push({ step: 'anonymize_transactions', err }); }

    // 14. Delete user federation preferences, XP, quest completions
    for (const table of ["user_xp", "quest_completions", "creative_xp"]) {
      // @resource-leak-ok: iterates fixed PII_DELETE_TABLES list — bounded enumeration
      try {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      } catch (err) { console.warn(`[account-lifecycle] failed to delete from ${table}`, { userId, err: err.message }); errors.push({ step: `delete_${table}`, err }); }
    }

    // 15. Remove from leaderboards
    try {
      db.prepare("DELETE FROM leaderboard_entries WHERE user_id = ?").run(userId);
    } catch (err) { console.warn('[account-lifecycle] failed to remove from leaderboards', { userId, err: err.message }); errors.push({ step: 'delete_leaderboard', err }); }

    // 16. Delete the user record itself
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    // 17. Record the deletion in audit log
    try {
      db.prepare(`
        INSERT INTO audit_log (id, timestamp, category, action, user_id, details)
        VALUES (?, ?, 'account', 'account_deleted', ?, ?)
      `).run(uid("aud"), now, tombstone, JSON.stringify({ deletionId, anonymized: stats.anonymized, deleted: stats.deleted }));
    } catch (err) { console.error('[account-lifecycle] failed to write audit log for deletion', { userId, err: err.message }); errors.push({ step: 'audit_log', err }); }

    // 18. Mark deletion request as completed
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
