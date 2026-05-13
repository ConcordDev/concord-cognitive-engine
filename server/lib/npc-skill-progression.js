// server/lib/npc-skill-progression.js
//
// Phase T — NPC skill XP accumulation.
//
// Mirrors the user_skills XP curve so an NPC and a player on the same
// action gain the same XP. NPCs that grind end up outpacing inactive
// players — that's the design (the player has to go catch up).
//
// API:
//   awardNpcXp(db, npcId, skillId, xp)         — synchronous credit
//   levelFor(xp)                               — XP curve (matches users)
//   getNpcSkillLevels(db, npcId)               — { skillId: { level, xp } }
//   topNpcsForSkill(db, skillId, limit?)       — leaderboard helper
//
// XP curve: level n requires `100 * n^1.5` XP cumulative — same as
// user_skills. A level-10 NPC has ~3162 XP banked.

import crypto from 'node:crypto';

const XP_CURVE_FACTOR = 100;
const XP_CURVE_EXP    = 1.5;

export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(XP_CURVE_FACTOR * Math.pow(level, XP_CURVE_EXP));
}

export function levelFor(xp) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

export function awardNpcXp(db, npcId, skillId, xp) {
  if (!db || !npcId || !skillId || xp <= 0) return null;
  const row = db.prepare(`SELECT xp, level FROM npc_skills WHERE npc_id = ? AND skill_id = ?`).get(npcId, skillId);
  const prevXp    = row?.xp ?? 0;
  const prevLevel = row?.level ?? 1;
  const newXp     = prevXp + xp;
  const newLevel  = levelFor(newXp);
  if (row) {
    db.prepare(`UPDATE npc_skills SET xp = ?, level = ?, last_used_at = unixepoch() WHERE npc_id = ? AND skill_id = ?`)
      .run(newXp, newLevel, npcId, skillId);
  } else {
    db.prepare(`INSERT INTO npc_skills (npc_id, skill_id, xp, level, last_used_at) VALUES (?, ?, ?, ?, unixepoch())`)
      .run(npcId, skillId, newXp, newLevel);
  }
  // Emit a level-up event the runtime can react to (e.g. evolve recipes).
  if (newLevel > prevLevel) {
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.emit('npc:level-up', {
          npcId, skillId, level: newLevel, xp: newXp,
        });
      }
    } catch { /* sockets are optional */ }
  }
  return { npcId, skillId, xp: newXp, level: newLevel, leveledUp: newLevel > prevLevel };
}

export function getNpcSkillLevels(db, npcId) {
  const rows = db.prepare(`SELECT skill_id, xp, level FROM npc_skills WHERE npc_id = ?`).all(npcId);
  const out = {};
  for (const r of rows) out[r.skill_id] = { level: r.level, xp: r.xp };
  return out;
}

export function topNpcsForSkill(db, skillId, limit = 10) {
  return db.prepare(`SELECT npc_id, level, xp FROM npc_skills WHERE skill_id = ? ORDER BY xp DESC LIMIT ?`).all(skillId, limit);
}

/** Convenience: quote-unquote "natural decay". NPCs that haven't used
 *  a skill in N days lose 1 level per N more days (mirror of player
 *  skill atrophy). Called by the daily decay heartbeat (atrophy-cycle).
 */
export function decaySweep(db, daysIdle = 30) {
  const cutoff = Math.floor(Date.now() / 1000) - daysIdle * 86400;
  const stale = db.prepare(`SELECT npc_id, skill_id, level FROM npc_skills WHERE last_used_at < ? AND level > 1`).all(cutoff);
  let demoted = 0;
  for (const s of stale) {
    const newLvl = Math.max(1, s.level - 1);
    db.prepare(`UPDATE npc_skills SET level = ?, xp = ? WHERE npc_id = ? AND skill_id = ?`)
      .run(newLvl, xpForLevel(newLvl), s.npc_id, s.skill_id);
    demoted++;
  }
  return { demoted };
}

/** Helper for tests + dev hooks. */
export function _newAuditId() {
  return `npcxp_${crypto.randomUUID()}`;
}
