// server/lib/activitypub-bridge.js
//
// Phase 6 (idea #21) — ActivityPub / FASP bridge.
//
// Concord becomes a Fediverse Auxiliary Service Provider (FASP): when a
// DTU is minted on this instance, it can be announced as an ActivityPub
// `Note` activity that other instances follow. The cognitive substrate
// underneath (DTU compression, citation cascade, drift detection)
// becomes a value-add on top of the standard AP outbox/inbox model.
//
// This module is the SCAFFOLD — outbox emit + actor descriptor + the
// minimal Activity shapes required for federation discovery. Inbox
// processing (incoming follows / likes / replies) is a separate sprint.
//
// Designed so the entire bridge degrades to a no-op when
// `CONCORD_ACTIVITYPUB=true` is not set, so non-federated deployments
// pay zero cost.
//
// References:
//   - ActivityPub W3C: https://www.w3.org/TR/activitypub/
//   - FASP roadmap: https://activitypub.blog/2026/02/11/roadmap-2026-...
//   - ActivityStreams 2.0: https://www.w3.org/TR/activitystreams-vocabulary/

import crypto from "node:crypto";

const ENABLED = process.env.CONCORD_ACTIVITYPUB === "true";
const BASE_URL = process.env.CONCORD_BASE_URL || "https://concord-os.org";

/**
 * Build the actor object for a Concord user — the federation-visible
 * persona other AP instances follow / mention. Conforms to the
 * ActivityStreams `Person` type.
 */
export function buildActor(userId, { displayName, summary, iconUrl } = {}) {
  if (!userId) return null;
  const id = `${BASE_URL}/users/${encodeURIComponent(userId)}`;
  return {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
    type: "Person",
    id,
    preferredUsername: userId,
    name: displayName || userId,
    summary: summary || "",
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: process.env.CONCORD_AP_PUBLIC_KEY_PEM || "",
    },
    icon: iconUrl ? { type: "Image", mediaType: "image/png", url: iconUrl } : undefined,
  };
}

/**
 * Compose an AP `Create` activity wrapping a `Note` for a minted DTU.
 * Conservative — Note content is the DTU's title + summary only,
 * leaving the body in the marketplace for citation/purchase. Other
 * instances see "X minted Y, click here to read on Concord."
 */
export function composeDtuCreateActivity(dtu, actorUserId) {
  if (!dtu?.id) return null;
  const actorId = `${BASE_URL}/users/${encodeURIComponent(actorUserId)}`;
  const noteId = `${BASE_URL}/dtus/${encodeURIComponent(dtu.id)}/note`;
  const summary = (dtu.summary || dtu.title || "").slice(0, 280);

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: `${noteId}/create-${crypto.randomBytes(4).toString("hex")}`,
    actor: actorId,
    published: new Date().toISOString(),
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: {
      type: "Note",
      id: noteId,
      attributedTo: actorId,
      content: `<p><strong>${escapeHtml(dtu.title || "Untitled DTU")}</strong></p><p>${escapeHtml(summary)}</p><p><a href="${BASE_URL}/dtus/${encodeURIComponent(dtu.id)}">Read on Concord</a></p>`,
      published: new Date().toISOString(),
      url: `${BASE_URL}/dtus/${encodeURIComponent(dtu.id)}`,
      tag: (dtu.tags || []).map(t => ({ type: "Hashtag", name: `#${t}` })),
    },
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Append an outbox row. Designed to be called fire-and-forget after
 * `mintForgeAppAsDtu` / `mintSpell` / etc. — the row sits in
 * `activitypub_outbox` and the federation tick (separate concern) can
 * deliver to follower inboxes when a real federation backend is wired.
 */
export function appendOutbox(db, userId, activity) {
  if (!ENABLED) return { ok: false, reason: "disabled" };
  if (!db || !userId || !activity) return { ok: false, reason: "missing_inputs" };
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activitypub_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        activity_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        activity_json TEXT NOT NULL,
        published_at INTEGER NOT NULL DEFAULT (unixepoch()),
        delivered INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ap_outbox_user_pub ON activitypub_outbox(user_id, published_at DESC)`);
    db.prepare(`
      INSERT INTO activitypub_outbox (user_id, activity_id, activity_type, activity_json)
      VALUES (?, ?, ?, ?)
    `).run(userId, activity.id, activity.type, JSON.stringify(activity));
    return { ok: true, activityId: activity.id };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

/**
 * Read an actor's outbox for federation consumers. Pages backwards by
 * published_at so AP collections render correctly with `next`/`prev`.
 */
export function readOutbox(db, userId, { limit = 20, before = null } = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activitypub_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        activity_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        activity_json TEXT NOT NULL,
        published_at INTEGER NOT NULL DEFAULT (unixepoch()),
        delivered INTEGER NOT NULL DEFAULT 0
      )
    `);
    const cursor = before ? Number(before) : Date.now() / 1000 + 1;
    const rows = db.prepare(`
      SELECT activity_id, activity_type, activity_json, published_at
      FROM activitypub_outbox
      WHERE user_id = ? AND published_at < ?
      ORDER BY published_at DESC LIMIT ?
    `).all(userId, cursor, Math.min(100, Math.max(1, Number(limit) || 20)));
    return {
      ok: true,
      items: rows.map(r => ({
        id: r.activity_id,
        type: r.activity_type,
        published: r.published_at,
        ...JSON.parse(r.activity_json),
      })),
    };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export const _internal = {
  ENABLED, BASE_URL, escapeHtml,
};
