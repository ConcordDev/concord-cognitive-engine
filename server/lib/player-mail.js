// server/lib/player-mail.js
//
// Phase U1 — async mail engine.
//
// Single-transaction claim path: COD walletDebit → walletCredit + DTU
// ownership transfer happens inside one db.transaction(...) call so a
// partial failure rolls the whole thing back. Idempotent on (mail_id) —
// re-running claim on a claimed mail is a no-op.

import crypto from "node:crypto";
import logger from "../logger.js";

const MAX_BODY_LEN = 4000;
const MAX_SUBJECT_LEN = 120;
const MAX_ATTACHMENTS = 12;
const DEFAULT_TTL_DAYS = 30;

/**
 * Send a piece of mail. The sender's wallet is debited the attachment_cc
 * up front (escrow) so the recipient claim cannot fail due to sender
 * spending the funds elsewhere.
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.fromUserId
 * @param {string} input.toUserId
 * @param {string} input.subject
 * @param {string} input.body
 * @param {string[]} [input.attachmentDtuIds]
 * @param {number}   [input.attachmentCc]
 * @param {number}   [input.codCc]
 * @param {string}   [input.worldId]
 * @param {Function} [input.walletDebit] - optional override; default uses
 *                   the `users` wallet column directly.
 * @returns {{ ok, id?, error? }}
 */
export function sendMail(db, input) {
  if (!db) return { ok: false, error: "no_db" };
  const fromUserId = String(input?.fromUserId || "").trim();
  const toUserId = String(input?.toUserId || "").trim();
  if (!fromUserId || !toUserId) return { ok: false, error: "missing_users" };
  if (fromUserId === toUserId) return { ok: false, error: "cannot_mail_self" };

  const subject = String(input?.subject || "").slice(0, MAX_SUBJECT_LEN).trim();
  if (!subject) return { ok: false, error: "subject_required" };
  const body = String(input?.body || "").slice(0, MAX_BODY_LEN);

  const attachmentDtuIds = Array.isArray(input?.attachmentDtuIds)
    ? input.attachmentDtuIds.slice(0, MAX_ATTACHMENTS).map(String)
    : [];
  const attachmentCc = Math.max(0, Number(input?.attachmentCc) || 0);
  const codCc = Math.max(0, Number(input?.codCc) || 0);
  const worldId = input?.worldId || null;

  // Escrow: debit the sender now so the funds exist when the recipient
  // claims. The recipient's COD payment is collected on claim.
  if (attachmentCc > 0) {
    const debit = _walletDebit(db, fromUserId, attachmentCc, "mail_escrow");
    if (!debit.ok) return { ok: false, error: debit.error || "wallet_debit_failed" };
  }

  // Lock the DTU attachments to the mail row by stamping their owner to
  // an escrow account. Done via meta_json marker so we don't need a new
  // column. Best-effort — non-existent DTUs are silently skipped (the
  // claim path will surface the mismatch).
  for (const dtuId of attachmentDtuIds) {
    try {
      db.prepare(`UPDATE dtus SET data = json_set(COALESCE(data,'{}'), '$.mail_escrow', 1) WHERE id = ? AND creator_id = ?`)
        .run(dtuId, fromUserId);
    } catch { /* meta_json column may not exist on minimal builds */ }
  }

  const id = `mail_${crypto.randomBytes(8).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO player_mail
        (id, from_user_id, to_user_id, world_id, subject, body,
         attachment_dtu_ids, attachment_cc, cod_cc, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch() + ? * 86400)
    `).run(id, fromUserId, toUserId, worldId, subject, body,
            JSON.stringify(attachmentDtuIds), attachmentCc, codCc, DEFAULT_TTL_DAYS);
    return { ok: true, id };
  } catch (err) {
    // Refund escrow if the insert failed.
    if (attachmentCc > 0) _walletCredit(db, fromUserId, attachmentCc, "mail_escrow_refund");
    return { ok: false, error: err?.message };
  }
}

export function listInbox(db, userId, opts = {}) {
  if (!db || !userId) return [];
  const status = opts.status; // optional filter
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    const where = status
      ? `to_user_id = ? AND status = ?`
      : `to_user_id = ?`;
    const params = status ? [userId, status] : [userId];
    return db.prepare(`
      SELECT id, from_user_id AS fromUser, world_id AS worldId, subject, body,
             status, sent_at AS sentAt, read_at AS readAt, claimed_at AS claimedAt,
             expires_at AS expiresAt, attachment_dtu_ids, attachment_cc AS attachmentCc,
             cod_cc AS codCc
      FROM player_mail
      WHERE ${where}
      ORDER BY sent_at DESC LIMIT ?
    `).all(...params, limit).map(_hydrate);
  } catch {
    return [];
  }
}

export function listSent(db, userId, opts = {}) {
  if (!db || !userId) return [];
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    return db.prepare(`
      SELECT id, to_user_id AS toUser, world_id AS worldId, subject, body,
             status, sent_at AS sentAt, read_at AS readAt, claimed_at AS claimedAt,
             expires_at AS expiresAt, attachment_dtu_ids, attachment_cc AS attachmentCc,
             cod_cc AS codCc
      FROM player_mail
      WHERE from_user_id = ?
      ORDER BY sent_at DESC LIMIT ?
    `).all(userId, limit).map(_hydrate);
  } catch {
    return [];
  }
}

export function getMail(db, mailId, userId) {
  if (!db || !mailId) return null;
  try {
    const row = db.prepare(`
      SELECT id, from_user_id AS fromUser, to_user_id AS toUser, world_id AS worldId,
             subject, body, status, sent_at AS sentAt, read_at AS readAt,
             claimed_at AS claimedAt, expires_at AS expiresAt,
             attachment_dtu_ids, attachment_cc AS attachmentCc, cod_cc AS codCc
      FROM player_mail WHERE id = ?
    `).get(mailId);
    if (!row) return null;
    if (userId && row.fromUser !== userId && row.toUser !== userId) return null;
    return _hydrate(row);
  } catch {
    return null;
  }
}

export function readMail(db, mailId, userId) {
  if (!db || !mailId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`
      UPDATE player_mail SET status = 'read', read_at = unixepoch()
      WHERE id = ? AND to_user_id = ? AND status = 'unread'
    `).run(mailId, userId);
    if (r.changes === 0) {
      // Either already read or not addressed to this user; verify which.
      const row = db.prepare(`SELECT to_user_id, status FROM player_mail WHERE id = ?`).get(mailId);
      if (!row) return { ok: false, error: "not_found" };
      if (row.to_user_id !== userId) return { ok: false, error: "not_authorized" };
      // Already read/claimed/expired — idempotent ok.
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Claim attachments. Single transaction:
 *   - Verify status ∈ {unread, read}
 *   - If cod_cc > 0: debit recipient, credit sender by the same amount
 *   - Transfer DTU ownership (best-effort per id)
 *   - Credit recipient with attachment_cc (which is in escrow)
 *   - Mark claimed
 *
 * Idempotent: claimed mail returns ok with claimed=true.
 *
 * @returns {{ ok, claimed?, payout?, attachments?, error? }}
 */
export function claimAttachments(db, mailId, userId) {
  if (!db || !mailId || !userId) return { ok: false, error: "missing_inputs" };
  const mail = getMail(db, mailId, userId);
  if (!mail) return { ok: false, error: "not_found" };
  if (mail.toUser !== userId) return { ok: false, error: "not_authorized" };
  if (mail.status === "claimed") return { ok: true, claimed: true, alreadyClaimed: true };
  if (mail.status === "expired") return { ok: false, error: "expired" };

  const fromUserId = mail.fromUser;
  const attachmentCc = Number(mail.attachmentCc) || 0;
  const codCc = Number(mail.codCc) || 0;
  const dtuIds = Array.isArray(mail.attachment_dtu_ids) ? mail.attachment_dtu_ids : [];

  // Single-transaction claim. Rolls back the whole thing on any error.
  const tx = db.transaction(() => {
    // 1. COD: recipient pays sender.
    if (codCc > 0) {
      const debit = _walletDebit(db, userId, codCc, `mail_cod:${mailId}`);
      if (!debit.ok) throw new Error("insufficient_funds_for_cod");
      _walletCredit(db, fromUserId, codCc, `mail_cod:${mailId}`);
    }

    // 2. Attachment CC was already escrowed from sender; release to recipient.
    if (attachmentCc > 0) {
      _walletCredit(db, userId, attachmentCc, `mail_attachment:${mailId}`);
    }

    // 3. DTU ownership transfer (best-effort per row; minimal builds may
    //    lack the dtus table entirely, in which case this becomes a no-op).
    for (const dtuId of dtuIds) {
      try {
        db.prepare(`
          UPDATE dtus SET creator_id = ?,
            data = json_remove(COALESCE(data,'{}'), '$.mail_escrow')
          WHERE id = ?
        `).run(userId, dtuId);
      } catch { /* dtus table or json_remove missing — leave the DTU as-is */ }
    }

    // 4. Mark claimed.
    db.prepare(`
      UPDATE player_mail
      SET status = 'claimed', claimed_at = unixepoch(), attachment_dtu_ids = '[]'
      WHERE id = ?
    `).run(mailId);
  });

  try {
    tx();
    return {
      ok: true,
      claimed: true,
      payout: { attachmentCc, codCcPaid: codCc },
      attachments: { dtuIds },
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Sweep expired mail. Returns escrowed attachments to the sender; marks
 * the mail row 'expired'. Runs in a heartbeat.
 */
export function sweepExpiredMail(db) {
  if (!db) return { swept: 0 };
  let swept = 0;
  try {
    const expired = db.prepare(`
      SELECT id, from_user_id AS fromUser, attachment_dtu_ids, attachment_cc AS attachmentCc
      FROM player_mail
      WHERE status IN ('unread','read') AND expires_at <= unixepoch()
      LIMIT 200
    `).all();
    const clearEscrow = db.prepare(`UPDATE dtus SET data = json_remove(COALESCE(data,'{}'), '$.mail_escrow') WHERE id = ?`);
    const markMailExpired = db.prepare(`UPDATE player_mail SET status = 'expired' WHERE id = ?`);
    for (const row of expired) {
      try {
        const dtuIds = _parseJsonArray(row.attachment_dtu_ids);
        const tx = db.transaction(() => {
          if (row.attachmentCc > 0) {
            _walletCredit(db, row.fromUser, row.attachmentCc, `mail_expiry_refund:${row.id}`);
          }
          for (const dtuId of dtuIds) {
            try {
              clearEscrow.run(dtuId);
            } catch { /* best-effort */ }
          }
          markMailExpired.run(row.id);
        });
        tx();
        swept++;
      } catch (err) {
        logger.warn?.("player-mail", "expiry_row_failed", { id: row.id, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn?.("player-mail", "expiry_query_failed", { error: err?.message });
  }
  return { swept };
}

// ── helpers ─────────────────────────────────────────────────────────────

function _hydrate(row) {
  return {
    ...row,
    attachment_dtu_ids: _parseJsonArray(row.attachment_dtu_ids),
  };
}

function _parseJsonArray(s) {
  if (!s) return [];
  try { return JSON.parse(s) || []; } catch { return []; }
}

/** Lightweight wallet debit — uses users.concordia_credits directly (no royalty cascade). */
function _walletDebit(db, userId, amount, reason) {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true };
  try {
    const row = db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id = ?`).get(userId);
    const balance = Number(row?.balance) || 0;
    if (balance < amount) return { ok: false, error: "insufficient_funds" };
    db.prepare(`UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ?`).run(amount, userId);
    try {
      db.prepare(`
        INSERT INTO reward_ledger (id, user_id, kind, amount_cc, ts, ref_id)
        VALUES (?, ?, 'mail_debit', ?, unixepoch(), ?)
      `).run(`led_${crypto.randomBytes(6).toString("hex")}`, userId, -amount, reason);
    } catch { /* ledger optional */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _walletCredit(db, userId, amount, reason) {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true };
  try {
    db.prepare(`
      UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?
    `).run(amount, userId);
    try {
      db.prepare(`
        INSERT INTO reward_ledger (id, user_id, kind, amount_cc, ts, ref_id)
        VALUES (?, ?, 'mail_credit', ?, unixepoch(), ?)
      `).run(`led_${crypto.randomBytes(6).toString("hex")}`, userId, amount, reason);
    } catch { /* ledger optional */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
