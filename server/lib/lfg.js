// server/lib/lfg.js
//
// Phase U5 — Looking-For-Group matchmaking.
//
// A player posts: "I'm a healer in tunya looking for 2 DPS for harvest
// dungeon." Other players browse by world + role and click invite. The
// invite path creates a party_invite (existing flow) and marks the
// LFG row matched.

import crypto from "node:crypto";
import logger from "../logger.js";
import { inviteToParty, createParty } from "./parties.js";

export function postLfg(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const worldId = String(opts.worldId || "concordia-hub");
  const role = ["tank", "healer", "dps", "support", "any"].includes(opts.role) ? opts.role : "any";
  const note = String(opts.note || "").slice(0, 240);
  const partyType = opts.partyType === "raid" ? "raid" : "normal";
  const partyMaxSize = Math.min(Math.max(2, Number(opts.partyMaxSize) || (partyType === "raid" ? 40 : 8)), partyType === "raid" ? 40 : 8);

  const id = `lfg_${crypto.randomBytes(6).toString("hex")}`;
  try {
    // Cancel any prior open LFG from the same user in the same world —
    // a player shouldn't be queued in two roles simultaneously.
    db.prepare(`
      UPDATE lfg_requests SET status = 'cancelled', matched_at = unixepoch()
      WHERE requester_user_id = ? AND world_id = ? AND status = 'open'
    `).run(userId, worldId);

    db.prepare(`
      INSERT INTO lfg_requests
        (id, requester_user_id, world_id, role, party_type, note,
         party_max_size, current_party_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, userId, worldId, role, partyType, note, partyMaxSize);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function cancelLfg(db, lfgId, userId) {
  if (!db || !lfgId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`
      UPDATE lfg_requests SET status = 'cancelled', matched_at = unixepoch()
      WHERE id = ? AND requester_user_id = ? AND status = 'open'
    `).run(lfgId, userId);
    return r.changes > 0 ? { ok: true } : { ok: false, error: "not_open_or_unauthorized" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listOpenLfg(db, opts = {}) {
  if (!db) return [];
  const worldId = opts.worldId;
  const roleFilter = opts.role && opts.role !== "any" ? opts.role : null;
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    const where = ["status = 'open'", "expires_at > unixepoch()"];
    const params = [];
    if (worldId) { where.push("world_id = ?"); params.push(worldId); }
    if (roleFilter) { where.push("role = ?"); params.push(roleFilter); }
    return db.prepare(`
      SELECT id, requester_user_id AS userId, world_id AS worldId, role,
             party_type AS partyType, note, created_at AS createdAt,
             expires_at AS expiresAt, party_max_size AS partyMaxSize,
             current_party_size AS currentSize
      FROM lfg_requests
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit);
  } catch {
    return [];
  }
}

/**
 * The "invite from LFG" path. If the inviter is already in a party,
 * adds the LFG poster to that party. If not, auto-creates a party led
 * by the inviter and adds the poster.
 */
export function inviteFromLfg(db, lfgId, byUserId) {
  if (!db || !lfgId || !byUserId) return { ok: false, error: "missing_inputs" };
  try {
    const lfg = db.prepare(`SELECT * FROM lfg_requests WHERE id = ?`).get(lfgId);
    if (!lfg) return { ok: false, error: "no_lfg" };
    if (lfg.status !== "open") return { ok: false, error: "not_open" };
    if (lfg.requester_user_id === byUserId) return { ok: false, error: "cannot_invite_self" };

    // Find or create the inviter's party.
    let partyId = null;
    try {
      const my = db.prepare(`SELECT party_id FROM party_members WHERE user_id = ?`).get(byUserId);
      partyId = my?.party_id || null;
    } catch { /* tables optional */ }

    if (!partyId) {
      const r = createParty(db, byUserId, {
        name: lfg.party_type === "raid" ? "Raid party" : "Group",
        partyType: lfg.party_type,
        maxSize: lfg.party_max_size,
      });
      if (!r.ok) return { ok: false, error: r.error };
      partyId = r.partyId;
    }

    const inv = inviteToParty(db, partyId, byUserId, lfg.requester_user_id);
    if (!inv.ok) return inv;

    // Mark LFG matched.
    db.prepare(`
      UPDATE lfg_requests SET status = 'matched', party_id = ?, matched_at = unixepoch()
      WHERE id = ?
    `).run(partyId, lfgId);

    return { ok: true, partyId, inviteId: inv.inviteId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Sweep expired LFG rows. Heartbeat. */
export function sweepExpiredLfg(db) {
  if (!db) return { swept: 0 };
  try {
    const r = db.prepare(`
      UPDATE lfg_requests SET status = 'expired'
      WHERE status = 'open' AND expires_at <= unixepoch()
    `).run();
    return { swept: r.changes };
  } catch {
    return { swept: 0 };
  }
}
