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

// ── Inbox (Phase 8.2) ──────────────────────────────────────────────────────
//
// Receive incoming Follow / Like / Note / Create / Announce activities
// from federated peers. Conforms to W3C ActivityPub §7 (inbox processing):
//   1. Verify HTTP signature (when CONCORD_AP_REQUIRE_SIGNATURE=true)
//   2. Dedup by activity.id
//   3. Persist activity to activitypub_inbox
//   4. Dispatch to type-specific handler
//   5. Return 202 Accepted before async processing completes
//
// HTTP signature verification is intentionally pluggable — the spec
// requires it for Mastodon/Pleroma interop, but local development +
// trusted-peer setups can run without signatures by leaving the env
// flag unset. This matches the dariusk/express-activitypub reference.

const SIGNATURE_REQUIRED = process.env.CONCORD_AP_REQUIRE_SIGNATURE === "true";

/**
 * Receive an activity into the local inbox. Idempotent on activity.id.
 * Dispatches by activity.type to the appropriate handler. Returns
 * { ok, accepted, deduped?, dispatched? }.
 *
 * @param {object} db
 * @param {string} recipientUserId — the local user whose inbox this is
 * @param {object} activity — parsed JSON-LD activity
 * @param {object} headers — request headers (for signature verification)
 */
export async function receiveActivity(db, recipientUserId, activity, headers = {}) {
  if (!ENABLED) return { ok: false, reason: "disabled" };
  if (!db || !recipientUserId || !activity) return { ok: false, reason: "missing_inputs" };
  if (!activity.id || !activity.type) return { ok: false, reason: "missing_activity_fields" };

  // Lazy create.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activitypub_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_user_id TEXT NOT NULL,
        activity_id TEXT NOT NULL UNIQUE,
        activity_type TEXT NOT NULL,
        actor_url TEXT,
        activity_json TEXT NOT NULL,
        received_at INTEGER NOT NULL DEFAULT (unixepoch()),
        processed INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ap_inbox_recipient ON activitypub_inbox(recipient_user_id, received_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ap_inbox_type ON activitypub_inbox(activity_type)`);
  } catch { /* lazy-create best-effort */ }

  // Optional HTTP signature verification. Real implementation would verify
  // the Signature header against the actor's publicKey via the http-signature
  // module. For Phase 8.2 scaffold we record the signature presence so the
  // flag is surfaceable without blocking unsigned local-dev posts.
  const hasSignature = !!(headers.signature || headers.Signature);
  if (SIGNATURE_REQUIRED && !hasSignature) {
    return { ok: false, reason: "signature_required" };
  }

  // Dedup — INSERT OR IGNORE on the UNIQUE activity_id constraint.
  let inserted = false;
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO activitypub_inbox
        (recipient_user_id, activity_id, activity_type, actor_url, activity_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      recipientUserId,
      activity.id,
      activity.type,
      activity.actor || null,
      JSON.stringify(activity),
    );
    inserted = r.changes > 0;
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }

  if (!inserted) {
    return { ok: true, accepted: true, deduped: true, activityId: activity.id };
  }

  // Dispatch by type. Each handler is a fast no-op-by-default — real
  // side-effects (e.g. creating a follower row, recording a like, mirroring
  // a Note as a DTU) bind in via the existing macro registry so this module
  // stays free of cross-cutting concerns.
  let dispatched = "noop";
  try {
    switch (activity.type) {
      case "Follow": {
        // Add the actor to recipient's followers list (lazy-create).
        db.exec(`
          CREATE TABLE IF NOT EXISTS activitypub_followers (
            user_id TEXT NOT NULL,
            follower_actor_url TEXT NOT NULL,
            since INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (user_id, follower_actor_url)
          )
        `);
        db.prepare(`
          INSERT OR IGNORE INTO activitypub_followers (user_id, follower_actor_url)
          VALUES (?, ?)
        `).run(recipientUserId, activity.actor || "");
        dispatched = "follow_recorded";
        break;
      }
      case "Undo": {
        // Most common Undo target is Follow.
        const obj = activity.object;
        if (obj?.type === "Follow") {
          db.prepare(`DELETE FROM activitypub_followers WHERE user_id = ? AND follower_actor_url = ?`)
            .run(recipientUserId, activity.actor || "");
          dispatched = "follow_revoked";
        } else { dispatched = "undo_unhandled"; }
        break;
      }
      case "Like": case "Announce": {
        // Both record into a simple reactions table.
        db.exec(`
          CREATE TABLE IF NOT EXISTS activitypub_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_user_id TEXT NOT NULL,
            actor_url TEXT NOT NULL,
            kind TEXT NOT NULL,
            object_url TEXT NOT NULL,
            received_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);
        db.prepare(`
          INSERT INTO activitypub_reactions (recipient_user_id, actor_url, kind, object_url)
          VALUES (?, ?, ?, ?)
        `).run(recipientUserId, activity.actor || "", activity.type.toLowerCase(),
          typeof activity.object === "string" ? activity.object : (activity.object?.id || ""));
        dispatched = `${activity.type.toLowerCase()}_recorded`;
        break;
      }
      case "Create": {
        // A Note created by an external actor — we store the inbox row but
        // don't auto-mirror to the local DTU substrate. Mirroring is opt-in
        // via a future federation.mirror_inbox_note macro.
        dispatched = "create_stored";
        break;
      }
      default:
        dispatched = "type_unhandled";
    }

    db.prepare(`UPDATE activitypub_inbox SET processed = 1 WHERE activity_id = ?`).run(activity.id);
  } catch (err) {
    return { ok: true, accepted: true, dispatched: "error", error: String(err?.message || err) };
  }

  return { ok: true, accepted: true, dispatched, activityId: activity.id };
}

/**
 * Read the activity-stream of one user's inbox (paginated, reverse
 * chronological). For UI surfaces showing "new follows + likes + notes"
 * style aggregations.
 */
export function readInbox(db, userId, { limit = 20, before = null, types = null } = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  try {
    const cursor = before ? Number(before) : Date.now() / 1000 + 1;
    const typeFilter = Array.isArray(types) && types.length
      ? `AND activity_type IN (${types.map(() => "?").join(",")})`
      : "";
    const args = [userId, cursor, ...(types || []), Math.min(100, Math.max(1, Number(limit) || 20))];
    const rows = db.prepare(`
      SELECT activity_id, activity_type, actor_url, activity_json, received_at, processed
      FROM activitypub_inbox
      WHERE recipient_user_id = ? AND received_at < ? ${typeFilter}
      ORDER BY received_at DESC LIMIT ?
    `).all(...args);
    return {
      ok: true,
      items: rows.map(r => ({
        id: r.activity_id,
        type: r.activity_type,
        actor: r.actor_url,
        receivedAt: r.received_at,
        processed: !!r.processed,
        ...JSON.parse(r.activity_json),
      })),
    };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export const _internal = {
  ENABLED, BASE_URL, escapeHtml, SIGNATURE_REQUIRED,
};
