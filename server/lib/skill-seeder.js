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
//
// combo_followups grounding (Track D, training-room combo strip): the
// Training Room reads `skill.combo_followups` off `lib/combat-frame-data.js`
// (which reads it straight off this blob) and only renders the strip when
// it's non-empty — an authored skill with no follow-up correctly renders
// nothing. `content/skills.json`'s chains are NOT arbitrary: they mirror the
// skill's own authored `prerequisites` chain (Founder's Edge → The
// Sovereign's Refusal → Sundered Lattice Arc is the real unlock order — you
// cannot legally reach the follow-up without the predecessor), which is
// itself frame-data-feasible: every authored skill here resolves the
// `KIND_FRAME_BASE.default` envelope (no `kind`/`weapon` field is set on
// these narrative blueprints, so `getSkillFrameData` falls through to
// `default`), whose `recovery_ms` (280) exceeds `startup_ms` (220) — the
// recovery window of any of these skills is long enough to cancel into the
// startup of any other, so the prerequisite ordering was a real, available
// choice, not one picked around a timing wall. The terminal skill (Sundered
// Lattice Arc, a ranged finisher) is left with no combo_followups by design.
// If a future pass adds real per-weapon `kind` tagging here, re-derive these
// chains against the differentiated envelope rather than assuming this
// default-envelope reasoning still holds.

const SKILL_CREATOR = "content-seeder";

/** Validate one authored skill blueprint. Required: id, name. Numeric fields,
 *  if present, must be finite. `combo_followups`, if present, must be an
 *  array of skill ids (string) or `{id, name}` objects — shape-checked here;
 *  cross-referential validity (does the id resolve to a real skill in the
 *  same catalog) is checked by the content test, not this per-entry guard. */
export function validateSkillBlueprint(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, reason: "not_object" };
  if (typeof s.id !== "string" || !s.id) return { ok: false, reason: "missing_id" };
  if (typeof s.name !== "string" || !s.name) return { ok: false, reason: "missing_name" };
  for (const k of ["max_damage", "range_m", "bar_cost", "difficulty", "skill_level"]) {
    if (s[k] !== undefined && !Number.isFinite(Number(s[k]))) return { ok: false, reason: `invalid_${k}` };
  }
  if (s.combo_followups !== undefined) {
    if (!Array.isArray(s.combo_followups)) return { ok: false, reason: "invalid_combo_followups" };
    for (const f of s.combo_followups) {
      const validString = typeof f === "string" && f.length > 0;
      const validObject = f && typeof f === "object" && typeof f.id === "string" && f.id.length > 0;
      if (!validString && !validObject) return { ok: false, reason: "invalid_combo_followup_entry" };
    }
  }
  return { ok: true };
}

/** Build the `data` JSON the combat route reads. Only known, combat-relevant
 *  fields are surfaced; the lore string is carried for the client.
 *
 *  `combo_followups` is read straight through (already `{id,name}`-or-string
 *  shaped, validated by `validateSkillBlueprint`) so `combat-frame-data.js#
 *  getSkillFrameData` — which reads `skill.combo_followups` off this exact
 *  blob — can surface it to the Training Room strip. Absent/empty stays
 *  absent/empty; nothing is synthesized here. */
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
    combo_followups: Array.isArray(s.combo_followups) ? s.combo_followups.slice(0, 4) : [],
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
