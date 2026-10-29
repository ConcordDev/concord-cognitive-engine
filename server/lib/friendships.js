// server/lib/friendships.js
//
// Friendship graph helpers. Bidirectional adjacency stored as a single
// row (sorted by sender chronologically); queries normalise the (a, b)
// ordering so callers never have to think about who sent the request.

import crypto from "node:crypto";

/**
 * Send a friend request. Idempotent — if a row already exists in either
 * direction, returns its current status without creating a duplicate.
 *
 * @param {object} db
 * @param {string} requesterId
 * @param {string} addresseeId
 * @returns {{ok, id?, status?, error?}}
 */
export function sendFriendRequest(db, requesterId, addresseeId) {
  if (!db || !requesterId || !addresseeId) return { ok: false, error: "missing_inputs" };
  if (requesterId === addresseeId) return { ok: false, error: "cannot_friend_self" };

  // Check for existing row in either direction.
  const existing = _findRow(db, requesterId, addresseeId);
  if (existing) {
    if (existing.status === "blocked") return { ok: false, error: "blocked" };
    if (existing.status === "accepted") return { ok: true, id: existing.id, status: "accepted" };
    // Pending + addressee is now sending back → treat as accept.
    if (existing.status === "pending" && existing.requester_id === addresseeId && existing.addressee_id === requesterId) {
      db.prepare(`UPDATE friendships SET status = 'accepted', responded_at = unixepoch() WHERE id = ?`).run(existing.id);
      return { ok: true, id: existing.id, status: "accepted" };
    }
    return { ok: true, id: existing.id, status: existing.status };
  }

  const id = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO friendships (id, requester_id, addressee_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, requesterId, addresseeId);
    return { ok: true, id, status: "pending" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Accept a pending friend request. Only the addressee can accept.
 */
export function acceptFriendRequest(db, id, callerUserId) {
  const row = db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(id);
  if (!row) return { ok: false, error: "no_request" };
  if (row.addressee_id !== callerUserId) return { ok: false, error: "not_authorized" };
  if (row.status !== "pending") return { ok: false, error: "not_pending" };
  db.prepare(`UPDATE friendships SET status = 'accepted', responded_at = unixepoch() WHERE id = ?`).run(id);
  return { ok: true };
}

/** Decline a pending request. Only the addressee can decline. */
export function declineFriendRequest(db, id, callerUserId) {
  const row = db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(id);
  if (!row) return { ok: false, error: "no_request" };
  if (row.addressee_id !== callerUserId) return { ok: false, error: "not_authorized" };
  if (row.status !== "pending") return { ok: false, error: "not_pending" };
  db.prepare(`UPDATE friendships SET status = 'declined', responded_at = unixepoch() WHERE id = ?`).run(id);
  return { ok: true };
}

/** Unfriend. Either party can remove the friendship. */
export function unfriend(db, callerUserId, otherUserId) {
  const row = _findRow(db, callerUserId, otherUserId);
  if (!row) return { ok: false, error: "not_friends" };
  if (row.status !== "accepted") return { ok: false, error: "not_friends" };
  db.prepare(`DELETE FROM friendships WHERE id = ?`).run(row.id);
  return { ok: true };
}

/** Block. Bidirectional — neither side can send a new request after.
 * Records blocked_by (migration 493): requester/addressee describe
 * the original friend request's direction, which is NOT who set the
 * block — an addressee blocking their requester is the ordinary case.
 * Only the recorded blocker may lift the block (see unblockUser). */
export function blockUser(db, callerUserId, otherUserId) {
  const row = _findRow(db, callerUserId, otherUserId);
  if (row) {
    db.prepare(`UPDATE friendships SET status = 'blocked', blocked_by = ?, responded_at = unixepoch() WHERE id = ?`).run(callerUserId, row.id);
    return { ok: true, id: row.id };
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO friendships (id, requester_id, addressee_id, status, blocked_by, responded_at)
    VALUES (?, ?, ?, 'blocked', ?, unixepoch())
  `).run(id, callerUserId, otherUserId, callerUserId);
  return { ok: true, id };
}

/** List accepted friends. Returns the OTHER party's id, not the row owner. */
export function listFriends(db, userId) {
  if (!db || !userId) return [];
  const rows = db.prepare(`
    SELECT id, requester_id, addressee_id, created_at, responded_at
    FROM friendships
    WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
    ORDER BY COALESCE(responded_at, created_at) DESC
  `).all(userId, userId);
  return rows.map(r => ({
    friendshipId: r.id,
    friendUserId: r.requester_id === userId ? r.addressee_id : r.requester_id,
    since: r.responded_at || r.created_at,
  }));
}

/** List pending invites the user has received (not sent). */
export function listIncomingRequests(db, userId) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT id, requester_id AS fromUser, created_at
    FROM friendships
    WHERE status = 'pending' AND addressee_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

/** List pending invites the user has sent (not received). */
export function listOutgoingRequests(db, userId) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT id, addressee_id AS toUser, created_at
    FROM friendships
    WHERE status = 'pending' AND requester_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

/** Find a friendship row regardless of which party is the requester. */
function _findRow(db, a, b) {
  return db.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = ? AND addressee_id = ?)
       OR (requester_id = ? AND addressee_id = ?)
    LIMIT 1
  `).get(a, b, b, a) || null;
}

export function areFriends(db, a, b) {
  const row = _findRow(db, a, b);
  return !!(row && row.status === "accepted");
}

/** True when the pair's row is blocked — a block covers both
 * directions, whichever party set it. */
export function isBlocked(db, a, b) {
  if (!db || !a || !b) return false;
  const row = _findRow(db, a, b);
  return !!(row && row.status === "blocked");
}

/** Undo a block. Only the blocker may lift it — the blocked party
 * cannot unilaterally restore contact the blocker severed (GB-0045).
 * Deletes the pair row: the two accounts go back to strangers — a
 * block already ended any friendship, so there is nothing to restore.
 * Rows blocked before blocked_by was recorded carry NULL: who set
 * those is unprovable, so either party may lift them; every block set
 * since records its blocker and is restricted to them. */
export function unblockUser(db, callerUserId, otherUserId) {
  const row = _findRow(db, callerUserId, otherUserId);
  if (!row || row.status !== "blocked") return { ok: false, error: "not_blocked" };
  if (row.blocked_by && row.blocked_by !== callerUserId) return { ok: false, error: "not_blocker" };
  db.prepare(`DELETE FROM friendships WHERE id = ?`).run(row.id);
  return { ok: true };
}

/** Blocked pairs involving this user, with who set each block
 * (blockedBy null on rows blocked before it was recorded). */
export function listBlockPairs(db, userId) {
  if (!db || !userId) return [];
  const rows = db.prepare(`
    SELECT requester_id, addressee_id, blocked_by FROM friendships
    WHERE status = 'blocked' AND (requester_id = ? OR addressee_id = ?)
  `).all(userId, userId);
  return rows.map(r => ({
    otherUserId: r.requester_id === userId ? r.addressee_id : r.requester_id,
    blockedBy: r.blocked_by || null,
  }));
}

/** Ids of everyone in a blocked pair with this user (either party). */
export function listBlocked(db, userId) {
  return listBlockPairs(db, userId).map(p => p.otherUserId);
}
