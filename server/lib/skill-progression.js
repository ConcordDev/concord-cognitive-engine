// server/lib/skill-progression.js
// Open-ended, anti-grinding skill progression for DTU skills.

import crypto from "crypto";

export const EXPERIENCE_RATES = {
  practice:              1,
  meaningful_application: 5,
  teaching:              3,
  cross_world_use:       1.5,
  hybrid_contribution:   10,
  master_demonstration:  8,
};

const MASTERY_THRESHOLDS = [
  { level: 10,   badge: "novice",       title: "Novice",       aura: null,       npcRecognition: false, teacherEligible: false },
  { level: 25,   badge: "adept",        title: "Adept",        aura: null,       npcRecognition: false, teacherEligible: false },
  { level: 50,   badge: "skilled",      title: "Skilled",      aura: "blue",     npcRecognition: true,  teacherEligible: false },
  { level: 100,  badge: "expert",       title: "Expert",       aura: "gold",     npcRecognition: true,  teacherEligible: true  },
  { level: 200,  badge: "master",       title: "Master",       aura: "platinum", npcRecognition: true,  teacherEligible: true  },
  { level: 500,  badge: "legendary",    title: "Legendary",    aura: "rainbow",  npcRecognition: true,  teacherEligible: true,  legendaryStatus: true },
  { level: 1000, badge: "mythic",       title: "Mythic",       aura: "cosmic",   npcRecognition: true,  teacherEligible: true,  mythicStatus: true    },
  { level: 5000, badge: "transcendent", title: "Transcendent", aura: "void",     npcRecognition: true,  teacherEligible: true,  mythicStatus: true    },
];

/**
 * Compute floating-point level from accumulated experience.
 * Unbounded: 1 + log10(1 + totalExp/10)
 * @param {number} totalExp
 * @returns {number}
 */
export function computeLevelFromExperience(totalExp) {
  return 1 + Math.log10(1 + (totalExp / 10));
}

/**
 * Compute the quality of a created item based on player skill level and tool quality.
 * Formula: skill contributes 60%, tool quality contributes 40%.
 * Clamped 1–100.
 * @param {number} skillLevel  player's skill level (1–5000+)
 * @param {number} toolQuality tool quality (0–100)
 * @returns {number} quality score 1–100
 */
export function computeCreationQuality(skillLevel = 1, toolQuality = 10) {
  const skillContrib = Math.min(skillLevel / 500, 1) * 60;
  const toolContrib = Math.min(toolQuality / 100, 1) * 40;
  return Math.max(1, Math.min(100, Math.round(skillContrib + toolContrib)));
}

/**
 * Award experience to a skill DTU for a meaningful event.
 * Returns { awarded, newLevel, grinding } — grinding=true means 0 XP awarded.
 * @param {object} skill  DTU row
 * @param {string} eventType  key of EXPERIENCE_RATES
 * @param {object} context  { worldId, userId?, npcId?, changedWorldState?, affectedNPC?, solvedChallenge?, studentImproved? }
 * @param {import('better-sqlite3').Database} db
 */
export async function awardExperience(skill, eventType, context, db) {
  const baseRate = EXPERIENCE_RATES[eventType];
  if (!baseRate) return { awarded: 0, newLevel: skill.skill_level || 1, grinding: false };

  const meaningful = verifyMeaningfulEvent(skill, eventType, context);

  if (meaningful && detectGrinding(skill.id, context.userId, db)) {
    return { awarded: 0, newLevel: skill.skill_level || 1, grinding: true };
  }

  let xp = meaningful ? baseRate : baseRate * 0.1;

  // Diminishing returns at high level
  const currentLevel = skill.skill_level || 1;
  const diminish = 1 / (1 + Math.log10(currentLevel + 1) * 0.1);
  xp *= diminish;

  const newTotalExp = (skill.total_experience || 0) + xp;
  const newLevel    = computeLevelFromExperience(newTotalExp);

  // Update dtus
  db.prepare(`
    UPDATE dtus SET
      total_experience = ?,
      skill_level = ?,
      practice_count = practice_count + ?,
      teaching_count = teaching_count + ?,
      cross_world_uses = cross_world_uses + ?,
      last_practiced_at = unixepoch()
    WHERE id = ?
  `).run(
    newTotalExp,
    newLevel,
    eventType === "practice"   ? 1 : 0,
    eventType === "teaching"   ? 1 : 0,
    eventType === "cross_world_use" ? 1 : 0,
    skill.id,
  );

  // Record event
  db.prepare(`
    INSERT INTO skill_experience_events
      (id, skill_dtu_id, user_id, npc_id, world_id, event_type, experience_gained, context, meaningful)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    skill.id,
    context.userId  || null,
    context.npcId   || null,
    context.worldId || "concordia-hub",
    eventType,
    xp,
    JSON.stringify(context),
    meaningful ? 1 : 0,
  );

  return { awarded: xp, newLevel, grinding: false };
}

/**
 * Verify that an event is meaningful (not repetitive grinding).
 * @param {object} skill
 * @param {string} eventType
 * @param {object} context
 * @returns {boolean}
 */
export function verifyMeaningfulEvent(skill, eventType, context) {
  switch (eventType) {
    case "practice":
      return Boolean(context.changedWorldState || context.affectedNPC || context.solvedChallenge);
    case "teaching":
      return Boolean(context.studentImproved);
    case "meaningful_application":
      return Boolean(context.solvedChallenge || context.affectedNPC);
    case "cross_world_use":
      return Boolean(context.worldId && context.worldId !== (skill.world_id || "concordia-hub"));
    case "hybrid_contribution":
      return true; // hybrid creation is always meaningful
    case "master_demonstration":
      return Boolean(context.audienceSize && context.audienceSize > 0);
    default:
      return false;
  }
}

/**
 * Detect grinding: last 20 events from same user have fewer than 3 unique context hashes.
 * @param {string} skillId
 * @param {string|null} userId
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
export function detectGrinding(skillId, userId, db) {
  if (!userId) return false;

  const recent = db.prepare(`
    SELECT context FROM skill_experience_events
    WHERE skill_dtu_id = ? AND user_id = ?
    ORDER BY timestamp DESC LIMIT 20
  `).all(skillId, userId);

  if (recent.length < 5) return false;

  const uniqueContexts = new Set(recent.map(r => {
    try {
      const c = JSON.parse(r.context || "{}");
      return `${c.challengeId || ""}-${c.targetId || ""}-${c.worldId || ""}`;
    } catch {
      return r.context || "";
    }
  }));

  return uniqueContexts.size < 3;
}

/**
 * Return the mastery marker for a given skill's current level.
 * @param {object} skill  DTU row (needs skill_level)
 * @returns {object}
 */

/**
 * Lightweight gameplay XP grant. Called from gather / craft / combat hits
 * where there isn't a specific authored skill DTU to award against.
 * Auto-creates a per-user `skill_<userId>_<action>` row, bumps skill_level,
 * and emits skill:xp-awarded so LevelUpJuiceBridge can fanfare on level up.
 */
export function recordGameplayXP(db, userId, action, _context = {}) {
  if (!db || !userId || !action) return { ok: false };
  const skillId = `skill_${userId.slice(0, 8)}_${action}`;
  try {
    // TODO: project explicit columns (auto-fix suggestion)
    const existing = db.prepare("SELECT * FROM dtus WHERE id = ?").get(skillId);
    if (!existing) {
      db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, skill_level, created_at, last_used_at)
                  VALUES (?, 'skill', ?, ?, ?, 1, ?, ?)`)
        .run(skillId, action.charAt(0).toUpperCase() + action.slice(1), userId,
             // hidden:true so library/marketplace queries can filter these out
             // (vs. user-authored skills which the player explicitly created).
             JSON.stringify({ action, autoGenerated: true, hidden: true, system: true }),
             Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    }
    const before = db.prepare("SELECT skill_level FROM dtus WHERE id = ?").get(skillId)?.skill_level ?? 1;
    const xpDelta = action === "combat" ? 0.08 : action === "craft" ? 0.06 : 0.04;
    const next = Math.round((before + xpDelta) * 1000) / 1000;
    db.prepare("UPDATE dtus SET skill_level = ?, last_used_at = ? WHERE id = ?")
      .run(next, Math.floor(Date.now() / 1000), skillId);
    const leveledUp = Math.floor(next) > Math.floor(before);
    try {
      const re = globalThis.realtimeEmit;
      if (typeof re === "function") {
        re("skill:xp-awarded", { userId, dtuId: skillId, action, xp: xpDelta, leveledUp });
      } else if (globalThis._concordREALTIME?.io) {
        globalThis._concordREALTIME.io.to(`user:${userId}`).emit("skill:xp-awarded",
          { dtuId: skillId, action, xp: xpDelta, leveledUp });
      }
    } catch { /* realtime best-effort */ }
    return { ok: true, levelBefore: before, levelAfter: next, leveledUp };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function getMasteryMarkers(skill) {
  const level = skill.skill_level || 1;
  let marker  = { badge: "unranked", title: "Unranked", aura: null, npcRecognition: false, teacherEligible: false };

  for (const m of MASTERY_THRESHOLDS) {
    if (level >= m.level) marker = m;
    else break;
  }

  return {
    ...marker,
    level,
    nextThreshold: MASTERY_THRESHOLDS.find(m => m.level > level)?.level || null,
  };
}
