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

// Built-in weapon kinds that have a real frame envelope but are not stored
// as per-user skill DTU rows. A combat HUD / training room can ask for the
// canonical frame data of e.g. "sword" or "fist" directly. This is real
// derivation off KIND_FRAME_BASE — not a placeholder — so default skills
// resolve instead of 404-ing (PLAYTEST #21 `no_skill` defect).
export const BUILTIN_SKILL_KINDS = Object.freeze(
  Object.keys(KIND_FRAME_BASE).filter((k) => k !== "default"),
);

/** Title-case a kind id for display ("sword" → "Sword"). */
function titleCaseKind(kind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Frame data for a built-in weapon kind (no DB row required). Returns null
 * if `kind` is not a recognised built-in kind.
 */
export function getFrameDataForKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(KIND_FRAME_BASE, k) || k === "default") {
    return null;
  }
  return getSkillFrameData({ id: k, name: titleCaseKind(k), kind: k, level: 1 });
}

/**
 * Look up a skill in the DTU substrate and derive its frame data.
 *
 * Resolution order (all real, none fabricated):
 *   1. A persisted skill DTU row (`type='skill'`). Metadata lives in the
 *      `data` column (skill-progression writers) with `body_json` as a
 *      legacy fallback; the `skill_level` column carries the live level.
 *   2. A built-in weapon kind id (e.g. "sword", "fist") — canonical frame
 *      envelope from KIND_FRAME_BASE, so default skills never 404.
 *
 * Returns null only when the id matches neither — the caller surfaces an
 * honest empty/not-found state, never a fake frame table.
 */
export function getFrameDataForSkillId(db, skillId) {
  if (!skillId) return null;
  if (db) {
    try {
      const row = db.prepare(`
        SELECT id, title AS name, data, body_json, skill_level
        FROM dtus
        WHERE id = ? AND type = 'skill'
      `).get(skillId);
      if (row) {
        let meta = {};
        try { meta = JSON.parse(row.data || row.body_json || "{}"); } catch { /* malformed */ }
        return getSkillFrameData({
          id: row.id,
          name: row.name,
          kind: meta.kind || meta.weapon || meta.action || "default",
          level: meta.level || meta.skill_level || Math.floor(Number(row.skill_level) || 1),
          max_damage: meta.max_damage,
          combo_followups: meta.combo_followups,
        });
      }
    } catch { /* fall through to built-in resolution */ }
  }
  // No DTU row — try a built-in weapon kind so default skills resolve.
  return getFrameDataForKind(skillId);
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
