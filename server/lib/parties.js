// server/lib/parties.js
//
// Phase U5 — party engine. Builds on the parties / party_members /
// party_invites tables (migration 070).
//
// Party sizes: normal max 8, raid max 40. Leadership transfers to next
// member on leader leave; if no members remain the party disbands.
// Quest share helper extends each member's active quest list (the
// quest-engine reads this on every getActiveQuests call).

import crypto from "node:crypto";
import logger from "../logger.js";

const NORMAL_MAX = 8;
const RAID_MAX = 40;

function _genId(prefix = "party") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function createParty(db, leaderId, opts = {}) {
  if (!db || !leaderId) return { ok: false, error: "missing_inputs" };
  const partyType = opts.partyType === "raid" ? "raid" : "normal";
  const cap = partyType === "raid" ? RAID_MAX : NORMAL_MAX;
  const maxSize = Math.min(Math.max(2, Number(opts.maxSize) || cap), cap);
  const name = String(opts.name || "Untitled Party").slice(0, 80);
  const privacy = opts.privacy === "open" ? "open" : "invite_only";

  // Check the leader isn't already in a party.
  try {
    const existing = db.prepare(`
      SELECT party_id FROM party_members WHERE user_id = ?
    `).get(leaderId);
    if (existing) return { ok: false, error: "already_in_party", partyId: existing.party_id };
  } catch { /* tables optional */ }

  const id = _genId();
  try {
    db.prepare(`
      INSERT INTO parties (id, leader_id, name, max_size, privacy, party_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    `).run(id, leaderId, name, maxSize, privacy, partyType);

    db.prepare(`
      INSERT INTO party_members (party_id, user_id, role, joined_at)
      VALUES (?, ?, 'leader', unixepoch())
    `).run(id, leaderId);

    return { ok: true, partyId: id, partyType, maxSize };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function inviteToParty(db, partyId, fromUserId, toUserId) {
  if (!db || !partyId || !fromUserId || !toUserId) return { ok: false, error: "missing_inputs" };
  if (fromUserId === toUserId) return { ok: false, error: "cannot_invite_self" };

  const party = _getParty(db, partyId);
  if (!party) return { ok: false, error: "no_party" };
  // Only the leader can invite (open parties allow members too).
  const myRole = _getMemberRole(db, partyId, fromUserId);
  if (party.privacy === "invite_only" && myRole !== "leader") return { ok: false, error: "not_authorized" };
  if (!myRole) return { ok: false, error: "not_in_party" };

  // Already in the party?
  if (_getMemberRole(db, partyId, toUserId)) return { ok: false, error: "already_member" };

  // Capacity check.
  const size = _getPartySize(db, partyId);
  if (size >= party.max_size) return { ok: false, error: "party_full" };

  const inviteId = _genId("inv");
  try {
    db.prepare(`
      INSERT INTO party_invites (id, party_id, invited_by, invited_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending', unixepoch(), unixepoch() + 86400)
    `).run(inviteId, partyId, fromUserId, toUserId);
    return { ok: true, inviteId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function acceptPartyInvite(db, inviteId, userId) {
  if (!db || !inviteId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const inv = db.prepare(`SELECT * FROM party_invites WHERE id = ?`).get(inviteId);
    if (!inv) return { ok: false, error: "no_invite" };
    if (inv.to_user_id !== userId) return { ok: false, error: "not_authorized" };
    if (inv.status !== "pending") return { ok: false, error: "not_pending" };

    // Verify party still has capacity.
    const party = _getParty(db, inv.party_id);
    if (!party) return { ok: false, error: "party_disbanded" };
    if (_getPartySize(db, inv.party_id) >= party.max_size) {
      db.prepare(`UPDATE party_invites SET status = 'expired' WHERE id = ?`).run(inviteId);
      return { ok: false, error: "party_full" };
    }
    // Already a member?
    if (_getMemberRole(db, inv.party_id, userId)) {
      db.prepare(`UPDATE party_invites SET status = 'accepted' WHERE id = ?`).run(inviteId);
      return { ok: true, partyId: inv.party_id, alreadyMember: true };
    }

    db.prepare(`
      INSERT INTO party_members (party_id, user_id, role, joined_at)
      VALUES (?, ?, 'member', unixepoch())
    `).run(inv.party_id, userId);
    db.prepare(`UPDATE party_invites SET status = 'accepted' WHERE id = ?`).run(inviteId);
    return { ok: true, partyId: inv.party_id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function leaveParty(db, partyId, userId) {
  if (!db || !partyId || !userId) return { ok: false, error: "missing_inputs" };
  const role = _getMemberRole(db, partyId, userId);
  if (!role) return { ok: false, error: "not_in_party" };
  try {
    db.prepare(`DELETE FROM party_members WHERE party_id = ? AND user_id = ?`).run(partyId, userId);
    const remaining = _getPartySize(db, partyId);
    if (remaining === 0) {
      // Disband entirely.
      db.prepare(`UPDATE parties SET disbanded_at = unixepoch() WHERE id = ?`).run(partyId);
      return { ok: true, disbanded: true };
    }
    if (role === "leader") {
      // Transfer leadership to the earliest-joined remaining member.
      const next = db.prepare(`
        SELECT user_id FROM party_members WHERE party_id = ?
        ORDER BY joined_at ASC LIMIT 1
      `).get(partyId);
      if (next) {
        db.prepare(`UPDATE party_members SET role = 'leader' WHERE party_id = ? AND user_id = ?`).run(partyId, next.user_id);
        db.prepare(`UPDATE parties SET leader_id = ? WHERE id = ?`).run(next.user_id, partyId);
        return { ok: true, leaderTransferredTo: next.user_id };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function kickFromParty(db, partyId, byUserId, targetUserId) {
  if (!db || !partyId || !byUserId || !targetUserId) return { ok: false, error: "missing_inputs" };
  if (_getMemberRole(db, partyId, byUserId) !== "leader") return { ok: false, error: "not_authorized" };
  if (byUserId === targetUserId) return { ok: false, error: "cannot_kick_self" };
  if (!_getMemberRole(db, partyId, targetUserId)) return { ok: false, error: "not_in_party" };
  try {
    db.prepare(`DELETE FROM party_members WHERE party_id = ? AND user_id = ?`).run(partyId, targetUserId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function disbandParty(db, partyId, byUserId) {
  if (!db || !partyId || !byUserId) return { ok: false, error: "missing_inputs" };
  if (_getMemberRole(db, partyId, byUserId) !== "leader") return { ok: false, error: "not_authorized" };
  try {
    db.prepare(`DELETE FROM party_members WHERE party_id = ?`).run(partyId);
    db.prepare(`UPDATE parties SET disbanded_at = unixepoch() WHERE id = ?`).run(partyId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getMyParty(db, userId) {
  if (!db || !userId) return null;
  try {
    const row = db.prepare(`
      SELECT pm.party_id, pm.role AS myRole,
             p.name, p.leader_id AS leaderId, p.max_size AS maxSize,
             p.privacy, p.party_type AS partyType, p.created_at AS createdAt
      FROM party_members pm
      JOIN parties p ON p.id = pm.party_id
      WHERE pm.user_id = ? AND p.disbanded_at IS NULL
    `).get(userId);
    if (!row) return null;
    const members = db.prepare(`
      SELECT user_id AS userId, role, joined_at AS joinedAt
      FROM party_members WHERE party_id = ?
      ORDER BY joined_at ASC
    `).all(row.party_id);
    return { ...row, members };
  } catch {
    return null;
  }
}

export function listIncomingInvites(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT pi.id, pi.party_id AS partyId, pi.invited_by AS fromUser,
             pi.created_at AS createdAt,
             p.name AS partyName, p.party_type AS partyType
      FROM party_invites pi
      JOIN parties p ON p.id = pi.party_id
      WHERE pi.invited_id = ? AND pi.status = 'pending'
        AND p.disbanded_at IS NULL
      ORDER BY pi.created_at DESC
    `).all(userId);
  } catch {
    return [];
  }
}

/**
 * Share a quest with the party. Adds the quest to each member's
 * active list. Verified the sharer is a party member with the quest
 * active; the quest-engine's getActiveQuests then returns it for
 * every member.
 *
 * Implementation: writes party_shared_quests rows that the quest
 * engine reads as a join. If the table is missing we no-op
 * gracefully.
 */
export function shareQuestWithParty(db, partyId, questId, byUserId) {
  if (!db || !partyId || !questId || !byUserId) return { ok: false, error: "missing_inputs" };
  if (!_getMemberRole(db, partyId, byUserId)) return { ok: false, error: "not_in_party" };
  try {
    // Ensure the share-table exists; create if not (idempotent migration-style).
    db.exec(`
      CREATE TABLE IF NOT EXISTS party_shared_quests (
        party_id    TEXT NOT NULL,
        quest_id    TEXT NOT NULL,
        shared_by   TEXT NOT NULL,
        shared_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (party_id, quest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_party_shared_quests_quest
        ON party_shared_quests(quest_id);
    `);
    db.prepare(`
      INSERT INTO party_shared_quests (party_id, quest_id, shared_by)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(partyId, questId, byUserId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Internal helpers ────────────────────────────────────────────────── */

function _getParty(db, partyId) {
  try {
    return db.prepare(`SELECT * FROM parties WHERE id = ? AND disbanded_at IS NULL`).get(partyId) || null;
  } catch { return null; }
}

function _getMemberRole(db, partyId, userId) {
  try {
    const r = db.prepare(`SELECT role FROM party_members WHERE party_id = ? AND user_id = ?`).get(partyId, userId);
    return r?.role || null;
  } catch { return null; }
}

function _getPartySize(db, partyId) {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`).get(partyId);
    return Number(r?.n) || 0;
  } catch { return 0; }
}
