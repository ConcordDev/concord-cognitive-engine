// server/lib/org-chat.js
//
// Firm/org chat — post + list messages scoped to an organization (migration
// 336). Posting is gated by a caller-supplied membership predicate (the same
// pattern guild-substrate uses). Reads are org-scoped; callers must confirm the
// reader is a member before exposing the result.

import crypto from "node:crypto";

const MAX_BODY = 1000;

export function postToOrgChat(db, { orgId, userId, body, isMember } = {}) {
  if (!db) return { ok: false, error: "no_db" };
  if (!orgId || !userId) return { ok: false, error: "missing_params" };
  const text = String(body || "").trim().slice(0, MAX_BODY);
  if (!text) return { ok: false, error: "empty_body" };
  if (typeof isMember === "function" && !isMember(userId)) return { ok: false, error: "not_member" };
  try {
    const id = `org_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO org_chat_messages (id, org_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, orgId, userId, text, now);
    return { ok: true, message: { id, org_id: orgId, user_id: userId, body: text, created_at: now } };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function listOrgChat(db, orgId, opts = {}) {
  if (!db || !orgId) return [];
  try {
    const limit = Math.max(1, Math.min(100, opts.limit || 30));
    return db
      .prepare(
        `SELECT id, org_id, user_id, body, created_at
           FROM org_chat_messages
          WHERE org_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(orgId, limit);
  } catch {
    return [];
  }
}
