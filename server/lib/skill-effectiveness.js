// server/lib/skill-effectiveness.js
// Continuous sigmoid effectiveness curves for skills in worlds.
// Replaces the old fixed-multiplier approach.

import crypto from "crypto";

/**
 * World resistance config shape:
 * worlds.rule_modulators.skill_resistance[skillType] = { threshold: number, scaling: number }
 *
 * threshold — minimum skill_level for the skill to function at all
 * scaling   — controls how steeply effectiveness rises above threshold
 */

/**
 * Get world resistance parameters for a given skill type.
 * Falls back to a permissive default if not configured.
 *
 * @param {object} world  Loaded world object (has rule_modulators or _rules)
 * @param {string} skillType
 * @returns {{ threshold: number, scaling: number }}
 */
export function getWorldResistance(world, skillType) {
  const rules = world._rules || world.rule_modulators || {};
  const resistance = rules.skill_resistance || {};

  return resistance[skillType] || { threshold: 1, scaling: 1.0 };
}

/**
 * Compute sigmoid effectiveness (0–1) for a skill in a world.
 * Returns 0 if skill_level is below the world's threshold for that type.
 *
 * @param {object} skill  DTU row — must have skill_level and a parseable content.domain
 * @param {object} world  Loaded world object
 * @returns {{ effectiveness: number, status: 'below_threshold'|'functional'|'mastered', skillLevel: number, threshold: number }}
 */
export function computeEffectiveness(skill, world) {
  const skillType = _resolveSkillType(skill);
  const { threshold, scaling } = getWorldResistance(world, skillType);

  const level = skill.skill_level || 1;

  if (level < threshold) {
    return { effectiveness: 0, status: "below_threshold", skillLevel: level, threshold };
  }

  // Sigmoid rising from threshold
  const above = level - threshold;
  const eff   = 1 / (1 + Math.exp(-above * scaling / 50));

  const status = eff >= 0.9 ? "mastered" : "functional";
  return { effectiveness: eff, status, skillLevel: level, threshold };
}

/**
 * Evaluate a skill's effectiveness in a world given the world's rule modifiers.
 * Also applies legacy multiplier rules for backwards compatibility.
 *
 * @param {object} skill  DTU row
 * @param {object} world  Loaded world
 * @returns {{ effectiveness: number, modifications: string[], explanation: string }}
 */
export function evaluateSkillInWorld(skill, world) {
  const curve = computeEffectiveness(skill, world);

  const rules       = world._rules || world.rule_modulators || {};
  const effRules    = rules.skill_effectiveness_rules || {};
  const skillType   = _resolveSkillType(skill);
  const ruleEntry   = effRules[skillType] || effRules.default || { multiplier: 1.0 };
  const multiplier  = ruleEntry.multiplier ?? 1.0;

  const finalEff    = curve.effectiveness * multiplier;
  const modifications = [];

  if (curve.status === "below_threshold") {
    modifications.push(`Skill level ${curve.skillLevel.toFixed(1)} below world threshold ${curve.threshold}`);
  }
  if (multiplier !== 1.0) {
    modifications.push(`World rule multiplier ×${multiplier}`);
  }

  return {
    effectiveness: finalEff,
    modifications,
    explanation: curve.status === "below_threshold"
      ? `${skill.title || skillType} does not function in ${world.name} until level ${curve.threshold}`
      : `${Math.round(finalEff * 100)}% effective in ${world.name}`,
  };
}

/**
 * Teach a skill from one player/NPC to another.
 * Creates a student skill DTU with lineage citing the teacher's DTU so
 * the royalty cascade fires automatically.
 *
 * @param {string} teacherId
 * @param {string} studentId
 * @param {string} skillDtuId
 * @param {object} worldContext  { worldId, worldName }
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<object>}  new student skill DTU
 */
export async function teachSkillToPlayer(teacherId, studentId, skillDtuId, worldContext, db, selectBrain) {
  // TODO: project explicit columns (auto-fix suggestion)
  const teacherSkill = db.prepare("SELECT * FROM dtus WHERE id = ?").get(skillDtuId);
  if (!teacherSkill) throw Object.assign(new Error("Skill not found"), { status: 404 });

  let adaptedContent = teacherSkill.content;

  // Ask subconscious brain to translate the skill to the student's context
  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "concordia:skill-teach",
    });

    const prompt = `A skill is being taught to a new student in world "${worldContext.worldName || worldContext.worldId}".

Original skill:
${teacherSkill.content}

Teacher ID: ${teacherId}
Student ID: ${studentId}
World: ${JSON.stringify(worldContext)}

Return a JSON object with the adapted skill content for the student, preserving the domain but adjusting to their perspective:
{ "title": "<adapted title>", "content": { "domain": "...", "description": "..." } }`;

    const raw   = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.content) adaptedContent = JSON.stringify(parsed.content);
    }
  } catch (_e) {
    // use original content if brain unavailable
  }

  const newId = crypto.randomUUID();
  const existingLineage = _parseLineage(teacherSkill.lineage || teacherSkill.content);

  db.prepare(`
    INSERT INTO dtus (id, type, title, content, creator_id, world_id, lineage, skill_level, total_experience, created_at)
    VALUES (?, 'skill', ?, ?, ?, ?, ?, 1.0, 0, unixepoch())
  `).run(
    newId,
    teacherSkill.title,
    adaptedContent,
    studentId,
    worldContext.worldId || "concordia-hub",
    JSON.stringify([skillDtuId, ...existingLineage]),
  );

  // Award teaching XP to teacher's skill
  try {
    const { awardExperience } = await import("./skill-progression.js");
    await awardExperience(
      teacherSkill,
      "teaching",
      { worldId: worldContext.worldId, userId: teacherId, studentImproved: true },
      db,
    );
  } catch (_e) { /* non-fatal */ }

  // TODO: project explicit columns (auto-fix suggestion)

  return db.prepare("SELECT * FROM dtus WHERE id = ?").get(newId);
}

function _resolveSkillType(skill) {
  try {
    const content = typeof skill.content === "string" ? JSON.parse(skill.content) : skill.content;
    return content?.domain || content?.type || "default";
  } catch {
    return "default";
  }
}

function _parseLineage(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}
