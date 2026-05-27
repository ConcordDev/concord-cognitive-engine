// server/lib/skill-tree-engine.js
//
// Phase II Wave 16 — skill-tree aggregation.
//
// Concord ships skill data scattered across many tables:
//   - skill_revisions       (npc/player skill mastery from skill-author cycle)
//   - npc_skill_acquisitions (mentorship-acquired skills)
//   - npc_demonstration_log  (witnessed-skill events)
//
// This wave unifies them into one tree-data query the frontend can
// render as a Path-of-Exile-style hex graph or a Sims-style category
// list.
//
// Catalog source: a deterministic table of well-known skill kinds
// gathered from existing domains (cooking, music, art, crafting,
// social, athletics, programming, public-speaking, fishing,
// photography, karaoke, mahjong, swords, archery, magic, etc.).
// Frontend treats this list as ordered groups; new skills auto-appear
// the moment any row references them.

const SKILL_CATALOG = Object.freeze({
  combat: [
    "swords", "archery", "fists", "spears", "staves", "ranged_pistol",
    "ranged_rifle", "elemental_fire", "elemental_water", "elemental_ice",
    "elemental_lightning", "elemental_poison", "elemental_energy",
  ],
  athletic: [
    "athletics", "reflex", "stealth", "swimming", "climbing", "agility",
    "endurance", "vitality", "strength", "focus",
  ],
  craft: [
    "blacksmithing", "carpentry", "tailoring", "cooking", "alchemy",
    "engineering", "leatherworking", "jewelry", "brewing",
  ],
  arts: [
    "painting", "drawing", "music_performance", "music_composition",
    "dance", "acting", "writing", "photography",
  ],
  social: [
    "rhetoric", "negotiation", "diplomacy", "deception", "leadership",
    "intimidation", "empathy", "charisma", "public_speaking", "ethics",
  ],
  scholar: [
    "academics", "history", "mathematics", "natural_philosophy",
    "linguistics", "programming", "engineering_theory", "occult_studies",
  ],
  side: [
    "fishing", "karaoke", "mahjong", "gardening", "carpentry_decor",
    "appraising", "lockpicking", "racing", "vehicle_tuning",
  ],
});

// Compute the inverse: skill → group
const SKILL_TO_GROUP = (() => {
  const map = {};
  for (const [group, list] of Object.entries(SKILL_CATALOG)) {
    for (const s of list) map[s] = group;
  }
  return map;
})();

function tableExists(db, name) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

/**
 * Aggregate per-skill data for an actor (player or npc).
 * Returns { skills: { skillKey: { level, xp, mastery, source } }, groups }
 * where groups is the category breakdown.
 */
export function getSkillTreeForActor(db, actorKind, actorId) {
  if (!actorKind || !actorId) return { ok: false, reason: "missing_inputs" };
  const skills = {};

  // skill_revisions: skill_id, npc_id (or owner_user_id), revision_num, mastery_score
  if (tableExists(db, "skill_revisions")) {
    const rows = actorKind === "player"
      ? db.prepare(`
          SELECT skill_id, MAX(revision_num) AS latest_rev, MAX(mastery_score) AS best_mastery
          FROM skill_revisions WHERE owner_user_id = ? GROUP BY skill_id
        `).all(actorId)
      : db.prepare(`
          SELECT skill_id, MAX(revision_num) AS latest_rev, MAX(mastery_score) AS best_mastery
          FROM skill_revisions WHERE npc_id = ? GROUP BY skill_id
        `).all(actorId);
    for (const r of rows) {
      skills[r.skill_id] = {
        level: r.latest_rev || 0,
        mastery: r.best_mastery || 0,
        source: "skill_revisions",
        group: SKILL_TO_GROUP[r.skill_id] || "uncategorized",
      };
    }
  }

  // npc_skill_acquisitions (mentorship-driven)
  if (tableExists(db, "npc_skill_acquisitions") && actorKind === "npc") {
    const rows = db.prepare(`
      SELECT skill_id, MAX(level) AS level FROM npc_skill_acquisitions
      WHERE npc_id = ? GROUP BY skill_id
    `).all(actorId);
    for (const r of rows) {
      if (!skills[r.skill_id]) {
        skills[r.skill_id] = {
          level: r.level || 0,
          mastery: r.level || 0,
          source: "npc_skill_acquisitions",
          group: SKILL_TO_GROUP[r.skill_id] || "uncategorized",
        };
      }
    }
  }

  const groups = {};
  for (const [skill, info] of Object.entries(skills)) {
    const g = info.group;
    if (!groups[g]) groups[g] = { skills: [], totalLevel: 0, count: 0 };
    groups[g].skills.push({ skill, ...info });
    groups[g].totalLevel += info.level;
    groups[g].count += 1;
  }
  // Catalog skills that have no data yet — surface them as level 0 so
  // the tree always shows the full lattice rather than a sparse list.
  for (const [groupName, list] of Object.entries(SKILL_CATALOG)) {
    if (!groups[groupName]) groups[groupName] = { skills: [], totalLevel: 0, count: 0 };
    for (const s of list) {
      if (!skills[s]) {
        groups[groupName].skills.push({ skill: s, level: 0, mastery: 0, source: "catalog", group: groupName });
      }
    }
  }
  return {
    ok: true,
    actorKind, actorId,
    skills,
    groups,
    totalLevel: Object.values(skills).reduce((sum, s) => sum + (s.level || 0), 0),
  };
}

/**
 * Check whether an actor is eligible for a cross-skill gated unlock
 * (e.g. athletics + reflexes maxed → sports tryout; public_speaking +
 * ethics maxed → city council candidacy).
 *
 * Predicates are author-driven — the caller passes an array of
 * { skill, minLevel } and we AND them.
 */
export function checkSkillGate(db, actorKind, actorId, requirements) {
  const tree = getSkillTreeForActor(db, actorKind, actorId);
  if (!tree.ok) return tree;
  const missing = [];
  const required = Array.isArray(requirements) ? requirements : [];
  for (const req of required) {
    const got = tree.skills[req.skill];
    const minLevel = Number(req.minLevel) || 1;
    if (!got || (got.level || 0) < minLevel) {
      missing.push({ skill: req.skill, required: minLevel, got: got?.level || 0 });
    }
  }
  return {
    ok: true,
    eligible: missing.length === 0,
    missing,
    requirements: required,
  };
}

export const SKILL_TREE_CONSTANTS = Object.freeze({
  SKILL_CATALOG,
  SKILL_TO_GROUP,
});
