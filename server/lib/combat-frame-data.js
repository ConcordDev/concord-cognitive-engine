// server/lib/combat-frame-data.js
//
// Phase AF — combat frame data.
//
// Read-only derivation that turns the existing skill substrate into
// the "what does this skill actually do" surface that lifts combat
// out of opaque numbers. No new tables; pure derivation.
//
// Output shape:
//   { startup_ms, active_ms, recovery_ms,
//     parry_window_ms, dodge_window_ms,
//     combo_followups: [{ skillId, name }] }
//
// Numbers are seeded off skill.kind + level so the same skill always
// reports the same frame data (idempotent surface).

import { COMBAT_PROFILES } from "./combat-polish.js";

// Per-skill-kind base frame envelope. Heavier weapons → longer
// startup + recovery; faster weapons → tight parry window.
const KIND_FRAME_BASE = Object.freeze({
  sword:    { startup_ms: 200, active_ms: 100, recovery_ms: 300, parry_window_ms: 220, dodge_window_ms: 260 },
  axe:     { startup_ms: 280, active_ms: 140, recovery_ms: 380, parry_window_ms: 180, dodge_window_ms: 240 },
  spear:   { startup_ms: 240, active_ms: 120, recovery_ms: 320, parry_window_ms: 200, dodge_window_ms: 240 },
  bow:     { startup_ms: 350, active_ms: 80,  recovery_ms: 250, parry_window_ms: 0,   dodge_window_ms: 320 },
  staff:   { startup_ms: 320, active_ms: 80,  recovery_ms: 280, parry_window_ms: 0,   dodge_window_ms: 300 },
  fist:    { startup_ms: 140, active_ms: 60,  recovery_ms: 220, parry_window_ms: 260, dodge_window_ms: 300 },
  dagger:  { startup_ms: 120, active_ms: 50,  recovery_ms: 200, parry_window_ms: 240, dodge_window_ms: 320 },
  hammer:  { startup_ms: 350, active_ms: 180, recovery_ms: 450, parry_window_ms: 160, dodge_window_ms: 220 },
  default: { startup_ms: 220, active_ms: 100, recovery_ms: 280, parry_window_ms: 200, dodge_window_ms: 260 },
});

/**
 * Derive frame data for a single skill row from its persisted metadata.
 * `skill` shape: { id, kind?, name?, level?, max_damage?, combo_followups? }
 */
export function getSkillFrameData(skill = {}) {
  const kind = (skill.kind || "default").toLowerCase();
  const base = KIND_FRAME_BASE[kind] || KIND_FRAME_BASE.default;
  const level = Math.max(1, Number(skill.level) || 1);

  // Higher level = slightly faster startup + recovery (skill mastery).
  // Cap so frame data converges at level 100, doesn't go negative.
  const levelFactor = Math.max(0.7, 1 - (level - 1) * 0.003);

  const startup_ms = Math.round(base.startup_ms * levelFactor);
  const recovery_ms = Math.round(base.recovery_ms * levelFactor);

  const followups = Array.isArray(skill.combo_followups)
    ? skill.combo_followups.slice(0, 4).map(f =>
        typeof f === "string" ? { skillId: f, name: f }
        : { skillId: f.id || f.skillId, name: f.name || f.id || "" })
    : [];

  return {
    skillId: skill.id || null,
    name: skill.name || skill.id || "unnamed",
    kind,
    level,
    startup_ms,
    active_ms: base.active_ms,
    recovery_ms,
    parry_window_ms: base.parry_window_ms,
    dodge_window_ms: base.dodge_window_ms,
    combo_followups: followups,
  };
}

/**
 * Look up a skill in the DTU substrate and derive its frame data.
 * Returns null if the skill isn't found.
 */
export function getFrameDataForSkillId(db, skillId) {
  if (!db || !skillId) return null;
  try {
    const row = db.prepare(`
      SELECT id, title AS name, body_json
      FROM dtus
      WHERE id = ? AND type = 'skill'
    `).get(skillId);
    if (!row) return null;
    let meta = {};
    try { meta = JSON.parse(row.body_json || "{}"); } catch { /* malformed */ }
    return getSkillFrameData({
      id: row.id,
      name: row.name,
      kind: meta.kind || meta.weapon || "default",
      level: meta.level || meta.skill_level || 1,
      max_damage: meta.max_damage,
      combo_followups: meta.combo_followups,
    });
  } catch { return null; }
}

/**
 * Lift frame data for a list of skills (useful for HUD hotbars).
 */
export function getFrameDataBatch(db, skillIds = []) {
  return skillIds
    .map(id => getFrameDataForSkillId(db, id))
    .filter(Boolean);
}

/**
 * Profile-aware override — when training in a specific combat profile,
 * its parry/dodge windows take precedence over per-skill defaults.
 */
export function withProfileOverride(frameData, profileName) {
  if (!frameData) return null;
  const profile = COMBAT_PROFILES[profileName];
  if (!profile) return frameData;
  return {
    ...frameData,
    parry_window_ms: profile.parry_window_ms,
    dodge_window_ms: profile.dodge_window_ms,
    combo_window_ms: profile.combo_window_ms,
    profile: profileName,
  };
}
