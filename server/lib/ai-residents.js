// server/lib/ai-residents.js
//
// Phase T — AI residents. Users deploy autonomous agents into a world to
// run businesses, develop relationships, write news. Three monetization
// vectors on one substrate: play / manage / watch.
//
// Each resident = world_npcs row (the body) + agent_marathon_sessions row
// (the brain loop) + ai_residents row (the link). The existing marathon
// substrate already runs the brain; this module adds the deployment +
// recall flow + earnings routing.

import logger from "../logger.js";
import crypto from "node:crypto";

const DEFAULT_DEPOSIT_CC = 100;

/**
 * Deploy a resident into a world.
 *
 * @param {object} db
 * @param {object} input - { ownerUserId, worldId, intent, archetype, factionId, depositCc, intentDtuId? }
 * @returns {{ok, residentNpcId?, marathonSessionId?, error?}}
 */
export function deployResident(db, input) {
  const { ownerUserId, worldId, intent, archetype = "default", factionId = null, depositCc = DEFAULT_DEPOSIT_CC, intentDtuId = null } = input || {};
  if (!db || !ownerUserId || !worldId || !intent) return { ok: false, error: "missing_inputs" };

  const npcId = `airesident_${crypto.randomBytes(6).toString("hex")}`;
  const marathonSessionId = `marathon_${crypto.randomBytes(6).toString("hex")}`;

  try {
    // 1. Insert the NPC body. Use a permissive insert that tolerates
    //    missing optional columns by going through a JSON-stitched
    //    narrative_context (existing pattern).
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, faction, archetype, x, y, z, is_dead, narrative_context)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)
    `).run(npcId, worldId, factionId, archetype, JSON.stringify({
      ai_resident: true,
      owner_user_id: ownerUserId,
      intent,
    }));

    // 2. Marathon session — uses the existing agent_marathon_sessions
    //    table if present; otherwise just store the intent in the
    //    ai_residents row.
    try {
      db.prepare(`
        INSERT INTO agent_marathon_sessions (id, user_id, status, intent, started_at)
        VALUES (?, ?, 'running', ?, unixepoch())
      `).run(marathonSessionId, ownerUserId, intent);
    } catch { /* table may not exist on minimal builds — intent still lives on the NPC */ }

    // 3. ai_residents row.
    db.prepare(`
      INSERT INTO ai_residents
        (npc_id, owner_user_id, marathon_session_id, world_id, intent_dtu_id, current_status_json, deposit_cc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(npcId, ownerUserId, marathonSessionId, worldId, intentDtuId, JSON.stringify({ phase: "active", intent }), Number(depositCc) || DEFAULT_DEPOSIT_CC);

    return { ok: true, residentNpcId: npcId, marathonSessionId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function pauseResident(db, npcId, ownerUserId) {
  try {
    const r = db.prepare(`SELECT owner_user_id FROM ai_residents WHERE npc_id = ?`).get(npcId);
    if (!r) return { ok: false, error: "no_resident" };
    if (r.owner_user_id !== ownerUserId) return { ok: false, error: "not_owner" };
    db.prepare(`UPDATE ai_residents SET paused_at = unixepoch() WHERE npc_id = ?`).run(npcId);
    try {
      db.prepare(`UPDATE agent_marathon_sessions SET status = 'paused'
        WHERE id = (SELECT marathon_session_id FROM ai_residents WHERE npc_id = ?)`).run(npcId);
    } catch { /* marathon table optional */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function resumeResident(db, npcId, ownerUserId) {
  try {
    const r = db.prepare(`SELECT owner_user_id FROM ai_residents WHERE npc_id = ?`).get(npcId);
    if (!r) return { ok: false, error: "no_resident" };
    if (r.owner_user_id !== ownerUserId) return { ok: false, error: "not_owner" };
    db.prepare(`UPDATE ai_residents SET paused_at = NULL WHERE npc_id = ?`).run(npcId);
    try {
      db.prepare(`UPDATE agent_marathon_sessions SET status = 'running'
        WHERE id = (SELECT marathon_session_id FROM ai_residents WHERE npc_id = ?)`).run(npcId);
    } catch { /* marathon table optional */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Recall a resident. NPC body is marked dead, marathon session is closed,
 * and the deposit refund + accumulated earnings are returned as a payout
 * plan (caller handles wallet credit).
 */
export function recallResident(db, npcId, ownerUserId) {
  try {
    const r = db.prepare(`SELECT * FROM ai_residents WHERE npc_id = ?`).get(npcId);
    if (!r) return { ok: false, error: "no_resident" };
    if (r.owner_user_id !== ownerUserId) return { ok: false, error: "not_owner" };
    if (r.recalled_at) return { ok: false, error: "already_recalled" };

    db.prepare(`UPDATE ai_residents SET recalled_at = unixepoch() WHERE npc_id = ?`).run(npcId);
    try {
      db.prepare(`UPDATE agent_marathon_sessions SET status = 'completed'
        WHERE id = ?`).run(r.marathon_session_id);
    } catch { /* marathon table optional */ }
    try {
      db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ?`).run(npcId);
    } catch { /* world_npcs schema may differ */ }

    const refundPlan = {
      userId: ownerUserId,
      depositRefundCC: Number(r.deposit_cc) || 0,
      earningsCC: Number(r.earnings_cc) || 0,
      totalCC: (Number(r.deposit_cc) || 0) + (Number(r.earnings_cc) || 0),
    };
    return { ok: true, refundPlan };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listMyResidents(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT r.*, n.archetype, n.faction, n.x, n.y, n.z
      FROM ai_residents r
      LEFT JOIN world_npcs n ON n.id = r.npc_id
      WHERE r.owner_user_id = ? AND r.recalled_at IS NULL
      ORDER BY r.deployed_at DESC
    `).all(userId);
  } catch {
    return [];
  }
}

/**
 * Route earnings from an in-world transaction to the resident's owner.
 * Caller invokes this when the resident NPC sells a recipe or completes
 * a quest. 95% to owner, 5% to platform — matches the standard split.
 */
export function recordResidentEarnings(db, npcId, ccAmount) {
  if (!db || !npcId || !Number.isFinite(ccAmount) || ccAmount <= 0) return { ok: false };
  try {
    const ownerShare = Math.round(ccAmount * 0.95 * 100) / 100;
    db.prepare(`
      UPDATE ai_residents SET earnings_cc = earnings_cc + ?
      WHERE npc_id = ?
    `).run(ownerShare, npcId);
    return { ok: true, ownerShare };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
