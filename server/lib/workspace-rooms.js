// server/lib/workspace-rooms.js
//
// V1.2 Wave A — discovery metadata for MU2's Shared Workspace Room.
//
// This module is deliberately thin and deliberately NOT a content store.
// The `workspace:room` Yjs scope (server/lib/yjs-realtime.js) already
// owns the real thing: the shared `Y.Array` of DTU references and the
// live Awareness-based presence, both rendered by
// concord-frontend/components/workspace/SharedWorkspaceRoom.tsx. Nothing
// here reads or writes that Y.Doc, and nothing here is required for a
// room to function — a room id shared out-of-band still works with zero
// rows in `workspace_rooms`, exactly like it did before this file existed.
//
// What this module adds: rooms can now be CREATED (mint an id + record
// who made it / where it's anchored) and DISCOVERED (list what's nearby,
// list what's mine) instead of only joinable by a hand-copied id.
//
// `listMine` is ownership-only by design, not "owned or been in": MU2's
// Awareness presence is intentionally ephemeral (the y-protocols spec's
// own design — states drop if not refreshed every ~30s) and the Yjs doc
// itself is in-memory-only per yjs-realtime.js's own header comment ("the
// doc state is lost on server restart"). There is no durable, honest
// signal anywhere in the stack for "this user was once present in this
// room" to widen the scope against — inventing one here (e.g. a
// best-effort join-log) would be exactly the kind of parallel
// membership/ACL substrate MU2's own design notes decline to build.
// If a durable visit history is wanted later, it belongs as its own
// explicit table/decision, not smuggled into this metadata layer.

import crypto from "node:crypto";

const NAME_MAX_LEN = 80;

function newRoomId() {
  return `wr_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Create a room's metadata row and mint the id the Yjs layer will use as
 * its docId. Returns the fresh room; the frontend passes `room.id` as
 * `roomId` straight into `<SharedWorkspaceRoom roomId={room.id} .../>`.
 */
export function createRoom(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { ownerId, worldId, districtId = null, name } = opts;
  if (!ownerId || !worldId) return { ok: false, error: "missing_inputs" };
  const trimmedName = String(name || "").trim().slice(0, NAME_MAX_LEN);
  if (!trimmedName) return { ok: false, error: "empty_name" };

  const id = newRoomId();
  try {
    db.prepare(`
      INSERT INTO workspace_rooms (id, name, owner_id, world_id, district_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, trimmedName, ownerId, worldId, districtId || null);
    return { ok: true, room: getRoom(db, id) };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

export function getRoom(db, id) {
  if (!db || !id) return null;
  try {
    return db.prepare(`
      SELECT id, name, owner_id, world_id, district_id, created_at
      FROM workspace_rooms WHERE id = ?
    `).get(id) || null;
  } catch {
    return null;
  }
}

/** Rooms anchored to a (worldId, districtId) pair — mirrors the exact
 *  scoping shape of ambient-chat.js#listRecentInDistrict. */
export function listInDistrict(db, worldId, districtId, opts = {}) {
  if (!db || !worldId || !districtId) return [];
  try {
    const limit = Math.max(1, Math.min(100, opts.limit || 25));
    return db.prepare(`
      SELECT id, name, owner_id, world_id, district_id, created_at
      FROM workspace_rooms
      WHERE world_id = ? AND district_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(worldId, districtId, limit);
  } catch {
    return [];
  }
}

/** Rooms owned by a given user — see the module header for why this is
 *  ownership-only rather than "owned or has been in." */
export function listMine(db, ownerId, opts = {}) {
  if (!db || !ownerId) return [];
  try {
    const limit = Math.max(1, Math.min(100, opts.limit || 50));
    return db.prepare(`
      SELECT id, name, owner_id, world_id, district_id, created_at
      FROM workspace_rooms
      WHERE owner_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(ownerId, limit);
  } catch {
    return [];
  }
}

export { NAME_MAX_LEN };
