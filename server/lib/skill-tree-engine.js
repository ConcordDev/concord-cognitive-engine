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

function columnExists(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch { return false; }
}

/**
 * Aggregate per-skill data for an actor (player or npc).
 * Returns { skills: { skillKey: { level, xp, mastery, source } }, groups }
 * where groups is the category breakdown.
 */
export function getSkillTreeForActor(db, actorKind, actorId) {
  if (!actorKind || !actorId) return { ok: false, reason: "missing_inputs" };
  const skills = {};

  // Player levels/XP — authoritative source is player_skill_levels (migration
  // 064: user_id, skill_type, level, xp). BUG A fix: the prior code queried
  // skill_revisions.owner_user_id/skill_id/mastery_score — none of which exist
  // in the real migration-126 schema (recipe_dtu_id/author_kind/author_id/
  // revision_num), so the player branch threw `no such column` in production
  // while a fabricated test schema kept it green.
  if (actorKind === "player" && tableExists(db, "player_skill_levels")) {
    const rows = db.prepare(`
      SELECT skill_type AS skill_id, MAX(level) AS level, SUM(xp) AS xp
      FROM player_skill_levels WHERE user_id = ? GROUP BY skill_type
    `).all(actorId);
    for (const r of rows) {
      skills[r.skill_id] = {
        level: r.level || 0,
        xp: r.xp || 0,
        mastery: r.level || 0,
        source: "player_skill_levels",
        group: SKILL_TO_GROUP[r.skill_id] || "uncategorized",
      };
    }
  }

  // skill_revisions — only usable for the per-skill tree under the legacy
  // schema that carries an explicit skill_id (+ owner_user_id/npc_id). The
  // real migration-126 schema keys revisions by recipe_dtu_id + author_kind/
  // author_id (skill_kind, not a catalog skill), which does not map cleanly to
  // the catalog lattice — so we skip it there rather than throw.
  // skill_revisions keys a skill by its recipe_dtu_id; the author (player|npc) is
  // (author_kind, author_id). Revision count is the level proxy; no mastery column.
  if (tableExists(db, "skill_revisions")) {
    const rows = db.prepare(`
      SELECT recipe_dtu_id AS skill_id, MAX(revision_num) AS latest_rev, 0 AS best_mastery
      FROM skill_revisions WHERE author_kind = ? AND author_id = ? GROUP BY recipe_dtu_id
    `).all(actorKind, actorId);
    for (const r of rows) {
      const prev = skills[r.skill_id];
      skills[r.skill_id] = {
        level: Math.max(prev?.level || 0, r.latest_rev || 0),
        xp: prev?.xp || 0,
        mastery: Math.max(prev?.mastery || 0, r.best_mastery || 0),
        revisionNum: r.latest_rev || 0,
        source: prev?.source || "skill_revisions",
        group: SKILL_TO_GROUP[r.skill_id] || "uncategorized",
      };
    }
  }

  // npc_skill_acquisitions (mentorship-driven)
  if (tableExists(db, "npc_skill_acquisitions") && actorKind === "npc") {
    const rows = db.prepare(`
      SELECT recipe_dtu_id AS skill_id, COUNT(*) AS level FROM npc_skill_acquisitions
      WHERE buyer_npc_id = ? GROUP BY recipe_dtu_id
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
