// Content pillar 2 — authored skill/weapon blueprints → skill DTUs.
//
// In this engine a lore "weapon" or "combat style" IS a skill DTU: the combat
// route loads `data`/`skill_level` from `dtus WHERE id=?` and reads
// `skillData.max_damage` / `range_m` / `resource_bar` / `bar_cost` straight off
// the parsed `data` JSON (routes/worlds.js:2299-2303), bounded by the
// server-authoritative ceiling in lib/combat-limits.js. So seeding a blueprint
// here makes it a REAL, combat-readable definition — not decorative.
//
// Idempotent insert-once (INSERT OR IGNORE on the DTU id). Authored blueprints
// carry a versioned id (e.g. `dtu_swordsmanship_v1`); to change one, bump the
// version rather than mutate runtime skill rows. creator_id is plain TEXT
// (mig 087, no FK), so a synthetic "content-seeder" creator is safe.

const SKILL_CREATOR = "content-seeder";

/** Validate one authored skill blueprint. Required: id, name. Numeric fields,
 *  if present, must be finite. */
export function validateSkillBlueprint(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, reason: "not_object" };
  if (typeof s.id !== "string" || !s.id) return { ok: false, reason: "missing_id" };
  if (typeof s.name !== "string" || !s.name) return { ok: false, reason: "missing_name" };
  for (const k of ["max_damage", "range_m", "bar_cost", "difficulty", "skill_level"]) {
    if (s[k] !== undefined && !Number.isFinite(Number(s[k]))) return { ok: false, reason: `invalid_${k}` };
  }
  return { ok: true };
}

/** Build the `data` JSON the combat route reads. Only known, combat-relevant
 *  fields are surfaced; the lore string is carried for the client. */
export function skillDataBlob(s) {
  return {
    skill_kind: s.skill_kind || "combat",
    element: s.element || "physical",
    // Read by _validateDamageCap (bounded by combat-limits). null → hard cap.
    max_damage: s.max_damage !== undefined ? Number(s.max_damage) : null,
    range_m: s.range_m !== undefined ? Number(s.range_m) : undefined,
    resource_bar: s.resource_bar || "stamina",
    bar_cost: s.bar_cost !== undefined ? Number(s.bar_cost) : 10,
    prerequisites: Array.isArray(s.prerequisites) ? s.prerequisites : [],
    difficulty: s.difficulty !== undefined ? Number(s.difficulty) : 1,
    authored: true,
    description: s.description || "",
    lore: s.lore || s.flavor || null,
  };
}

/**
 * Seed authored skill/weapon blueprints from a parsed `skills.json` array into
 * the `dtus` table as `type='skill'` rows. Mirrors the exact INSERT shape the
 * runtime uses (skill-progression.js#recordGameplayXP). Idempotent (INSERT OR
 * IGNORE on id). Returns the count newly inserted.
 */
export function seedSkillBlueprints(db, skills, { creatorId = SKILL_CREATOR, now } = {}) {
  if (!db || !Array.isArray(skills)) return 0;
  const ts = now || new Date().toISOString();
  let n = 0;
  let stmt;
  try {
    stmt = db.prepare(`
      INSERT OR IGNORE INTO dtus (id, type, title, creator_id, data, skill_level, created_at, last_used_at)
      VALUES (?, 'skill', ?, ?, ?, ?, ?, ?)
    `);
  } catch {
    return 0; // dtus skill columns absent on a minimal build — degrade to no-op
  }
  for (const s of skills) {
    if (!validateSkillBlueprint(s).ok) continue;
    try {
      const r = stmt.run(
        s.id, s.name, creatorId,
        JSON.stringify(skillDataBlob(s)),
        Number(s.skill_level) || 1, ts, ts,
      );
      if (r.changes === 1) n++;
    } catch { /* per-skill best-effort */ }
  }
  return n;
}
